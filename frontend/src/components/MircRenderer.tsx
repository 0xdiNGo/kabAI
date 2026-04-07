/**
 * mIRC ASCII Art Viewer — Raw / Rendered / Validate modes.
 *
 * RAW: Shows literal control codes as \x03, \x0F text. Line numbers + char counts.
 * RENDERED: Interprets mIRC color codes and displays colored output.
 * VALIDATE: Shows per-line visible character counts, flags lines != 80.
 */

import { useState } from "react";

const MIRC_COLORS: Record<number, string> = {
  0: "#ffffff",   // white
  1: "#000000",   // black
  2: "#00007f",   // navy/blue
  3: "#009300",   // green
  4: "#ff0000",   // red
  5: "#7f0000",   // brown/maroon
  6: "#9c009c",   // purple
  7: "#fc7f00",   // orange
  8: "#ffff00",   // yellow
  9: "#00fc00",   // light green
  10: "#009393",  // cyan
  11: "#00ffff",  // light cyan
  12: "#0000fc",  // blue
  13: "#ff00ff",  // pink/magenta
  14: "#7f7f7f",  // grey
  15: "#d2d2d2",  // light grey
};

const MONO_STYLE: React.CSSProperties = {
  background: "#1d2021",
  padding: "1rem",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: "0.8rem",
  lineHeight: "1.25",
};

// --- Parsing ---

interface Span {
  text: string;
  fg?: number;
  bg?: number;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  reverse?: boolean;
}

function normalize(input: string): string {
  return input
    .replace(/\\x03/gi, "\x03")
    .replace(/\\x0F/gi, "\x0F")
    .replace(/\\x02/gi, "\x02")
    .replace(/\\x1F/gi, "\x1F")
    .replace(/\\x1D/gi, "\x1D")
    .replace(/\\x16/gi, "\x16");
}

function parseMirc(input: string): Span[] {
  const spans: Span[] = [];
  let fg: number | undefined;
  let bg: number | undefined;
  let bold = false, underline = false, italic = false, reverse = false;
  let current = "";
  const norm = normalize(input);

  const flush = () => {
    if (current) { spans.push({ text: current, fg, bg, bold, underline, italic, reverse }); current = ""; }
  };

  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === "\x03") {
      flush(); i++;
      const m = norm.slice(i).match(/^(\d{1,2})/);
      if (m && m[1]) {
        fg = parseInt(m[1], 10); i += m[1].length;
        if (norm[i] === ",") {
          i++;
          const bm = norm.slice(i).match(/^(\d{1,2})/);
          if (bm && bm[1]) { bg = parseInt(bm[1], 10); i += bm[1].length; }
        }
      } else { fg = undefined; bg = undefined; }
    } else if (ch === "\x0F") { flush(); fg = bg = undefined; bold = underline = italic = reverse = false; i++; }
    else if (ch === "\x02") { flush(); bold = !bold; i++; }
    else if (ch === "\x1F") { flush(); underline = !underline; i++; }
    else if (ch === "\x1D") { flush(); italic = !italic; i++; }
    else if (ch === "\x16") { flush(); reverse = !reverse; i++; }
    else { current += ch; i++; }
  }
  flush();
  return spans;
}

// --- Visible character counting ---

function countVisible(rawLine: string): number {
  // First normalize escapes to actual control chars
  let s = normalize(rawLine);
  // Strip color codes: \x03 followed by optional FG[,BG]
  s = s.replace(/\x03(\d{1,2}(,\d{1,2})?)?/g, "");
  // Strip other controls
  s = s.replace(/[\x02\x0F\x1D\x1F\x16]/g, "");
  return s.length;
}

function padLines(text: string, target = 80): string {
  const lines = text.split("\n");
  const max = Math.max(...lines.map(countVisible), target);
  return lines.map((l) => {
    const vis = countVisible(l);
    return vis < max ? l + " ".repeat(max - vis) : l;
  }).join("\n");
}

// --- Detect mIRC codes ---

export function hasMircCodes(text: string): boolean {
  return /\\x0[23F]|\\x1[DF]|\\x16/i.test(text);
}

// --- Rendered View ---

function RenderedView({ text }: { text: string }) {
  const padded = padLines(text);
  const lines = padded.split("\n");
  // Find the consistent width for all lines
  const lineWidth = Math.max(...lines.map(countVisible), 80);

  return (
    <div className="overflow-x-auto rounded-lg" style={MONO_STYLE}>
      {lines.map((line, li) => {
        const spans = parseMirc(line);
        return (
          <div
            key={li}
            style={{
              width: `${lineWidth}ch`,
              whiteSpace: "pre",
              height: "1.25em",
              overflow: "hidden",
            }}
          >
            {spans.map((span, si) => {
              const fgc = span.reverse
                ? (span.bg !== undefined ? MIRC_COLORS[span.bg] : "#1d2021")
                : (span.fg !== undefined ? MIRC_COLORS[span.fg] : undefined);
              const bgc = span.reverse
                ? (span.fg !== undefined ? MIRC_COLORS[span.fg] : undefined)
                : (span.bg !== undefined ? MIRC_COLORS[span.bg] : undefined);
              return (
                <span key={si} style={{
                  color: fgc, backgroundColor: bgc,
                  fontWeight: span.bold ? "bold" : undefined,
                  textDecoration: span.underline ? "underline" : undefined,
                  fontStyle: span.italic ? "italic" : undefined,
                }}>{span.text}</span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// --- Raw View ---

function RawView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="overflow-x-auto rounded-lg whitespace-pre" style={MONO_STYLE}>
      {lines.map((line, i) => {
        const vis = countVisible(line);
        const ok = vis === 80;
        return (
          <div key={i} className="flex">
            <span className="select-none text-matrix-text-faint w-8 text-right pr-2 shrink-0"
              style={{ fontSize: "0.7rem", lineHeight: "1.25" }}>
              {i + 1}
            </span>
            <span className="flex-1">{line}</span>
            <span className={`select-none pl-2 shrink-0 ${ok ? "text-matrix-accent" : "text-matrix-red"}`}
              style={{ fontSize: "0.7rem", lineHeight: "1.25" }}>
              [{vis}]{ok ? " \u2713" : " \u2717"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Validate View ---

function ValidateView({ text }: { text: string }) {
  const lines = text.split("\n");
  const issues: string[] = [];
  lines.forEach((line, i) => {
    const vis = countVisible(line);
    if (vis !== 80) issues.push(`Line ${i + 1}: ${vis} chars (expected 80)`);
  });

  return (
    <div className="overflow-x-auto rounded-lg whitespace-pre" style={MONO_STYLE}>
      <div className="mb-2">
        <span className="text-matrix-text-bright font-bold">Validation: </span>
        {issues.length === 0 ? (
          <span className="text-matrix-accent">All {lines.length} lines are exactly 80 visible characters.</span>
        ) : (
          <span className="text-matrix-red">{issues.length} line{issues.length > 1 ? "s" : ""} with width issues:</span>
        )}
      </div>
      {issues.length > 0 && (
        <div className="mb-3">
          {issues.map((issue, i) => (
            <div key={i} className="text-matrix-red">{issue}</div>
          ))}
        </div>
      )}
      <div className="border-t border-matrix-text-faint/20 pt-2">
        {lines.map((line, i) => {
          const vis = countVisible(line);
          const ok = vis === 80;
          return (
            <div key={i} className="flex">
              <span className={`select-none w-10 text-right pr-2 shrink-0 ${ok ? "text-matrix-text-faint" : "text-matrix-red font-bold"}`}
                style={{ fontSize: "0.7rem" }}>
                {vis}
              </span>
              <span className="flex-1">
                {ok ? (
                  <span className="text-matrix-text-dim">{line.replace(/./g, "\u2500")}</span>
                ) : (
                  <>
                    <span className="text-matrix-text">{line}</span>
                    {vis < 80 && <span className="text-matrix-red bg-matrix-red/20">{"\u2592".repeat(80 - vis)}</span>}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main Viewer ---

type ViewMode = "rendered" | "raw" | "validate";

export default function MircRenderer({ text }: { text: string }) {
  const [mode, setMode] = useState<ViewMode>("rendered");

  return (
    <div className="relative group/mirc my-2">
      {/* Mode tabs + Copy */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/mirc:opacity-100 transition-opacity z-10">
        {(["rendered", "raw", "validate"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
              mode === m
                ? "bg-matrix-accent/30 text-matrix-accent"
                : "bg-matrix-bg/70 text-matrix-text-faint hover:text-matrix-text-bright"
            }`}
          >
            {m === "rendered" ? "Preview" : m === "raw" ? "Raw" : "Validate"}
          </button>
        ))}
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          Copy Raw
        </button>
      </div>

      {mode === "rendered" && <RenderedView text={text} />}
      {mode === "raw" && <RawView text={text} />}
      {mode === "validate" && <ValidateView text={text} />}
    </div>
  );
}
