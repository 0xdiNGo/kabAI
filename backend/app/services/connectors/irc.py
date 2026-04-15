"""Full IRCv3 connector built on raw asyncio streams.

Supports: CAP negotiation (302), SASL (PLAIN/EXTERNAL/SCRAM-SHA-256),
message-tags, labeled-response, echo-message, server-time, batch,
multi-prefix, away-notify, account-notify, extended-join, cap-notify, chghost.
"""

import asyncio
import base64
import hashlib
import hmac
import logging
import os
import re
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.models.connector import Connector, IRCConfig
from app.services.connectors.base import BaseConnector
from app.services.connectors.event_bus import ConnectorEventBus
from app.services.conversation_service import ConversationService

logger = logging.getLogger(__name__)

# IRC line length limit (RFC 2812: 512 bytes including CRLF)
MAX_IRC_LINE = 510


@dataclass
class IRCMessage:
    """Parsed IRCv3 message."""
    tags: dict[str, str | None] = field(default_factory=dict)
    source: str | None = None
    command: str = ""
    params: list[str] = field(default_factory=list)

    @property
    def nick(self) -> str | None:
        if self.source and "!" in self.source:
            return self.source.split("!")[0]
        return self.source

    @property
    def trailing(self) -> str:
        return self.params[-1] if self.params else ""


def parse_irc_message(raw: str) -> IRCMessage:
    """Parse an IRCv3 message line into structured form.

    Format: [@tags] [:source] COMMAND [params...] [:trailing]
    """
    msg = IRCMessage()
    pos = 0

    # Parse message tags (@key=value;key2=value2)
    if raw.startswith("@"):
        tag_end = raw.index(" ", 1)
        tag_str = raw[1:tag_end]
        for tag in tag_str.split(";"):
            if "=" in tag:
                k, v = tag.split("=", 1)
                # Unescape IRCv3 tag values
                v = v.replace("\\:", ";").replace("\\s", " ").replace("\\\\", "\\")
                v = v.replace("\\r", "\r").replace("\\n", "\n")
                msg.tags[k] = v
            else:
                msg.tags[tag] = None
        pos = tag_end + 1

    # Parse source (:nick!user@host)
    if pos < len(raw) and raw[pos] == ":":
        source_end = raw.index(" ", pos)
        msg.source = raw[pos + 1:source_end]
        pos = source_end + 1

    # Parse command and params
    rest = raw[pos:]
    if " :" in rest:
        before_trailing, trailing = rest.split(" :", 1)
        parts = before_trailing.split()
        msg.command = parts[0].upper() if parts else ""
        msg.params = parts[1:] + [trailing]
    else:
        parts = rest.split()
        msg.command = parts[0].upper() if parts else ""
        msg.params = parts[1:]

    return msg


def build_irc_message(command: str, *params: str, tags: dict[str, str] | None = None) -> str:
    """Build an IRC protocol line from components."""
    parts = []

    if tags:
        tag_strs = []
        for k, v in tags.items():
            if v is not None:
                # Escape IRCv3 tag values
                v = v.replace("\\", "\\\\").replace(";", "\\:").replace(" ", "\\s")
                v = v.replace("\r", "\\r").replace("\n", "\\n")
                tag_strs.append(f"{k}={v}")
            else:
                tag_strs.append(k)
        parts.append("@" + ";".join(tag_strs))

    parts.append(command)

    if params:
        for p in params[:-1]:
            parts.append(p)
        trailing = params[-1]
        if " " in trailing or trailing.startswith(":") or not trailing:
            parts.append(":" + trailing)
        else:
            parts.append(trailing)

    return " ".join(parts)


class SASLHandler:
    """Handles SASL authentication during CAP negotiation."""

    def __init__(self, mechanism: str, username: str, password: str):
        self.mechanism = mechanism.upper()
        self.username = username
        self.password = password
        self._scram_state: dict = {}

    def initial_response(self) -> str | None:
        """Return the initial AUTHENTICATE payload (base64)."""
        if self.mechanism == "PLAIN":
            payload = f"{self.username}\x00{self.username}\x00{self.password}"
            return base64.b64encode(payload.encode()).decode()
        elif self.mechanism == "EXTERNAL":
            return "+"
        elif self.mechanism == "SCRAM-SHA-256":
            nonce = base64.b64encode(os.urandom(18)).decode()
            self._scram_state["client_nonce"] = nonce
            client_first_bare = f"n={self.username},r={nonce}"
            self._scram_state["client_first_bare"] = client_first_bare
            gs2_header = "n,,"
            client_first = gs2_header + client_first_bare
            return base64.b64encode(client_first.encode()).decode()
        return None

    def respond(self, challenge_b64: str) -> str | None:
        """Handle a server challenge and return the next response."""
        if self.mechanism != "SCRAM-SHA-256":
            return None

        challenge = base64.b64decode(challenge_b64).decode()

        if "client_proof" not in self._scram_state:
            # Server first message: r=<nonce>,s=<salt>,i=<iterations>
            parts = dict(p.split("=", 1) for p in challenge.split(","))
            server_nonce = parts["r"]
            salt = base64.b64decode(parts["s"])
            iterations = int(parts["i"])

            client_nonce = self._scram_state["client_nonce"]
            if not server_nonce.startswith(client_nonce):
                raise ValueError("Server nonce doesn't start with client nonce")

            salted_password = hashlib.pbkdf2_hmac(
                "sha256", self.password.encode(), salt, iterations,
            )
            client_key = hmac.new(salted_password, b"Client Key", "sha256").digest()
            stored_key = hashlib.sha256(client_key).digest()

            channel_binding = base64.b64encode(b"n,,").decode()
            client_final_no_proof = f"c={channel_binding},r={server_nonce}"
            auth_message = (
                f"{self._scram_state['client_first_bare']},"
                f"{challenge},"
                f"{client_final_no_proof}"
            )

            client_signature = hmac.new(
                stored_key, auth_message.encode(), "sha256",
            ).digest()
            client_proof = bytes(a ^ b for a, b in zip(client_key, client_signature))

            server_key = hmac.new(salted_password, b"Server Key", "sha256").digest()
            self._scram_state["expected_server_sig"] = hmac.new(
                server_key, auth_message.encode(), "sha256",
            ).digest()

            proof_b64 = base64.b64encode(client_proof).decode()
            client_final = f"{client_final_no_proof},p={proof_b64}"
            self._scram_state["client_proof"] = True
            return base64.b64encode(client_final.encode()).decode()
        else:
            # Server final message: v=<server_signature>
            parts = dict(p.split("=", 1) for p in challenge.split(","))
            server_sig = base64.b64decode(parts["v"])
            if server_sig != self._scram_state["expected_server_sig"]:
                raise ValueError("Server signature mismatch")
            return None


class IRCConnector(BaseConnector):
    """Full IRCv3 connector using raw asyncio streams."""

    def __init__(
        self,
        connector: Connector,
        conversation_service: ConversationService,
        event_bus: ConnectorEventBus,
    ):
        super().__init__(connector, conversation_service, event_bus)
        self.irc: IRCConfig = connector.irc_config  # type: ignore[assignment]
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._send_queue: asyncio.Queue[str] = asyncio.Queue()
        self._negotiated_caps: set[str] = set()
        self._cap_negotiating = False
        self._sasl_handler: SASLHandler | None = None
        self._registered = False
        self._current_nick: str = ""
        self._joined_channels: set[str] = set()
        self._connected_at: float = 0
        self._message_count: int = 0
        self._reconnect_count: int = 0
        # Active batches (batch ID -> list of messages)
        self._batches: dict[str, list[IRCMessage]] = {}
        # Label tracking for labeled-response
        self._pending_labels: dict[str, asyncio.Future] = {}
        self._label_counter: int = 0
        # Echo-message dedup
        self._echo_enabled = False
        # Per-user cooldown timestamps
        self._cooldowns: dict[str, float] = {}

    async def connect(self) -> None:
        ssl_ctx = None
        if self.irc.use_tls:
            ssl_ctx = ssl.create_default_context()
            # Some IRC servers have self-signed certs
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE

        self._reader, self._writer = await asyncio.open_connection(
            self.irc.server, self.irc.port, ssl=ssl_ctx,
        )
        self._connected_at = time.monotonic()
        self._current_nick = self.irc.nick
        logger.info("Connected to %s:%d", self.irc.server, self.irc.port)

    async def disconnect(self) -> None:
        if self._writer:
            try:
                await self._send_raw("QUIT :kabAI connector shutting down")
            except Exception:
                pass
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
            self._writer = None
            self._reader = None

    async def send_to_external(self, target: str, content: str) -> None:
        """Send a message to a channel or user, auto-splitting long messages."""
        lines = self._split_message(content, target)
        for line in lines:
            await self._send_queue.put(f"PRIVMSG {target} :{line}")

    async def get_health(self) -> dict:
        uptime = time.monotonic() - self._connected_at if self._connected_at else 0
        return {
            "connected": self._registered,
            "nick": self._current_nick,
            "server": f"{self.irc.server}:{self.irc.port}",
            "channels": sorted(self._joined_channels),
            "negotiated_caps": sorted(self._negotiated_caps),
            "uptime_seconds": round(uptime),
            "messages_handled": self._message_count,
            "reconnect_count": self._reconnect_count,
        }

    # ── Main event loop ─────────────────────────────────────────────

    async def _run(self) -> None:
        """Main loop with reconnection."""
        attempt = 0
        while self._running:
            try:
                await self.connect()
                await self._register()
                attempt = 0

                # Run sender and receiver concurrently
                await asyncio.gather(
                    self._recv_loop(),
                    self._send_loop(),
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                if not self._running:
                    break
                attempt += 1
                self._reconnect_count += 1
                max_attempts = self.irc.max_reconnect_attempts
                if max_attempts and attempt >= max_attempts:
                    logger.error("Max reconnect attempts reached for %s", self.config.name)
                    break
                delay = min(self.irc.reconnect_delay * (2 ** min(attempt - 1, 5)), 300)
                logger.warning(
                    "Connection lost for %s (%s), reconnecting in %ds...",
                    self.config.name, e, delay,
                )
                await self.event_bus.publish(self.connector_id, "status_changed", {
                    "status": "reconnecting", "attempt": attempt, "delay": delay,
                })
                await asyncio.sleep(delay)
            finally:
                self._registered = False
                self._joined_channels.clear()
                self._negotiated_caps.clear()

    async def _register(self) -> None:
        """Perform IRC registration: CAP negotiation, SASL, NICK/USER."""
        # Start CAP negotiation
        self._cap_negotiating = True
        await self._send_raw("CAP LS 302")

        if self.irc.server_password:
            await self._send_raw(f"PASS {self.irc.server_password}")

        username = self.irc.username or self.irc.nick
        realname = self.irc.realname or f"kabAI {self.config.name}"
        await self._send_raw(f"NICK {self.irc.nick}")
        await self._send_raw(f"USER {username} 0 * :{realname}")

    async def _recv_loop(self) -> None:
        """Read lines from the server and dispatch to handlers."""
        assert self._reader is not None
        buffer = b""
        while self._running:
            data = await self._reader.read(4096)
            if not data:
                raise ConnectionError("Server closed connection")
            buffer += data
            while b"\r\n" in buffer:
                line, buffer = buffer.split(b"\r\n", 1)
                try:
                    text = line.decode("utf-8")
                except UnicodeDecodeError:
                    text = line.decode("latin-1")
                if text:
                    await self._handle_line(text)

    async def _send_loop(self) -> None:
        """Drain the send queue with flood protection."""
        while self._running:
            raw = await self._send_queue.get()
            await self._send_raw(raw)
            if self.irc.flood_delay > 0:
                await asyncio.sleep(self.irc.flood_delay)

    async def _send_raw(self, line: str) -> None:
        """Send a raw IRC line to the server."""
        if not self._writer:
            return
        if len(line.encode("utf-8")) > MAX_IRC_LINE:
            line = line[:MAX_IRC_LINE]
        self._writer.write((line + "\r\n").encode("utf-8"))
        await self._writer.drain()

    # ── Message dispatch ─────────────────────────────────────────────

    async def _handle_line(self, raw: str) -> None:
        """Parse and dispatch a single IRC line."""
        msg = parse_irc_message(raw)
        handler = getattr(self, f"_on_{msg.command.lower()}", None)
        if handler:
            await handler(msg, raw)
        elif msg.command.isdigit():
            await self._on_numeric(msg, raw)

    # ── CAP negotiation ──────────────────────────────────────────────

    async def _on_cap(self, msg: IRCMessage, raw: str) -> None:
        """Handle CAP LS, ACK, NAK, NEW, DEL."""
        if len(msg.params) < 3:
            return
        subcommand = msg.params[1].upper()
        cap_list = msg.params[-1]

        if subcommand == "LS":
            # Parse available capabilities
            available: dict[str, str | None] = {}
            for cap_entry in cap_list.split():
                if "=" in cap_entry:
                    name, value = cap_entry.split("=", 1)
                    available[name] = value
                else:
                    available[cap_entry] = None

            # Request the intersection of what we want and what's available
            wanted = set(self.irc.request_caps) & set(available.keys())
            if wanted:
                await self._send_raw(f"CAP REQ :{' '.join(sorted(wanted))}")
            else:
                await self._end_cap()

            # Check if this is a multi-line LS (indicated by * in params)
            if len(msg.params) >= 3 and msg.params[1] == "*":
                return  # More coming

        elif subcommand == "ACK":
            acked = set(cap_list.split())
            self._negotiated_caps |= acked
            logger.info("CAP ACK: %s", acked)

            if "echo-message" in acked:
                self._echo_enabled = True

            if "sasl" in acked and self.irc.sasl_mechanism and self.irc.sasl_username:
                await self._start_sasl()
            else:
                await self._end_cap()

        elif subcommand == "NAK":
            logger.warning("CAP NAK: %s", cap_list)
            await self._end_cap()

        elif subcommand == "NEW":
            # Runtime capability additions (cap-notify)
            new_caps = set(cap_list.split())
            wanted = new_caps & set(self.irc.request_caps)
            if wanted:
                await self._send_raw(f"CAP REQ :{' '.join(sorted(wanted))}")

        elif subcommand == "DEL":
            removed = set(cap_list.split())
            self._negotiated_caps -= removed
            if "echo-message" in removed:
                self._echo_enabled = False

    async def _start_sasl(self) -> None:
        mechanism = self.irc.sasl_mechanism or "PLAIN"
        self._sasl_handler = SASLHandler(
            mechanism,
            self.irc.sasl_username or "",
            self.irc.sasl_password or "",
        )
        await self._send_raw(f"AUTHENTICATE {mechanism}")

    async def _on_authenticate(self, msg: IRCMessage, raw: str) -> None:
        if not self._sasl_handler:
            return
        challenge = msg.params[0] if msg.params else "+"
        if challenge == "+":
            # Server is ready for initial response
            response = self._sasl_handler.initial_response()
            if response:
                await self._send_raw(f"AUTHENTICATE {response}")
            else:
                await self._send_raw("AUTHENTICATE +")
        else:
            # Server challenge (SCRAM)
            response = self._sasl_handler.respond(challenge)
            if response:
                await self._send_raw(f"AUTHENTICATE {response}")
            else:
                await self._send_raw("AUTHENTICATE +")

    async def _end_cap(self) -> None:
        if self._cap_negotiating:
            self._cap_negotiating = False
            await self._send_raw("CAP END")

    # ── Numeric replies ──────────────────────────────────────────────

    async def _on_numeric(self, msg: IRCMessage, raw: str) -> None:
        num = int(msg.command)

        if num == 1:  # RPL_WELCOME
            self._registered = True
            logger.info("Registered as %s on %s", self._current_nick, self.irc.server)
            # Join configured channels
            for channel in self.irc.channels:
                await self._send_raw(f"JOIN {channel}")

        elif num == 433:  # ERR_NICKNAMEINUSE
            self._current_nick += "_"
            await self._send_raw(f"NICK {self._current_nick}")

        elif num in (902, 904, 905):  # SASL errors
            logger.error("SASL authentication failed (numeric %d): %s", num, msg.trailing)
            self._sasl_handler = None
            await self._end_cap()

        elif num == 903:  # RPL_SASLSUCCESS
            logger.info("SASL authentication successful")
            self._sasl_handler = None
            await self._end_cap()

        elif num == 900:  # RPL_LOGGEDIN
            logger.info("SASL logged in: %s", msg.trailing)

    # ── Core message handlers ────────────────────────────────────────

    async def _on_ping(self, msg: IRCMessage, raw: str) -> None:
        await self._send_raw(f"PONG :{msg.trailing}")

    async def _on_pong(self, msg: IRCMessage, raw: str) -> None:
        pass  # Could track latency here

    async def _on_privmsg(self, msg: IRCMessage, raw: str) -> None:
        """Handle incoming PRIVMSG — the core message handler."""
        if not msg.nick or not msg.params:
            return

        self._message_count += 1
        sender = msg.nick
        target = msg.params[0]
        content = msg.trailing

        # Ignore messages from self (especially with echo-message)
        if sender.lower() == self._current_nick.lower():
            return

        # Strip IRC formatting codes if configured
        if self.config.rules.strip_formatting:
            content = self._strip_formatting(content)

        # Handle CTCP (except ACTION)
        if content.startswith("\x01") and content.endswith("\x01"):
            await self._handle_ctcp(sender, target, content[1:-1])
            return

        is_private = target.lower() == self._current_nick.lower()
        is_channel = target.startswith("#") or target.startswith("&")

        # Channel mode filtering
        if is_channel:
            if self.irc.channel_mode == "highlight":
                # Only respond when nick is mentioned
                nick_pattern = re.compile(
                    rf"\b{re.escape(self._current_nick)}\b", re.IGNORECASE,
                )
                if not nick_pattern.search(content):
                    return
                # Strip the nick mention from the content
                content = nick_pattern.sub("", content).strip().lstrip(",: ")
            elif self.irc.channel_mode == "prefix":
                if not content.startswith(self.irc.command_prefix):
                    return
                content = content[len(self.irc.command_prefix):].strip()
            # "all" mode: respond to everything

        if is_private and self.irc.dm_mode == "never":
            return

        # Per-user cooldown
        now = time.time()
        cooldown = self.config.rules.cooldown_seconds
        if cooldown > 0:
            last = self._cooldowns.get(sender.lower(), 0)
            if now - last < cooldown:
                return
            self._cooldowns[sender.lower()] = now

        # Route through the base connector handler -> ConversationService
        try:
            response = await self.handle_incoming_message(
                sender=sender,
                target=target if is_channel else sender,
                content=content,
                is_private=is_private,
                raw=raw,
            )
            if response:
                reply_target = target if is_channel else sender
                lines = self._split_message(response, reply_target)
                for line in lines:
                    if is_channel:
                        await self._send_queue.put(f"PRIVMSG {reply_target} :{sender}: {line}")
                    else:
                        await self._send_queue.put(f"PRIVMSG {reply_target} :{line}")
        except Exception as e:
            logger.error("Error handling message from %s: %s", sender, e, exc_info=True)

    async def _on_notice(self, msg: IRCMessage, raw: str) -> None:
        """Handle NOTICE — log but don't respond (per IRC convention)."""
        logger.debug("NOTICE from %s: %s", msg.nick or msg.source, msg.trailing)

    async def _on_join(self, msg: IRCMessage, raw: str) -> None:
        if msg.nick and msg.nick.lower() == self._current_nick.lower():
            channel = msg.params[0]
            self._joined_channels.add(channel)
            logger.info("Joined %s", channel)
            await self.event_bus.publish(self.connector_id, "channel_joined", {
                "channel": channel,
            })

    async def _on_part(self, msg: IRCMessage, raw: str) -> None:
        if msg.nick and msg.nick.lower() == self._current_nick.lower():
            channel = msg.params[0]
            self._joined_channels.discard(channel)

    async def _on_kick(self, msg: IRCMessage, raw: str) -> None:
        if len(msg.params) >= 2 and msg.params[1].lower() == self._current_nick.lower():
            channel = msg.params[0]
            self._joined_channels.discard(channel)
            logger.warning("Kicked from %s by %s: %s", channel, msg.nick, msg.trailing)
            if self.irc.auto_rejoin:
                await asyncio.sleep(2)
                await self._send_raw(f"JOIN {channel}")

    async def _on_nick(self, msg: IRCMessage, raw: str) -> None:
        if msg.nick and msg.nick.lower() == self._current_nick.lower():
            self._current_nick = msg.params[0]

    async def _on_error(self, msg: IRCMessage, raw: str) -> None:
        logger.error("Server ERROR: %s", msg.trailing)
        raise ConnectionError(f"Server ERROR: {msg.trailing}")

    # ── IRCv3 features ───────────────────────────────────────────────

    async def _on_batch(self, msg: IRCMessage, raw: str) -> None:
        """Handle BATCH start/end for grouped messages."""
        if not msg.params:
            return
        ref = msg.params[0]
        if ref.startswith("+"):
            batch_id = ref[1:]
            self._batches[batch_id] = []
        elif ref.startswith("-"):
            batch_id = ref[1:]
            self._batches.pop(batch_id, None)

    async def _on_chghost(self, msg: IRCMessage, raw: str) -> None:
        """Handle IRCv3 CHGHOST (user/host change notification)."""
        pass  # Logged by default handler if needed

    async def _on_account(self, msg: IRCMessage, raw: str) -> None:
        """Handle IRCv3 account-notify."""
        pass

    async def _on_away(self, msg: IRCMessage, raw: str) -> None:
        """Handle IRCv3 away-notify."""
        pass

    # ── CTCP handling ────────────────────────────────────────────────

    async def _handle_ctcp(self, sender: str, target: str, ctcp: str) -> None:
        parts = ctcp.split(" ", 1)
        command = parts[0].upper()
        if command == "ACTION" and len(parts) > 1:
            # Treat /me actions as regular messages
            content = f"* {sender} {parts[1]}"
            is_private = target.lower() == self._current_nick.lower()
            await self.handle_incoming_message(
                sender=sender,
                target=target if not is_private else sender,
                content=content,
                is_private=is_private,
            )
        elif command == "VERSION":
            await self._send_raw(
                f"NOTICE {sender} :\x01VERSION kabAI IRC Connector\x01"
            )
        elif command == "PING":
            payload = parts[1] if len(parts) > 1 else ""
            await self._send_raw(f"NOTICE {sender} :\x01PING {payload}\x01")

    # ── Utilities ────────────────────────────────────────────────────

    def _split_message(self, content: str, target: str) -> list[str]:
        """Split a message into lines that fit within IRC limits."""
        # Calculate available space per line
        # PRIVMSG <target> :<content>\r\n
        overhead = len(f"PRIVMSG {target} :".encode("utf-8")) + 2
        # Also account for the :nick!user@host prefix the server adds (~80 bytes)
        max_content = min(self.irc.max_line_length, MAX_IRC_LINE - overhead - 80)

        lines = []
        # Split on newlines first
        for paragraph in content.split("\n"):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            while len(paragraph.encode("utf-8")) > max_content:
                # Find a good split point
                split_at = max_content
                # Try to split at a space
                space_pos = paragraph.rfind(" ", 0, split_at)
                if space_pos > split_at // 2:
                    split_at = space_pos
                lines.append(paragraph[:split_at].rstrip())
                paragraph = paragraph[split_at:].lstrip()
            if paragraph:
                lines.append(paragraph)

        return lines or [""]

    @staticmethod
    def _strip_formatting(text: str) -> str:
        """Remove IRC color and formatting codes."""
        # mIRC color codes: \x03[fg[,bg]]
        text = re.sub(r"\x03(\d{1,2}(,\d{1,2})?)?", "", text)
        # Bold, italic, underline, strikethrough, monospace, reverse, reset
        for code in (b"\x02", b"\x1d", b"\x1f", b"\x1e", b"\x11", b"\x16", b"\x0f"):
            text = text.replace(code.decode("latin-1"), "")
        return text
