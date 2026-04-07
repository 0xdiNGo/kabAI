/**
 * mIRC color code renderer.
 *
 * Parses mIRC-style color codes and renders colored text:
 *   \x03FG,BG  — set foreground/background color (0-15)
 *   \x03FG     — set foreground only
 *   \x03       — reset colors
 *   \x0F       — reset all formatting
 *   \x02       — toggle bold
 *   \x1F       — toggle underline
 *   \x1D       — toggle italic
 *   \x16       — toggle reverse (swap fg/bg)
 *
 * Since LLMs can't output actual control characters, we parse
 * the escaped text representations: \\x03, \\x0F, etc.
 */

const MIRC_COLORS: Record<number, string> = {
  0: "#ffffff",  // white
  1: "#000000",  // black
  2: "#00007f",  // navy
  3: "#009300",  // green
  4: "#ff0000",  // red
  5: "#7f0000",  // brown/maroon
  6: "#9c009c",  // purple
  7: "#fc7f00",  // orange
  8: "#ffff00",  // yellow
  9: "#00fc00",  // light green
  10: "#009393", // teal
  11: "#00ffff", // cyan
  12: "#0000fc", // blue
  13: "#ff00ff", // pink/magenta
  14: "#7f7f7f", // grey
  15: "#d2d2d2", // light grey
};

interface Span {
  text: string;
  fg?: number;
  bg?: number;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  reverse?: boolean;
}

function parseMirc(input: string): Span[] {
  const spans: Span[] = [];
  let fg: number | undefined;
  let bg: number | undefined;
  let bold = false;
  let underline = false;
  let italic = false;
  let reverse = false;
  let current = "";

  // Replace escaped control codes with actual Unicode markers we can parse
  // LLMs output \\x03, \\x0F etc as text
  const normalized = input
    .replace(/\\x03/gi, "\x03")
    .replace(/\\x0F/gi, "\x0F")
    .replace(/\\x02/gi, "\x02")
    .replace(/\\x1F/gi, "\x1F")
    .replace(/\\x1D/gi, "\x1D")
    .replace(/\\x16/gi, "\x16");

  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === "\x03") {
      // Color code
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }

      i++;
      // Parse foreground
      const fgMatch = normalized.slice(i).match(/^(\d{1,2})/);
      if (fgMatch && fgMatch[1]) {
        fg = parseInt(fgMatch[1], 10);
        i += fgMatch[1].length;

        // Parse optional background
        if (normalized[i] === ",") {
          i++;
          const bgMatch = normalized.slice(i).match(/^(\d{1,2})/);
          if (bgMatch && bgMatch[1]) {
            bg = parseInt(bgMatch[1], 10);
            i += bgMatch[1].length;
          }
        }
      } else {
        // Bare \x03 resets colors
        fg = undefined;
        bg = undefined;
      }
    } else if (ch === "\x0F") {
      // Reset all
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }
      fg = undefined;
      bg = undefined;
      bold = false;
      underline = false;
      italic = false;
      reverse = false;
      i++;
    } else if (ch === "\x02") {
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }
      bold = !bold;
      i++;
    } else if (ch === "\x1F") {
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }
      underline = !underline;
      i++;
    } else if (ch === "\x1D") {
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }
      italic = !italic;
      i++;
    } else if (ch === "\x16") {
      if (current) {
        spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
        current = "";
      }
      reverse = !reverse;
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current) {
    spans.push({ text: current, fg, bg, bold, underline, italic, reverse });
  }

  return spans;
}

// Detect if text contains mIRC color codes
export function hasMircCodes(text: string): boolean {
  return /\\x0[23F]|\\x1[DF]|\\x16/i.test(text);
}

export default function MircRenderer({ text }: { text: string }) {
  const spans = parseMirc(text);

  return (
    <div
      className="overflow-x-auto rounded-lg font-mono text-[0.8rem] leading-snug whitespace-pre"
      style={{ background: "#1d2021", padding: "1rem" }}
    >
      {spans.map((span, i) => {
        const fgColor = span.reverse
          ? (span.bg !== undefined ? MIRC_COLORS[span.bg] : "#1d2021")
          : (span.fg !== undefined ? MIRC_COLORS[span.fg] : undefined);
        const bgColor = span.reverse
          ? (span.fg !== undefined ? MIRC_COLORS[span.fg] : undefined)
          : (span.bg !== undefined ? MIRC_COLORS[span.bg] : undefined);

        return (
          <span
            key={i}
            style={{
              color: fgColor,
              backgroundColor: bgColor,
              fontWeight: span.bold ? "bold" : undefined,
              textDecoration: span.underline ? "underline" : undefined,
              fontStyle: span.italic ? "italic" : undefined,
            }}
          >
            {span.text}
          </span>
        );
      })}
    </div>
  );
}
