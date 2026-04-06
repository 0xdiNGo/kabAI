import { useEffect, useState } from "react";

interface ToastMessage {
  id: string;
  text: string;
  type: "error" | "success" | "info";
}

let _addToast: (text: string, type: ToastMessage["type"]) => void = () => {};

export function toast(text: string, type: ToastMessage["type"] = "info") {
  _addToast(text, type);
}

export function toastError(text: string) { toast(text, "error"); }
export function toastSuccess(text: string) { toast(text, "success"); }

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    _addToast = (text, type) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, text, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, type === "error" ? 6000 : 3000);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg px-4 py-3 text-sm shadow-lg animate-in slide-in-from-right ${
            t.type === "error"
              ? "bg-matrix-red/90 text-white"
              : t.type === "success"
                ? "bg-matrix-accent/90 text-matrix-bg"
                : "bg-matrix-card text-matrix-text-bright border border-matrix-text-faint/20"
          }`}
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
