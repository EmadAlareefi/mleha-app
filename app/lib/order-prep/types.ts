/**
 * Shared shapes for order prep v2. Everything the packer's phone needs for an
 * order is built on the server in one pass (payload.ts) and stored with the
 * claim, so showing an order never needs another request.
 */

export type PrepItemOption = { name: string; value: string };

export type PrepItem = {
  /** Position in the Salla order's items. */
  index: number;
  /** Stable key for React and for item checks. */
  key: string;
  name: string;
  sku: string | null;
  quantity: number;
  imageUrl: string | null;
  size: string | null;
  color: string | null;
  options: PrepItemOption[];
  location: string | null;
  locationNote: string | null;
  productId: string | null;
};

export type PrepOrder = {
  orderId: string;
  orderNumber: string;
  /** Riyadh wall-clock time stored as if UTC (see riyadh-time.ts). */
  placedAt: string | null;
  isInternational: boolean;
  country: string | null;
  city: string | null;
  shippingCompany: string | null;
  tags: string[];
  gift: { flagged: boolean; message: string | null } | null;
  highPriority: boolean;
  isPromo: boolean;
  items: PrepItem[];
  totalUnits: number;
};

export type PrepSlotStatus = 'assigned' | 'preparing';

export type PrepAssignmentView = {
  assignmentId: string;
  status: PrepSlotStatus;
  assignedAt: string;
  startedAt: string | null;
  leaseExpiresAt: string | null;
  /** Set when a live Salla check found the order is no longer packable. */
  verifyIssue: string | null;
  order: PrepOrder;
};

export type QueueStats = {
  waiting: number;
  oldestPlacedAt: string | null;
  buckets: { lt24h: number; d1to2: number; d2to4: number; gt4d: number };
  generatedAt: string;
};

export type PrepState = {
  /** The order on screen. */
  current: PrepAssignmentView | null;
  /** The next order, already claimed and loaded. */
  next: PrepAssignmentView | null;
  stats: QueueStats;
  myCompletedToday: number;
};

export type ItemCheck = {
  index: number;
  sku: string | null;
  /** Units confirmed (scanned or tapped). */
  checked: number;
  method: 'scan' | 'manual';
};

export type ProblemReason = 'not_found' | 'damaged' | 'coming_soon' | 'other';

export type ProblemItem = {
  index: number;
  sku: string | null;
  name: string | null;
  reason: ProblemReason;
};

export type ActionError = {
  code: 'conflict' | 'not_found' | 'promo_limit' | 'invalid' | 'forbidden' | 'server';
  message: string;
};
