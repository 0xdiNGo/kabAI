/**
 * Terminal renderer using xterm.js — pixel-perfect ANSI/mIRC rendering.
 * Canvas-based, handles all escape sequences natively.
 */

import { useEffect, useRef, useState } from "react";
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

export default function TerminalBlock({ text }: Props) {
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
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Write content — convert mIRC to ANSI if needed
    const content = hasMircCodes(text) ? mircToAnsi(text) : text;
    const contentLines = content.split("\n");
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i] ?? "";
      term.write(line);
      if (i < contentLines.length - 1) term.write("\r\n");
    }

    termRef.current = term;

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
}

export { hasMircCodes };
