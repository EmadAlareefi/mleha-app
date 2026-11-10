'use client';

import type { RefObject } from 'react';
import { CameraOff } from 'lucide-react';

/** The live camera view while scanning; stays open across orders until closed. */
export function ScannerPanel({
  videoRef,
  active,
  onClose,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  onClose: () => void;
}) {
  if (!active) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 px-3">
      <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500 bg-black shadow-2xl">
        <video ref={videoRef} className="h-40 w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
        <button
          type="button"
          onClick={onClose}
          className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white"
        >
          <CameraOff className="h-4 w-4" /> إيقاف
        </button>
        <p className="absolute inset-x-0 bottom-1 text-center text-xs font-semibold text-white/90">وجّه الكاميرا إلى باركود البطاقة</p>
      </div>
    </div>
  );
}
