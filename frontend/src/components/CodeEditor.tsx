/**
 * Read-only Monaco Editor for code blocks in chat.
 * Syntax highlighting, line numbers, gruvbox theme.
 */

import { memo, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

// Language map: markdown fence tags → Monaco language IDs
const LANG_MAP: Record<string, string> = {
  js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
  cs: "csharp", cpp: "cpp", c: "c", sh: "shell", bash: "shell",
  zsh: "shell", fish: "shell", ps1: "powershell", sql: "sql",
  html: "html", css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
  xml: "xml", md: "markdown", dockerfile: "dockerfile",
  makefile: "plaintext", terraform: "hcl", tf: "hcl",
};

function resolveLanguage(lang: string | null): string {
  if (!lang) return "plaintext";
  const lower = lang.toLowerCase();
  return LANG_MAP[lower] || lower;
}

interface Props {
  text: string;
  language: string | null;
  onExport?: (content: string, format: string) => void;
}

const CodeEditor = memo(function CodeEditor({ text, language, onExport }: Props) {
  const editorRef = useRef<ReturnType<OnMount> extends void ? never : Parameters<OnMount>[0]>(null);
  const lines = text.split("\n").length;
  const height = Math.min(Math.max(lines * 19 + 16, 60), 500);

  const handleMount: OnMount = (editor, monaco) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef as any).current = editor;

    // Register gruvbox theme
    monaco.editor.defineTheme("gruvbox-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "928374", fontStyle: "italic" },
        { token: "keyword", foreground: "fb4934" },
        { token: "string", foreground: "b8bb26" },
        { token: "number", foreground: "d3869b" },
        { token: "type", foreground: "fabd2f" },
      ],
      colors: {
        "editor.background": "#1d2021",
        "editor.foreground": "#ebdbb2",
        "editor.lineHighlightBackground": "#28282800",
        "editorLineNumber.foreground": "#504945",
        "editorLineNumber.activeForeground": "#928374",
        "editor.selectionBackground": "#504945",
        "editorCursor.foreground": "#ebdbb2",
      },
    });
    monaco.editor.setTheme("gruvbox-dark");
  };

  const copyMarkdown = () => {
    const lang = language || "";
    navigator.clipboard.writeText(`\`\`\`${lang}\n${text}\n\`\`\``);
  };

  return (
    <div className="relative group/editor my-2 rounded-lg overflow-hidden" style={{ background: "#1d2021" }}>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/editor:opacity-100 transition-opacity z-10">
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          Copy
        </button>
        <button
          onClick={copyMarkdown}
          className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
        >
          Copy MD
        </button>
        {onExport && (
          <button
            onClick={() => onExport(text, language || "plaintext")}
            className="rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint hover:text-matrix-text-bright"
          >
            Export
          </button>
        )}
      </div>
      <Editor
        height={height}
        language={resolveLanguage(language)}
        value={text}
        theme="vs-dark"
        onMount={handleMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: lines > 3 ? "on" : "off",
          folding: false,
          fontSize: 13,
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: {
            vertical: lines > 25 ? "auto" : "hidden",
            horizontal: "auto",
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
            handleMouseWheel: false,
          },
          padding: { top: 8, bottom: 8 },
          domReadOnly: true,
          contextmenu: false,
        }}
      />
    </div>
  );
});

export default CodeEditor;
