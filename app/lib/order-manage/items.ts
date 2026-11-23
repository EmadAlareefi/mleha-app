import { SallaCallError, pickRefundableTransaction, roundMoney, type SallaTransaction } from '@/app/lib/salla-transactions';
import type { CatalogProduct } from '@/app/lib/returns/exchange-catalog';
import { MESSAGES, beginChange, type ChangeRow, type EngineDeps, type Session } from './engine';
import { NEW_ORDER_STATUS_ID } from './eligibility';
import type { OrderManageSettings } from './settings';

/**
 * Customer cancels single pieces, changes a piece's size, or swaps a piece for
 * another product, before a packer takes the order (returns prototype screens
 * 29–39).
 *
 * Verified on the live store with test order #300550101 (2026-11-17):
 *  - PUT /orders/items/{id} {quantity, options:[{id: productOptionId, value: valueId}]}
 *    changes the size in place: total unchanged, stock moves, status stays.
 *  - POST /orders/items {identifier_type:'id', identifier, quantity, options:[{id, value:[valueId]}]}
 *    adds a line at the catalog price; Salla then shows `remaining_amount`, but
 *    no checkout link while the order is "طلب جديد".
 *  - Moving the order to "بإنتظار الدفع" makes Salla issue `checkout_url` for
 *    the remaining amount; moving it back clears the link.
 *  - DELETE /orders/items/{id} restores stock and shows the amount owed in
 *    `refund_action.refund_amount`; Salla does not refund by itself.
 *  - A partial refund through the payment transaction works and leaves the
 *    order at "طلب جديد".
 *
 * Writes go adds → in-place updates → quantity cuts → deletes, so stock for
 * the new pieces is taken before anything is given up. A write whose outcome
 * is unknown is never repeated: the change goes to staff with the hold kept.
 */

export type PieceAction = 'cancel' | 'size' | 'product';

export type PieceRequest = {
  itemId: string;
  action: PieceAction;
  reason: string;
  note?: string;
  /** For size: the line's own product. For product: the new product. */
  productId?: string;
  /** Option value ids of the chosen variant. */
  optionValueIds?: string[];
};

export type LiveLine = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  /** What the customer paid for one unit. */
  unitPrice: number;
  /** Option value ids on the line. */
  valueIds: string[];
};

type OrderOptions = Array<{ id: string; value: string[] }>;

export type ItemOp =
  | { type: 'add'; productId: string; quantity: number; options: OrderOptions; unitPrice: number; label: string }
  | { type: 'update'; itemId: string; quantity: number; options: OrderOptions; previousOptions: OrderOptions }
  | { type: 'reduce'; itemId: string; quantity: number; previousQuantity: number; options: OrderOptions }
  | { type: 'delete'; itemId: string; productId: string; quantity: number; options: OrderOptions };

export type ItemPlan = {
  ops: ItemOp[];
  kind: 'swap' | 'items';
  /** Value of the pieces given up, at the price paid. */
  oldValue: number;
  /** Value of the new pieces, at today's price (in-place size keeps the paid price). */
  newValue: number;
  /** newValue − oldValue − cancelled value: > 0 to pay, < 0 to refund. */
  expectedDelta: number;
};

export type PlanResult = { ok: true; plan: ItemPlan } | { ok: false; message: string };

const num = (value: unknown): number => {
  const parsed = Number(typeof value === 'object' && value !== null ? (value as Record<string, unknown>).amount : value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Lines of a live Salla order (`fetchLiveOrder(..., { withItems: true })`). */
export function liveLines(detail: Record<string, any>): LiveLine[] {
  const items: any[] = Array.isArray(detail?.items) ? detail.items : [];
  return items.map((item) => {
    const quantity = Math.max(1, Number(item?.quantity) || 1);
    const total = num(item?.amounts?.total);
    return {
      id: String(item?.id ?? ''),
      productId: String(item?.product_id ?? item?.product?.id ?? ''),
      name: String(item?.name ?? ''),
      quantity,
      unitPrice: roundMoney(total / quantity),
      valueIds: (Array.isArray(item?.options) ? item.options : [])
        .map((option: any) => (option?.value && typeof option.value === 'object' ? option.value.id : null))
        .filter((id: unknown) => id !== null && id !== undefined)
        .map(String),
    };
  });
}

/** The option payload for value ids, using the product's option ids. */
function optionsFor(product: CatalogProduct, valueIds: string[]): OrderOptions | null {
  const options: OrderOptions = [];
  for (const option of product.options) {
    const value = option.values.find((v) => valueIds.includes(v.id));
    if (!value) return null;
    options.push({ id: option.id, value: [value.id] });
  }
  return options;
}

function skuFor(product: CatalogProduct, valueIds: string[]) {
  return product.skus.find(
    (sku) => sku.optionValueIds.length === valueIds.length && sku.optionValueIds.every((id) => valueIds.includes(id)),
  );
}

/**
 * Turns the customer's per-piece choices into Salla writes. Pure; `products`
 * holds the catalog entry of every product involved (current lines and new ones).
 */
export function planItemChanges(lines: LiveLine[], pieces: PieceRequest[], products: Map<string, CatalogProduct>): PlanResult {
  if (pieces.length === 0) return { ok: false, message: 'حددي قطعة واحدة على الأقل.' };
  const byLine = new Map<string, PieceRequest[]>();
  for (const piece of pieces) {
    const line = lines.find((l) => l.id === String(piece.itemId));
    if (!line) return { ok: false, message: 'تغيّر الطلب. أعيدي فتحه وحاولي مرة أخرى.' };
    if (!['cancel', 'size', 'product'].includes(piece.action)) return { ok: false, message: 'نوع التعديل غير صحيح.' };
    if (!piece.reason?.trim()) return { ok: false, message: 'اختاري سبب التعديل لكل قطعة.' };
    byLine.set(line.id, [...(byLine.get(line.id) ?? []), piece]);
  }

  const ops: ItemOp[] = [];
  const adds: ItemOp[] = [];
  let oldValue = 0;
  let newValue = 0;
  let cancelledValue = 0;
  // Stock asked of each variant across the whole request.
  const wanted = new Map<string, number>();

  for (const line of lines) {
    const chosen = byLine.get(line.id);
    if (!chosen) continue;
    if (chosen.length > line.quantity) return { ok: false, message: 'عدد القطع المحددة أكبر من الكمية في الطلب.' };
    const lineProduct = products.get(line.productId);
    if (!lineProduct && chosen.some((p) => p.action !== 'cancel')) {
      return { ok: false, message: `المنتج «${line.name}» غير متاح للتعديل حالياً.` };
    }
    const currentOptions = lineProduct ? optionsFor(lineProduct, line.valueIds) ?? [] : [];

    for (const piece of chosen) {
      if (piece.action === 'cancel') {
        cancelledValue += line.unitPrice;
        continue;
      }
      const productId = piece.action === 'size' ? line.productId : String(piece.productId ?? '');
      const product = products.get(productId);
      if (!product) return { ok: false, message: 'المنتج المختار غير متاح حالياً.' };
      if (piece.action === 'product' && productId === line.productId) {
        return { ok: false, message: 'لتغيير المقاس فقط اختاري «تغيير المقاس».' };
      }
      const valueIds = (piece.optionValueIds ?? []).map(String);
      const sku = skuFor(product, valueIds);
      const options = optionsFor(product, valueIds);
      if (!sku || !options) return { ok: false, message: `اختاري المقاس لـ «${product.name}».` };
      if (piece.action === 'size' && valueIds.every((id) => line.valueIds.includes(id))) {
        return { ok: false, message: 'المقاس الجديد مثل المقاس الحالي.' };
      }
      const key = `${productId}:${sku.id}`;
      wanted.set(key, (wanted.get(key) ?? 0) + 1);
      if (!sku.inStock || (sku.stock !== null && sku.stock < (wanted.get(key) ?? 0))) {
        return { ok: false, message: `المقاس المختار من «${product.name}» غير متوفر حالياً.` };
      }
      oldValue += line.unitPrice;
      // A one-piece line changing size is edited in place and keeps its paid price.
      const inPlace = piece.action === 'size' && line.quantity === 1 && chosen.length === 1;
      const unitPrice = inPlace ? line.unitPrice : roundMoney(sku.price);
      newValue += unitPrice;
      if (inPlace) {
        ops.push({ type: 'update', itemId: line.id, quantity: 1, options, previousOptions: currentOptions });
      } else {
        adds.push({ type: 'add', productId, quantity: 1, options, unitPrice, label: product.name });
      }
    }

    const inPlace = ops.some((op) => op.type === 'update' && op.itemId === line.id);
    if (inPlace) continue;
    const remaining = line.quantity - chosen.length;
    if (remaining > 0) {
      ops.push({ type: 'reduce', itemId: line.id, quantity: remaining, previousQuantity: line.quantity, options: currentOptions });
    } else {
      ops.push({ type: 'delete', itemId: line.id, productId: line.productId, quantity: line.quantity, options: currentOptions });
    }
  }

  const order = { add: 0, update: 1, reduce: 2, delete: 3 } as const;
  const all = [...adds, ...ops].sort((a, b) => order[a.type] - order[b.type]);
  const kind = pieces.every((p) => p.action === 'size') ? 'swap' : 'items';
  return {
    ok: true,
    plan: {
      ops: all,
      kind,
      oldValue: roundMoney(oldValue),
      newValue: roundMoney(newValue),
      expectedDelta: roundMoney(newValue - oldValue - cancelledValue),
    },
  };
}

/** True when every unit of every line is cancelled: that is a whole-order cancel. */
export function cancelsWholeOrder(lines: LiveLine[], pieces: PieceRequest[]): boolean {
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  return units > 0 && pieces.length === units && pieces.every((p) => p.action === 'cancel');
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

/** Short reference shown to the customer ("CH-…"). */
export function serviceNumber(id: string) {
  return `CH-${id.slice(-6).toUpperCase()}`;
}

export const PAYMENT_STATUS_ID = 1224232774; // "بإنتظار الدفع"
/** How long the customer has to pay a price difference before the change is undone. */
export const PAYMENT_WINDOW_MS = 30 * 60_000;

export type DoneOp = ItemOp & { createdItemId?: string };

export type ItemChangeDetails = {
  row: ChangeRow;
  request: { pieces?: PieceRequest[]; plan?: ItemPlan } | null;
  after: { ops?: DoneOp[]; paidBefore?: number; delta?: number } | null;
  paymentUrl: string | null;
  paymentExpiresAt: Date | null;
  paymentStatus: string | null;
};

export interface ItemDeps extends EngineDeps {
  loadProduct(merchantId: string, productId: string): Promise<CatalogProduct | null>;
  sallaWrite(merchantId: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<any>;
  setOrderStatus(merchantId: string, orderId: string, statusId: number): Promise<void>;
  loadDetails(changeId: string): Promise<ItemChangeDetails | null>;
  savePayment(
    changeId: string,
    fields: { paymentUrl: string | null; paymentExpiresAt: Date | null; paymentStatus: string; amountDelta: number },
  ): Promise<void>;
  notifyPaymentLink(change: ChangeRow, amount: number, url: string): Promise<void>;
}

export type ItemOutcome =
  | { status: 'completed'; changeId: string; refundAmount: number }
  | { status: 'awaiting_payment'; changeId: string; amount: number; paymentUrl: string; expiresAt: string }
  | { status: 'pending_review'; changeId: string; message: string }
  | { status: 'in_progress'; changeId: string; message: string }
  | { status: 'denied'; code: string; message: string }
  | { status: 'failed'; changeId: string; message: string };

const sallaError = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  unknown: !(error instanceof SallaCallError) || error.outcomeUnknown,
});

function opRequest(orderId: string, op: ItemOp): { method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown } {
  switch (op.type) {
    case 'add':
      return {
        method: 'POST',
        path: '/orders/items',
        body: { order_id: Number(orderId), identifier_type: 'id', identifier: Number(op.productId), quantity: op.quantity, options: op.options },
      };
    case 'update':
      return {
        method: 'PUT',
        path: `/orders/items/${op.itemId}`,
        body: { quantity: op.quantity, options: op.options.map((o) => ({ id: o.id, value: o.value[0] })) },
      };
    case 'reduce':
      return {
        method: 'PUT',
        path: `/orders/items/${op.itemId}`,
        body: { quantity: op.quantity, options: op.options.map((o) => ({ id: o.id, value: o.value[0] })) },
      };
    case 'delete':
      return { method: 'DELETE', path: `/orders/items/${op.itemId}` };
  }
}

/** What Salla says is owed either way after the edit. */
export function balanceOf(detail: Record<string, any>): { due: number; owed: number; paid: number; total: number } {
  const actions = detail?.payment_actions ?? {};
  const remaining = actions.remaining_action ?? {};
  const refund = actions.refund_action ?? {};
  const due = remaining.has_remaining_amount ? num(remaining.remaining_amount) : 0;
  const owed = refund.has_refund_amount ? Math.max(0, num(refund.refund_amount) - num(refund.pending_refund_amount)) : 0;
  return {
    due: roundMoney(due),
    owed: roundMoney(owed),
    paid: roundMoney(num(remaining.paid_amount ?? refund.paid_amount)),
    total: roundMoney(num(detail?.amounts?.total)),
  };
}

const ITEMS_NOTE = 'تم تعديل منتجات الطلب بطلب من العميل عبر صفحة الإرجاع والاستبدال.';

async function parkForStaff(deps: ItemDeps, change: ChangeRow, step: string, message: string, done: DoneOp[]) {
  await deps.updateChange(change.id, {}, {
    state: 'needs_staff',
    writeStatus: 'unknown',
    lastError: message,
    after: { ops: done },
    step: { step, result: 'needs_staff', details: { error: message } },
  });
  return { status: 'pending_review' as const, changeId: change.id, message: MESSAGES.pendingReview };
}

export async function applyItemChanges(
  deps: ItemDeps,
  input: { session: Session; idempotencyKey: unknown; ipHash: string | null; pieces: PieceRequest[] },
): Promise<ItemOutcome> {
  const { session } = input;

  // Products are read before the hold so a bad choice never holds the order.
  const live0 = await deps.fetchLive(session.merchantId, session.orderId);
  if (live0.kind !== 'ok') return { status: 'denied', code: 'try_later', message: MESSAGES.tryLater };
  const lines0 = liveLines(live0.detail);
  const productIds = new Set<string>(lines0.map((l) => l.productId));
  for (const piece of input.pieces) if (piece.action === 'product' && piece.productId) productIds.add(String(piece.productId));
  const products = new Map<string, CatalogProduct>();
  await Promise.all(
    [...productIds].map(async (id) => {
      const product = await deps.loadProduct(session.merchantId, id).catch(() => null);
      if (product) products.set(id, product);
    }),
  );
  const draft = planItemChanges(lines0, input.pieces, products);
  if (!draft.ok) return { status: 'denied', code: 'invalid', message: draft.message };

  const begun = await beginChange(deps, {
    session,
    kind: draft.plan.kind,
    idempotencyKey: input.idempotencyKey,
    ipHash: input.ipHash,
    request: { pieces: input.pieces, plan: draft.plan },
  });
  if (begun.status === 'done') return begun.outcome as ItemOutcome;
  const { change, live } = begun;

  // Plan again on the order as it is now, under the hold.
  const final = planItemChanges(liveLines(live.detail), input.pieces, products);
  if (!final.ok) {
    await deps.updateChange(change.id, { state: 'held', writeStatus: 'none' }, {
      state: 'failed',
      holdActive: false,
      lastError: final.message,
      completedAt: deps.now(),
      step: { step: 'plan', result: 'stopped', details: { reason: final.message } },
    });
    return { status: 'denied', code: 'invalid', message: final.message };
  }
  const paidBefore = balanceOf(live.detail).paid;

  const marked = await deps.updateChange(change.id, { state: 'held', writeStatus: 'none' }, {
    state: 'applying',
    writeStatus: 'requested',
    step: { step: 'items', result: 'requested', details: { ops: final.plan.ops.length } },
  });
  if (!marked) return { status: 'in_progress', changeId: change.id, message: MESSAGES.inProgress };

  const done: DoneOp[] = [];
  for (const op of final.plan.ops) {
    const call = opRequest(change.orderId, op);
    try {
      const response = await deps.sallaWrite(change.merchantId, call.method, call.path, call.body);
      const createdItemId = op.type === 'add' ? String(response?.data?.id ?? response?.id ?? '') || undefined : undefined;
      done.push({ ...op, ...(createdItemId ? { createdItemId } : {}) });
      await deps.updateChange(change.id, {}, { after: { ops: done, paidBefore }, step: { step: `item_${op.type}`, result: 'ok' } });
    } catch (error) {
      const { message, unknown } = sallaError(error);
      if (!unknown && done.length === 0) {
        // Refused before anything changed: the order goes back to the queue untouched.
        await deps.updateChange(change.id, { writeStatus: 'requested' }, {
          state: 'failed',
          holdActive: false,
          writeStatus: 'failed',
          lastError: message,
          completedAt: deps.now(),
          step: { step: `item_${op.type}`, result: 'failed', details: { error: message } },
        });
        return { status: 'failed', changeId: change.id, message: MESSAGES.failed };
      }
      // Half applied or unknown: a person must look at the order.
      return parkForStaff(deps, change, `item_${op.type}`, message, done);
    }
  }

  await deps.updateChange(change.id, { writeStatus: 'requested' }, { writeStatus: 'done', step: { step: 'items', result: 'ok' } });
  await deps.addHistoryNote(change.merchantId, change.orderId, ITEMS_NOTE).catch(() => undefined);

  const after = await deps.fetchLive(change.merchantId, change.orderId);
  if (after.kind !== 'ok') return parkForStaff(deps, change, 'reread', `live_read:${after.kind}`, done);
  const balance = balanceOf(after.detail);

  if (balance.due > 0) {
    return requestPayment(deps, { ...change, writeStatus: 'done' }, balance.due, done, paidBefore);
  }

  const synced = await deps.syncMirror(change.merchantId, after.detail).catch(() => false);
  await deps.updateChange(change.id, { writeStatus: 'done' }, {
    state: 'completed',
    holdActive: !synced,
    completedAt: deps.now(),
    lastError: synced ? null : 'mirror_not_synced',
    refundStatus: balance.owed > 0 ? 'none' : 'not_needed',
    refundAmount: balance.owed > 0 ? balance.owed : null,
    after: { ops: done, paidBefore, delta: roundMoney(balance.total - paidBefore) },
    step: { step: 'release', result: synced ? 'ok' : 'mirror_pending' },
  });
  return { status: 'completed', changeId: change.id, refundAmount: balance.owed };
}

async function requestPayment(deps: ItemDeps, change: ChangeRow, amount: number, done: DoneOp[], paidBefore: number): Promise<ItemOutcome> {
  try {
    await deps.setOrderStatus(change.merchantId, change.orderId, PAYMENT_STATUS_ID);
  } catch (error) {
    return parkForStaff(deps, change, 'payment_status', sallaError(error).message, done);
  }
  const live = await deps.fetchLive(change.merchantId, change.orderId);
  const url = live.kind === 'ok' ? String(live.detail?.payment_actions?.remaining_action?.checkout_url || live.detail?.urls?.checkout || '') : '';
  if (!url) return parkForStaff(deps, change, 'payment_link', 'no_checkout_url', done);
  if (live.kind === 'ok') await deps.syncMirror(change.merchantId, live.detail).catch(() => false);

  const expiresAt = new Date(deps.now().getTime() + PAYMENT_WINDOW_MS);
  await deps.savePayment(change.id, { paymentUrl: url, paymentExpiresAt: expiresAt, paymentStatus: 'pending', amountDelta: amount });
  await deps.updateChange(change.id, {}, {
    state: 'awaiting_payment',
    after: { ops: done, paidBefore, delta: amount },
    step: { step: 'payment_link', result: 'sent', details: { amount } },
  });
  await deps.notifyPaymentLink(change, amount, url).catch(() => undefined);
  return { status: 'awaiting_payment', changeId: change.id, amount, paymentUrl: url, expiresAt: expiresAt.toISOString() };
}

/**
 * For a change waiting on the customer's payment: finish it once Salla shows
 * the balance paid, or undo it once the window has passed. Called by the page
 * (status poll) and by the worker. Returns the change's state afterwards.
 */
export async function settleAwaitingPayment(deps: ItemDeps, changeId: string): Promise<string> {
  const details = await deps.loadDetails(changeId);
  if (!details || details.row.state !== 'awaiting_payment') return details?.row.state ?? 'missing';
  const change = details.row;
  const live = await deps.fetchLive(change.merchantId, change.orderId);
  if (live.kind !== 'ok') return change.state;
  const balance = balanceOf(live.detail);
  const statusId = Number(live.statusCustomId);

  if (balance.due <= 0) {
    // Paid. Salla may already have moved it on; make sure it is "طلب جديد" again.
    if (statusId === PAYMENT_STATUS_ID) {
      try {
        await deps.setOrderStatus(change.merchantId, change.orderId, Number(NEW_ORDER_STATUS_ID));
      } catch (error) {
        await deps.updateChange(change.id, { state: 'awaiting_payment' }, { lastError: sallaError(error).message });
        return change.state;
      }
    }
    const fresh = await deps.fetchLive(change.merchantId, change.orderId);
    const synced = fresh.kind === 'ok' ? await deps.syncMirror(change.merchantId, fresh.detail).catch(() => false) : false;
    await deps.savePayment(change.id, {
      paymentUrl: details.paymentUrl,
      paymentExpiresAt: details.paymentExpiresAt,
      paymentStatus: 'paid',
      amountDelta: Number(details.after?.delta ?? 0),
    });
    await deps.updateChange(change.id, { state: 'awaiting_payment' }, {
      state: 'completed',
      holdActive: !synced,
      completedAt: deps.now(),
      refundStatus: 'not_needed',
      lastError: synced ? null : 'mirror_not_synced',
      step: { step: 'payment', result: 'paid' },
    });
    return 'completed';
  }

  if (!details.paymentExpiresAt || deps.now() < details.paymentExpiresAt) return change.state;
  return undoUnpaidChange(deps, details, statusId);
}

/** Puts the order back as it was before an unpaid change, newest write first. */
async function undoUnpaidChange(deps: ItemDeps, details: ItemChangeDetails, statusId: number): Promise<string> {
  const change = details.row;
  const claimed = await deps.updateChange(change.id, { state: 'awaiting_payment' }, {
    state: 'applying',
    step: { step: 'undo', result: 'requested' },
  });
  if (!claimed) return change.state;
  const ops = [...(details.after?.ops ?? [])].reverse();
  try {
    if (statusId === PAYMENT_STATUS_ID) await deps.setOrderStatus(change.merchantId, change.orderId, Number(NEW_ORDER_STATUS_ID));
    for (const op of ops) {
      if (op.type === 'add') {
        if (!op.createdItemId) throw new Error('added line has no id');
        await deps.sallaWrite(change.merchantId, 'DELETE', `/orders/items/${op.createdItemId}`);
      } else if (op.type === 'update') {
        await deps.sallaWrite(change.merchantId, 'PUT', `/orders/items/${op.itemId}`, {
          quantity: op.quantity,
          options: op.previousOptions.map((o) => ({ id: o.id, value: o.value[0] })),
        });
      } else if (op.type === 'reduce') {
        await deps.sallaWrite(change.merchantId, 'PUT', `/orders/items/${op.itemId}`, {
          quantity: op.previousQuantity,
          options: op.options.map((o) => ({ id: o.id, value: o.value[0] })),
        });
      } else {
        await deps.sallaWrite(change.merchantId, 'POST', '/orders/items', {
          order_id: Number(change.orderId),
          identifier_type: 'id',
          identifier: Number(op.productId),
          quantity: op.quantity,
          options: op.options,
        });
      }
    }
  } catch (error) {
    await parkForStaff(deps, change, 'undo', sallaError(error).message, details.after?.ops ?? []);
    return 'needs_staff';
  }

  const live = await deps.fetchLive(change.merchantId, change.orderId);
  const balance = live.kind === 'ok' ? balanceOf(live.detail) : null;
  // The order must be back to exactly what was paid; anything else is for staff.
  if (!balance || balance.due > 0 || balance.owed > 0) {
    await parkForStaff(deps, change, 'undo', `balance_after_undo due=${balance?.due} owed=${balance?.owed}`, details.after?.ops ?? []);
    return 'needs_staff';
  }
  const synced = await deps.syncMirror(change.merchantId, live.kind === 'ok' ? live.detail : {}).catch(() => false);
  await deps.savePayment(change.id, {
    paymentUrl: null,
    paymentExpiresAt: details.paymentExpiresAt,
    paymentStatus: 'expired',
    amountDelta: Number(details.after?.delta ?? 0),
  });
  await deps.updateChange(change.id, { state: 'applying' }, {
    state: 'failed',
    holdActive: !synced,
    lastError: 'payment_expired',
    completedAt: deps.now(),
    step: { step: 'undo', result: 'ok' },
  });
  return 'failed';
}

/* ------------------------------------------------------------------ */
/* Refund of what the customer is owed after removing or cheapening pieces */
/* ------------------------------------------------------------------ */

export type ItemsRefundPlan =
  | { action: 'manual'; reason: string }
  | { action: 'auto'; transactionId: string | number; amount: number; currency: string; transactionTotal: number };

export function decideItemsRefund(input: {
  amount: number;
  transactions: SallaTransaction[];
  priorRefunds: number;
  settings: Pick<OrderManageSettings, 'autoRefundEnabled' | 'autoRefundDailyCapSar'>;
  autoRefundedTodaySar: number;
}): ItemsRefundPlan {
  const amount = roundMoney(input.amount);
  if (!input.settings.autoRefundEnabled) return { action: 'manual', reason: 'الاسترجاع التلقائي متوقف من الإعدادات.' };
  const option = pickRefundableTransaction(input.transactions);
  if (!option.ok) return { action: 'manual', reason: option.reason };
  if (input.priorRefunds > 0) return { action: 'manual', reason: 'يوجد استرجاع سابق على هذا الطلب؛ راجع المبلغ واسترجعه يدوياً.' };
  if (option.currency.toUpperCase() !== 'SAR') return { action: 'manual', reason: `عملة الدفع ${option.currency}.` };
  if (amount <= 0 || amount > option.total) return { action: 'manual', reason: `المبلغ ${amount} لا يناسب عملية الدفع (${option.total}).` };
  if (roundMoney(input.autoRefundedTodaySar + amount) > input.settings.autoRefundDailyCapSar) {
    return { action: 'manual', reason: 'تم تجاوز الحد اليومي للاسترجاع التلقائي.' };
  }
  return { action: 'auto', transactionId: option.transaction.id, amount, currency: option.currency, transactionTotal: option.total };
}

/** Sends (or queues for staff) the refund of a completed item change. Claimed before Salla is called. */
export async function processItemsRefund(
  deps: ItemDeps,
  changeId: string,
  settings: Pick<OrderManageSettings, 'autoRefundEnabled' | 'autoRefundDailyCapSar'>,
): Promise<string> {
  const change = await deps.findChange(changeId);
  if (!change || change.kind === 'cancel' || change.state !== 'completed' || change.refundStatus !== 'none') return 'skipped';
  const amount = change.refundAmount ?? 0;
  let transactions: SallaTransaction[];
  let prior: unknown[];
  try {
    [transactions, prior] = await Promise.all([
      deps.listTransactions(change.merchantId, change.orderId),
      deps.findHistoryRefunds(change.merchantId, change.orderId),
    ]);
  } catch {
    return 'retry_later';
  }
  const plan = decideItemsRefund({
    amount,
    transactions,
    priorRefunds: prior.length,
    settings,
    autoRefundedTodaySar: await deps.autoRefundedSince(new Date(deps.now().getTime() - 86_400_000)),
  });
  if (plan.action === 'manual') {
    await deps.updateChange(change.id, { refundStatus: 'none' }, {
      refundStatus: 'manual',
      refundError: plan.reason,
      step: { step: 'refund', result: 'manual' },
    });
    return 'manual';
  }
  const claimed = await deps.updateChange(change.id, { refundStatus: 'none' }, {
    refundStatus: 'requested',
    refundTransactionId: String(plan.transactionId),
    currency: plan.currency,
    step: { step: 'refund', result: 'requested', details: { amount: plan.amount } },
  });
  if (!claimed) return 'skipped';
  try {
    await deps.refund(change.merchantId, plan.transactionId, plan.amount, plan.currency, plan.transactionTotal);
  } catch (error) {
    const { message, unknown } = sallaError(error);
    await deps.updateChange(change.id, { refundStatus: 'requested' }, {
      refundStatus: unknown ? 'unknown' : 'failed',
      refundError: message,
      step: { step: 'refund', result: unknown ? 'unknown' : 'failed' },
    });
    return unknown ? 'unknown' : 'failed';
  }
  await deps.updateChange(change.id, { refundStatus: 'requested' }, {
    refundStatus: 'refunded',
    refundedAt: deps.now(),
    refundError: null,
    step: { step: 'refund', result: 'refunded', details: { amount: plan.amount } },
  });
  return 'refunded';
}
