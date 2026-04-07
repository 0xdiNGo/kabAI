import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import Ansi from "ansi-to-react";
import MircRenderer, { hasMircCodes } from "@/components/MircRenderer";

// Override oneDark background to match gruvbox
const codeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: "#1d2021",
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: "#1d2021",
  },
};

// Detect ANSI escape sequences
const ANSI_REGEX = /\x1b\[[\d;]*m/;

function CodeBlock({ text, language }: { text: string; language: string | null }) {
  const hasAnsi = ANSI_REGEX.test(text);
  const hasMirc = hasMircCodes(text);
  const hasColors = hasAnsi || hasMirc;
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="relative group/code my-2">
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/code:opacity-100 transition-opacity z-10">
        {hasColors && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
          >
            {showRaw ? "Color" : "Raw"}
          </button>
        )}
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          Copy
        </button>
      </div>
      {hasMirc && !showRaw ? (
        <MircRenderer text={text} />
      ) : hasAnsi && !showRaw ? (
        <div
          className="overflow-x-auto rounded-lg font-mono text-[0.8rem] leading-relaxed whitespace-pre"
          style={{ background: "#1d2021", padding: "1rem" }}
        >
          <Ansi>{text}</Ansi>
        </div>
      ) : (
        <SyntaxHighlighter
          style={codeTheme}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: "0.5rem",
            fontSize: "0.8rem",
            background: "#1d2021",
            padding: "1rem",
          }}
          codeTagProps={{ style: { background: "transparent" } }}
        >
          {text}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

interface Props {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className = "" }: Props) {
  return (
    <ReactMarkdown
      className={`markdown-content ${className}`}
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className: codeClassName, children }) {
          const match = /language-(\w+)/.exec(codeClassName || "");
          const text = String(children);
          const hasNewlines = text.includes("\n");
          const isBlock = match || hasNewlines || text.length > 120;
          if (!isBlock) {
            return (
              <code className="rounded bg-matrix-bg/60 px-1.5 py-0.5 text-[0.85em] text-matrix-accent font-mono">
                {children}
              </code>
            );
          }
          return <CodeBlock text={text.replace(/\n$/, "")} language={match?.[1] || null} />;
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0 text-matrix-text-bright">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-matrix-text-bright">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1.5 mt-2 first:mt-0 text-matrix-text-bright">{children}</h3>;
        },
        ul({ children }) {
          return <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>;
        },
        li({ children }) {
          return <li className="text-sm">{children}</li>;
        },
        blockquote({ children }) {
          return <blockquote className="border-l-2 border-matrix-accent/50 pl-3 my-2 text-matrix-text-dim italic">{children}</blockquote>;
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-sm border-collapse">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="border-b border-matrix-text-faint/30">{children}</thead>;
        },
        th({ children }) {
          return <th className="px-3 py-1.5 text-left text-xs font-semibold text-matrix-text-bright">{children}</th>;
        },
        td({ children }) {
          return <td className="px-3 py-1.5 text-xs border-t border-matrix-text-faint/10">{children}</td>;
        },
        a({ href, children }) {
          return <a href={href} target="_blank" rel="noopener noreferrer" className="text-matrix-accent hover:underline">{children}</a>;
        },
        pre({ children }) {
          return <div className="my-2 overflow-x-auto">{children}</div>;
        },
        hr() {
          return <hr className="my-3 border-matrix-text-faint/20" />;
        },
        strong({ children }) {
          return <strong className="font-semibold text-matrix-text-bright">{children}</strong>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
