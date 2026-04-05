import { useState, useRef } from "react";

interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

export default function Tooltip({ text, children }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 400);
  };

  const handleLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  };

  return (
    <span className="relative inline-flex" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs text-matrix-text-bright bg-matrix-bg border border-matrix-border rounded-lg shadow-lg whitespace-normal max-w-xs z-50 pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
}

/** Inline help icon with tooltip */
export function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-matrix-input text-matrix-text-faint text-[10px] cursor-help ml-1 hover:text-matrix-text-dim">
        ?
      </span>
    </Tooltip>
  );
}
