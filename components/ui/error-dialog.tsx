'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ErrorDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  description?: string;
  variant?: 'error' | 'warning' | 'info';
}

export function ErrorDialog({
  open,
  onClose,
  title,
  message,
  description,
  variant = 'error',
}: ErrorDialogProps) {
  const variantStyles = {
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      titleColor: 'text-red-900',
      textColor: 'text-red-700',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      iconBg: 'bg-yellow-100',
      iconColor: 'text-yellow-600',
      titleColor: 'text-yellow-900',
      textColor: 'text-yellow-700',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      titleColor: 'text-blue-900',
      textColor: 'text-blue-700',
    },
  };

  const styles = variantStyles[variant];

  // Default titles in Arabic
  const defaultTitles = {
    error: 'خطأ',
    warning: 'تحذير',
    info: 'معلومة',
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-50 w-full max-w-md mx-4 transition-all duration-200 ease-out scale-100 opacity-100">
        <div className="bg-white rounded-lg shadow-xl overflow-hidden">
          {/* Content */}
          <div className={cn('p-6', styles.bg, 'border', styles.border)}>
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div
                className={cn(
                  'flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center',
                  styles.iconBg
                )}
              >
                {variant === 'error' && (
                  <svg
                    className={cn('w-6 h-6', styles.iconColor)}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                {variant === 'warning' && (
                  <svg
                    className={cn('w-6 h-6', styles.iconColor)}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                )}
                {variant === 'info' && (
                  <svg
                    className={cn('w-6 h-6', styles.iconColor)}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>

              {/* Text Content */}
              <div className="flex-1 pt-1">
                <h3
                  id="dialog-title"
                  className={cn('text-lg font-semibold mb-2', styles.titleColor)}
                >
                  {title || defaultTitles[variant]}
                </h3>
                <p className={cn('text-sm mb-1', styles.textColor)}>{message}</p>
                {description && (
                  <p className={cn('text-sm mt-2', styles.textColor, 'opacity-90')}>
                    {description}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3">
            <Button onClick={onClose} className="min-w-24">
              حسناً
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
