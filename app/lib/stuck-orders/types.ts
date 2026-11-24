/**
 * Stuck orders: an order (or a customer return) that stopped moving somewhere
 * inside the warehouse. Everything here is plain data so the classifier stays
 * pure and the client can import the types.
 */

export type StuckCategory =
  | 'sync_failed'
  | 'prep_stopped'
  | 'waiting_queue'
  | 'prep_abandoned'
  | 'packed_no_shipping'
  | 'shipping_stuck'
  | 'label_not_shipped'
  | 'cancelled_in_warehouse'
  | 'unknown_stuck'
  | 'return_unprocessed';

/** Pipeline steps drawn on every card, in order. */
export type StageKey = 'placed' | 'prep' | 'packed' | 'label' | 'printed' | 'scanned' | 'shipped';
export type ReturnStageKey = 'requested' | 'received' | 'processing' | 'done';

export type Severity = 'ok' | 'warn' | 'critical';

export type StuckAction =
  | 'requeue_escalation'
  | 'resolve_escalation'
  | 'retry_sync'
  | 'dismiss_sync'
  | 'retry_task'
  | 'close_task';

export type ActionTarget = { action: StuckAction; targetId: string };

/** Everything we know about one order across the warehouse tables. Dates are ISO strings. */
export type OrderSnapshot = {
  orderId: string;
  orderNumber: string | null;
  referenceId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerCity: string | null;
  statusSlug: string | null;
  statusCustomId: string | null;
  statusName: string | null;
  placedAt: string | null;
  updatedAtRemote: string | null;
  trackingNumber: string | null;
  prep: {
    status: string;
    userId: string;
    userName: string;
    assignedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    verifyIssue: string | null;
  } | null;
  escalations: Array<{
    id: string;
    reason: string;
    statusTarget: string | null;
    notes: string | null;
    createdAt: string;
    createdByName: string | null;
    resolvedAt: string | null;
    resolvedByName: string | null;
  }>;
  syncJobs: Array<{
    id: string;
    kind: string;
    state: string;
    targetStatusId: number;
    lastError: string | null;
    liveStatus: string | null;
    note: string | null;
    createdAt: string;
    syncedAt: string | null;
    createdByName: string | null;
  }>;
  task: {
    id: string;
    method: string;
    state: string;
    lastError: string | null;
    blockReason: string | null;
    attempts: number;
    createdAt: string;
    creatingAt: string | null;
    labelReadyAt: string | null;
    printedAt: string | null;
    printedById: string | null;
    printedByName: string | null;
    updatedAt: string;
  } | null;
  sallaShipment: {
    trackingNumber: string;
    courierName: string;
    status: string;
    createdAt: string;
    labelPrintedAt: string | null;
    labelPrintedByName: string | null;
  } | null;
  localShipment: {
    trackingNumber: string;
    status: string;
    createdAt: string;
    deliveredAt: string | null;
    cancelledAt: string | null;
    pickedUpAt: string | null;
    agentAssignedAt: string | null;
  } | null;
  /** Outgoing warehouse scan of the order's tracking number. */
  scan: { scannedAt: string; scannedBy: string | null; handoverScannedAt: string | null; handoverScannedBy: string | null } | null;
  /** First time each Salla status slug was seen by the webhook. */
  statusEvents: Array<{ status: string; receivedAt: string }>;
  doNotShip: { notes: string | null; createdAt: string; createdByName: string | null } | null;
  customerHold: { kind: string; state: string; createdAt: string } | null;
};

export type ReturnSnapshot = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  processingStatus: string;
  refundStatus: string;
  smsaTrackingNumber: string | null;
  createdAt: string;
  receivedAt: string | null;
  processedAt: string | null;
  updatedAt: string;
};

export type Diagnosis = {
  stuck: boolean;
  category: StuckCategory | null;
  /** Where in the pipeline the order is now. */
  stage: StageKey | ReturnStageKey;
  sinceAt: string | null;
  ageMs: number | null;
  severity: Severity;
  /** One Arabic sentence: what happened and where it stopped. */
  reason: string;
  /** Held on purpose (do-not-ship flag, customer hold, reservation). */
  held: string | null;
  lastActor: string | null;
  actions: ActionTarget[];
};

export type StuckItem = {
  /** `order:<orderId>` or `return:<id>`. */
  key: string;
  kind: 'order' | 'return';
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  customerCity: string | null;
  statusName: string | null;
  trackingNumber: string | null;
  reached: string[];
  diagnosis: Diagnosis;
  returnId?: string;
};

export type CategorySummary = { count: number; critical: number; oldestAgeMs: number | null };

export type StuckOrdersResult = {
  generatedAt: string;
  thresholdHours: number;
  counts: Partial<Record<StuckCategory, CategorySummary>>;
  heldCount: number;
  items: StuckItem[];
};

export type JourneyEvent = {
  at: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
};

/** Warehouse staff who handled the order (for logging a violation against them). */
export type JourneyStaff = { userId: string; name: string; role: 'packer' | 'printer' };

/** The order is marked «طلب مميز»: the prep queue serves it first. */
export type JourneyPriority = { createdAt: string; createdByName: string | null; reason: string | null };

export type OrderJourney = {
  item: StuckItem;
  events: JourneyEvent[];
  returns: StuckItem[];
  staff: JourneyStaff[];
  priority: JourneyPriority | null;
};
