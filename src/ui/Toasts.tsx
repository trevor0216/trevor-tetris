import { useCallback, useRef, useState } from "react";
import type { Toast } from "../modes/freeplay";

interface Live extends Toast {
  id: number;
}

const LIFETIME_MS = 1600;

export function useToasts(): [Live[], (t: Toast[]) => void] {
  const [toasts, setToasts] = useState<Live[]>([]);
  const nextId = useRef(0);
  const push = useCallback((items: Toast[]) => {
    if (!items.length) return;
    const live = items.map((t) => ({ ...t, id: nextId.current++ }));
    setToasts((prev) => [...prev, ...live].slice(-6));
    const ids = new Set(live.map((t) => t.id));
    setTimeout(() => setToasts((prev) => prev.filter((t) => !ids.has(t.id))), LIFETIME_MS);
  }, []);
  return [toasts, push];
}

export function ToastStack({ toasts }: { toasts: Live[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
