/** Thresholds offered on the page, in hours. */
export const THRESHOLD_OPTIONS = [24, 48, 72, 168] as const;
export const DEFAULT_THRESHOLD_HOURS = 24;

export function parseThreshold(value: string | null | undefined): number {
  const hours = Number(value);
  return (THRESHOLD_OPTIONS as readonly number[]).includes(hours) ? hours : DEFAULT_THRESHOLD_HOURS;
}
