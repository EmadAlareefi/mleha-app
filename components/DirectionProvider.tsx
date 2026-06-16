'use client';

import type { ReactNode } from 'react';
import { Direction } from 'radix-ui';

/**
 * Provides RTL direction context to all Radix UI primitives app-wide.
 * Without this, primitives (Tabs, Popover, Select, cmdk, …) default their
 * internal direction to `ltr` and emit it onto their subtree — overriding
 * the document's `dir="rtl"` and breaking tab/dropdown alignment.
 */
export default function DirectionProvider({ children }: { children: ReactNode }) {
  return <Direction.Provider dir="rtl">{children}</Direction.Provider>;
}
