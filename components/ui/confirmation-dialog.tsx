'use client';

import { ReactNode } from 'react';
import { Button } from './button';

type ConfirmationVariant = 'primary' | 'danger';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ConfirmationVariant;
  onConfirm: () => void;
  onCancel: () => void;
  content?: ReactNode;
  confirmDisabled?: boolean;
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  content,
  confirmDisabled = false,
}: ConfirmationDialogProps) {
  if (!open) {
    return null;
  }

  const confirmButtonVariant = confirmVariant === 'danger' ? 'destructive' : 'default';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div className="relative z-50 w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl overflow-hidden">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
            {message ? <p className="text-sm text-gray-600 leading-relaxed">{message}</p> : null}
            {content}
          </div>
          <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3">
            <Button variant="outline" onClick={onCancel} className="min-w-28">
              {cancelLabel}
            </Button>
            <Button
              variant={confirmButtonVariant}
              onClick={onConfirm}
              className="min-w-28"
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
