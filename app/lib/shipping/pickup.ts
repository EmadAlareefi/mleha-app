/**
 * Big-batch pickup notice: when one carrier expects this many parcels, the live
 * dashboard tells the floor to call them and ask for a big truck.
 * Client-safe (no prisma) so the dashboard can share the limits.
 */
export const BIG_PICKUP_THRESHOLD_RANGE = { min: 5, max: 1000, default: 50 } as const;

/** Parcels a carrier will likely collect next: everything not on hold or broken. */
export function expectedPickup(row: { labelReady: number; awaitingLabel: number; inPrep: number }): number {
  return row.labelReady + row.awaitingLabel + row.inPrep;
}
