'use client';

import { ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

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

// Built on the Radix Dialog so it portals and layers correctly when opened
// from inside another Radix layer (a Sheet or Dialog). A plain fixed div ends
// up under the open sheet and Radix blocks pointer events outside its layer.
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
  const confirmButtonVariant = confirmVariant === 'danger' ? 'destructive' : 'default';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden bg-white p-0 shadow-xl sm:max-w-md"
      >
        <div className="p-6">
          <DialogTitle className="mb-2 text-lg font-semibold text-gray-900">{title}</DialogTitle>
          {message ? (
            <DialogDescription className="text-sm leading-relaxed text-gray-600">{message}</DialogDescription>
          ) : null}
          {content}
        </div>
        <div className="flex justify-end gap-3 bg-gray-50 px-6 py-4">
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
      </DialogContent>
    </Dialog>
  );
}
