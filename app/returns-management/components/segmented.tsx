'use client';

import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  tone?: 'return' | 'exchange' | 'neutral';
  disabled?: boolean;
}

const ACTIVE_TONE: Record<NonNullable<SegmentOption<string>['tone']>, string> = {
  return: 'bg-blue-600 text-white shadow-sm',
  exchange: 'bg-emerald-600 text-white shadow-sm',
  neutral: 'bg-card text-foreground shadow-sm',
};

interface SegmentedProps<T extends string> {
  value: T | null;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A radio group drawn as joined buttons (e.g. استرجاع | استبدال). Logical
 * spacing only, so it reads correctly right-to-left; 44px tall on phones.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  size = 'md',
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex w-full items-stretch gap-1 rounded-lg border bg-muted p-1 sm:w-auto', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || option.disabled}
            onClick={() => !active && onChange(option.value)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-md px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              size === 'md' ? 'min-h-11 text-sm sm:min-h-9' : 'min-h-10 text-xs sm:min-h-8',
              active ? ACTIVE_TONE[option.tone ?? 'neutral'] : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
