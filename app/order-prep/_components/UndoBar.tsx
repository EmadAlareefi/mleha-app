'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';

/** "Done" with a few seconds to take it back — instead of a confirmation dialog. */
export function UndoBar({ orderNumber, expiresAt, onUndo }: { orderNumber: string; expiresAt: number; onUndo: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return (
    <div className="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-background shadow-2xl">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
        <span className="flex-1 text-sm font-bold">
          تم الطلب <span dir="ltr" className="font-mono">#{orderNumber}</span>
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="flex items-center gap-1 rounded-xl bg-background px-3 py-2 text-sm font-bold text-foreground"
        >
          <Undo2 className="h-4 w-4" /> تراجع ({left})
        </button>
      </div>
    </div>
  );
}
