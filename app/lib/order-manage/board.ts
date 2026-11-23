import { prisma } from '@/lib/prisma';
import { getOrderManageSettings, type OrderManageSettings } from './settings';
import { bucketOf } from './staff';

/** Data for the supervisor page at /admin/order-prep/customer-changes. */

export type BoardChange = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  kind: string;
  state: string;
  holdActive: boolean;
  writeStatus: string;
  refundStatus: string;
  refundAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  orderTotal: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderManageBoard = {
  settings: OrderManageSettings;
  attention: BoardChange[];
  manualRefunds: BoardChange[];
  recent: BoardChange[];
  /** Whether codes can go out by WhatsApp (template configured) or only by SMS. */
  whatsappCodeTemplate: boolean;
};

const RECENT_LIMIT = 60;

export async function loadOrderManageBoard(): Promise<OrderManageBoard> {
  const now = new Date();
  const [settings, open, recent] = await Promise.all([
    getOrderManageSettings({ fresh: true }),
    prisma.customerOrderChange.findMany({
      where: {
        OR: [{ state: 'needs_staff' }, { holdActive: true }, { refundStatus: { in: ['manual', 'failed', 'unknown'] } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.customerOrderChange.findMany({ orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT }),
  ]);

  const view = (row: (typeof recent)[number]): BoardChange => {
    const before = row.before && typeof row.before === 'object' && !Array.isArray(row.before) ? (row.before as Record<string, unknown>) : {};
    const total = Number(before.total);
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      kind: row.kind,
      state: row.state,
      holdActive: row.holdActive,
      writeStatus: row.writeStatus,
      refundStatus: row.refundStatus,
      refundAmount: row.refundAmount === null ? null : Number(row.refundAmount),
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      orderTotal: Number.isFinite(total) ? total : null,
      error: row.refundError || row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  const attention: BoardChange[] = [];
  const manualRefunds: BoardChange[] = [];
  for (const row of open) {
    const bucket = bucketOf({ state: row.state as never, refundStatus: row.refundStatus as never, holdActive: row.holdActive, updatedAt: row.updatedAt }, now);
    if (bucket === 'attention') attention.push(view(row));
    else if (bucket === 'manual_refund') manualRefunds.push(view(row));
  }

  return {
    settings,
    attention,
    manualRefunds,
    recent: recent.map(view),
    whatsappCodeTemplate: Boolean(process.env.ZOKO_TPL_ORDER_MANAGE_OTP),
  };
}
