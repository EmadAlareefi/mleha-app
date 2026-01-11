/**
 * Statuses that represent active order assignments which should block
 * auto-assignment for other users until they are completed or removed.
 */
export const ACTIVE_ASSIGNMENT_STATUSES = [
  'assigned',
  'preparing',
  'prepared',
  'shipped',
  'under_review',
  'under_review_reservation',
] as const;

export type ActiveAssignmentStatus = (typeof ACTIVE_ASSIGNMENT_STATUSES)[number];

export const isActiveAssignmentStatus = (
  status?: string | null,
): status is ActiveAssignmentStatus =>
  Boolean(status && (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status));
