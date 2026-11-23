'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * One piece of page state kept in the query string, so reloads and shared
 * links land on the same view. The default value is left out of the URL.
 */
export function useUrlParam(key: string, fallback: string | null = null) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(key) ?? fallback;

  const set = useCallback(
    (next: string | null) => {
      // Read the live URL so two quick updates don't overwrite each other.
      const current = new URLSearchParams(window.location.search);
      if (next === null || next === fallback) current.delete(key);
      else current.set(key, next);
      const query = current.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [fallback, key, pathname, router],
  );

  return [value, set] as const;
}
