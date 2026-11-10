import type { PrepOrder } from '@/app/lib/order-prep/types';
import type { ShippingMethod, ShippingState } from './rules';

/** Everything the shipping station shows for one scanned order. */
export type StationView = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  city: string | null;
  sallaStatus: string | null;
  method: ShippingMethod;
  /** null: no shipping task yet (order not packed through prep). */
  state: ShippingState | null;
  stateLabel: string;
  task: {
    id: string;
    attempts: number;
    lastError: string | null;
    blockReason: string | null;
    printCount: number;
    printedAt: string | null;
    printedByName: string | null;
    labelReadyAt: string | null;
    creatingAt: string | null;
  } | null;
  order: PrepOrder;
  prep: {
    packed: boolean;
    packedBy: string | null;
    packedAt: string | null;
    /** Item positions the packer reported short. */
    shortIndexes: number[];
  };
  flags: {
    doNotShip: { notes: string | null; by: string | null } | null;
    highPriority: { reason: string | null; notes: string | null } | null;
    gift: { reason: string | null; notes: string | null } | null;
  };
  shipment: { courier: string | null; trackingNumber: string | null; hasLabel: boolean; printCount: number } | null;
  local: { trackingNumber: string; agentName: string | null } | null;
};

export type StationError = { code: string; message: string };

export type StationResponse =
  | { success: true; view: StationView; message?: string }
  | { success: false; error: StationError; view?: StationView | null };
