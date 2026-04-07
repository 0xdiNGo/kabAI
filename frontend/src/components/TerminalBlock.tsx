/**
 * Terminal renderer using xterm.js — pixel-perfect ANSI/mIRC rendering.
 * Canvas-based, handles all escape sequences natively.
 */

import { memo, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// mIRC color index → ANSI 256-color index
const MIRC_TO_ANSI: Record<number, number> = {
  0: 15,   // white
  1: 0,    // black
  2: 4,    // navy
  3: 2,    // green
  4: 1,    // red
  5: 52,   // brown
  6: 5,    // purple
  7: 208,  // orange
  8: 11,   // yellow
  9: 10,   // lime
  10: 6,   // teal
  11: 14,  // cyan
  12: 12,  // blue
  13: 13,  // pink
  14: 8,   // grey
  15: 7,   // light grey
};

/** Convert mIRC color codes (\x03FG,BG) to ANSI SGR sequences */
function mircToAnsi(text: string): string {
  // First convert escaped representations to markers
  let s = text
    .replace(/\\x03/gi, "\x03")
    .replace(/\\x0F/gi, "\x0F")
    .replace(/\\x02/gi, "\x02")
    .replace(/\\x1F/gi, "\x1F")
    .replace(/\\x1D/gi, "\x1D")
    .replace(/\\x16/gi, "\x16");

  // Convert mIRC codes to ANSI
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x03") {
      i++;
      const m = s.slice(i).match(/^(\d{1,2})/);
      if (m && m[1]) {
        const fg = parseInt(m[1], 10);
        i += m[1].length;
        const ansiFg = MIRC_TO_ANSI[fg] ?? fg;
        result += `\x1b[38;5;${ansiFg}m`;

        if (s[i] === ",") {
          i++;
          const bm = s.slice(i).match(/^(\d{1,2})/);
          if (bm && bm[1]) {
            const bg = parseInt(bm[1], 10);
            i += bm[1].length;
            const ansiBg = MIRC_TO_ANSI[bg] ?? bg;
            result += `\x1b[48;5;${ansiBg}m`;
          }
        }
      } else {
        result += "\x1b[0m"; // bare \x03 = reset
      }
    } else if (s[i] === "\x0F") {
      result += "\x1b[0m";
      i++;
    } else if (s[i] === "\x02") {
      result += "\x1b[1m";
      i++;
    } else if (s[i] === "\x1F") {
      result += "\x1b[4m";
      i++;
    } else if (s[i] === "\x1D") {
      result += "\x1b[3m";
      i++;
    } else if (s[i] === "\x16") {
      result += "\x1b[7m";
      i++;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

function hasMircCodes(text: string): boolean {
  return /\\x0[23F]|\\x1[DF]|\\x16/i.test(text);
}

/** Count visible characters in a line after stripping mIRC/ANSI control codes */
function countVisible(line: string): number {
  let s = line
    .replace(/\\x03/gi, "\x03")
    .replace(/\\x0F/gi, "\x0F")
    .replace(/\\x02/gi, "\x02")
    .replace(/\\x1[DF]/gi, "")
    .replace(/\\x16/gi, "");
  // Strip mIRC color codes
  s = s.replace(/\x03(\d{1,2}(,\d{1,2})?)?/g, "");
  // Strip ANSI SGR sequences
  s = s.replace(/\x1b\[[\d;]*m/g, "");
  // Strip remaining controls
  s = s.replace(/[\x02\x0F\x1D\x1F\x16]/g, "");
  return s.length;
}

/** Normalize all lines to exactly targetWidth visible chars */
function normalizeLines(text: string, targetWidth = 80): string {
  const lines = text.split("\n");
  if (lines.length < 2) return text;

  return lines.map((line) => {
    const vis = countVisible(line);
    if (vis === targetWidth) return line;
    if (vis > targetWidth) {
      // Truncate from the end — remove visible chars but keep trailing reset
      return truncateLine(line, targetWidth);
    }
    // Pad with spaces before any trailing \x0F
    const resetSuffix = line.match(/((?:\\x0F)+)$/i);
    if (resetSuffix) {
      const base = line.slice(0, -resetSuffix[0].length);
      return base + " ".repeat(targetWidth - vis) + resetSuffix[0];
    }
    return line + " ".repeat(targetWidth - vis);
  }).join("\n");
}

/** Truncate a line to exactly targetWidth visible chars, preserving control codes */
function truncateLine(line: string, targetWidth: number): string {
  // Normalize escapes
  const norm = line
    .replace(/\\x03/gi, "\x03")
    .replace(/\\x0F/gi, "\x0F")
    .replace(/\\x02/gi, "\x02")
    .replace(/\\x1F/gi, "\x1F")
    .replace(/\\x1D/gi, "\x1D")
    .replace(/\\x16/gi, "\x16");

  let result = "";
  let visCount = 0;
  let i = 0;
  while (i < norm.length && visCount < targetWidth) {
    if (norm[i] === "\x03") {
      result += norm[i]; i++;
      // Consume digits and comma
      const m = norm.slice(i).match(/^(\d{1,2}(,\d{1,2})?)/);
      if (m) { result += m[0]; i += m[0].length; }
    } else if (norm[i] !== undefined && "\x02\x0F\x1D\x1F\x16".includes(norm[i] as string)) {
      result += norm[i] as string; i++;
    } else if (norm[i] === "\x1b" && norm[i + 1] === "[") {
      // ANSI sequence — copy through
      const end = norm.indexOf("m", i);
      if (end !== -1) { result += norm.slice(i, end + 1); i = end + 1; }
      else { result += norm[i]; i++; }
    } else {
      result += norm[i]; i++;
      visCount++;
    }
  }
  result += "\x0F"; // Ensure reset at end
  // Convert back to escaped form for consistency
  return result
    .replace(/\x03/g, "\\x03")
    .replace(/\x0F/g, "\\x0F")
    .replace(/\x02/g, "\\x02")
    .replace(/\x1F/g, "\\x1F")
    .replace(/\x1D/g, "\\x1D")
    .replace(/\x16/g, "\\x16");
}

const GRUVBOX_THEME = {
  background: "#1d2021",
  foreground: "#ebdbb2",
  cursor: "#1d2021", // hide cursor
  cursorAccent: "#1d2021",
  selectionBackground: "#504945",
  black: "#1d2021",
  red: "#cc241d",
  green: "#98971a",
  yellow: "#d79921",
  blue: "#458588",
  magenta: "#b16286",
  cyan: "#689d6a",
  white: "#a89984",
  brightBlack: "#928374",
  brightRed: "#fb4934",
  brightGreen: "#b8bb26",
  brightYellow: "#fabd2f",
  brightBlue: "#83a598",
  brightMagenta: "#d3869b",
  brightCyan: "#8ec07c",
  brightWhite: "#ebdbb2",
};

interface Props {
  text: string;
}

const TerminalBlock = memo(function TerminalBlock({ text }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const lines = text.split("\n");
    const maxCols = Math.max(80, ...lines.map((l) => l.length));

    const term = new Terminal({
      theme: GRUVBOX_THEME,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      cols: Math.min(maxCols, 120),
      rows: lines.length + 1,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      disableStdin: true,
      scrollback: 0,
      convertEol: true,
      overviewRulerWidth: 0,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Write content — convert mIRC to ANSI if needed
    // Normalize all lines to exactly 80 visible chars, then convert to ANSI
    const normalized = hasMircCodes(text) ? normalizeLines(text) : text;
    const content = hasMircCodes(normalized) ? mircToAnsi(normalized) : normalized;
    const contentLines = content.split("\n");
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i] ?? "";
      term.write(line);
      if (i < contentLines.length - 1) term.write("\r\n");
    }

    termRef.current = term;

    // Disable xterm scroll wheel capture — let page scroll through
    // xterm's viewport listens for wheel events; we override by making
    // the viewport non-interactive
    const viewport = containerRef.current?.querySelector(".xterm-viewport");
    if (viewport) {
      (viewport as HTMLElement).style.pointerEvents = "none";
    }

    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, [text, showRaw]);

  return (
    <div className="relative group/term my-2">
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/term:opacity-100 transition-opacity z-10">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          {showRaw ? "Render" : "Raw"}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          Copy
        </button>
      </div>
      {showRaw ? (
        <pre
          className="overflow-x-auto rounded-lg text-[0.8rem] whitespace-pre p-4"
          style={{ background: "#1d2021", color: "#ebdbb2" }}
        >
          {text}
        </pre>
      ) : (
        <div
          ref={containerRef}
          className="rounded-lg overflow-hidden"
          style={{ background: "#1d2021", padding: "0.5rem" }}
        />
      )}
    </div>
  );
});

export default TerminalBlock;
export { hasMircCodes };
