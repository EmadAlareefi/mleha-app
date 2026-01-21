'use client';

import { cn } from '@/lib/utils';
import { useToast } from './use-toast';

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3 px-4 sm:items-end sm:pr-6 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'w-full max-w-sm rounded-lg border p-4 shadow-lg bg-white text-gray-900 pointer-events-auto',
            toast.variant === 'destructive' && 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              {toast.title && <p className="text-sm font-semibold">{toast.title}</p>}
              {toast.description && (
                <p className="text-sm text-gray-600 mt-1">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-sm text-gray-400 hover:text-gray-600"
              aria-label="إغلاق التنبيه"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
