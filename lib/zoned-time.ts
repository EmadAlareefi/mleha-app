/** Wall-clock ↔ instant conversion for IANA time zones, via Intl (no time-zone library). */

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall-clock time `wallTimeMs` (fields read as UTC) occurs in `timeZone`. */
export function wallTimeToInstant(wallTimeMs: number, timeZone: string): Date {
  // Two passes settle DST transitions.
  let instant = wallTimeMs - zoneOffsetMs(new Date(wallTimeMs), timeZone);
  instant = wallTimeMs - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** `instant` shifted so its UTC fields read as the wall-clock time in `timeZone`. */
export function instantToWallTime(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
}
