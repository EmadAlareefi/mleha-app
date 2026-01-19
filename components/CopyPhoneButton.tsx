'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface CopyPhoneButtonProps {
  phone?: string | null;
}

const normalizePhone = (value?: string | null): string => {
  if (!value) return '';
  const digits = value.replace(/\D+/g, '');
  if (!digits) return '';
  let trimmed = digits;

  if (trimmed.startsWith('00966')) {
    trimmed = trimmed.slice(5);
  } else if (trimmed.startsWith('966')) {
    trimmed = trimmed.slice(3);
  }

  trimmed = trimmed.replace(/^0+/, '');
  if (!trimmed) {
    return '966';
  }
  return `966${trimmed}`;
};

export function CopyPhoneButton({ phone }: CopyPhoneButtonProps) {
  const [copied, setCopied] = useState(false);
  const normalized = normalizePhone(phone);
  const disabled = !normalized || normalized.length <= 3;

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy phone number', err);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="نسخ رقم الهاتف مع مقدمة 966"
        onClick={handleCopy}
        disabled={disabled}
        className="h-7 w-7"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </Button>
      {copied && (
        <span className="text-xs text-green-600 font-medium">تم النسخ</span>
      )}
    </div>
  );
}
