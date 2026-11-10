import { storedRequestAmounts, type StoredAmounts } from './request-financials';

/**
 * Staff switching pieces between return (money back) and exchange (credit),
 * or including / excluding a piece from the refund. Pure: decides whether the
 * change is allowed, what it costs, and what must happen to money already
 * handed out. piece-changes-service.ts does the I/O.
 */

export type PieceType = 'return' | 'exchange';
type NumericValue = number | string | { toString(): string } | null | undefined;

export interface PlanPiece {
  id: string;
  type: string;
  price: NumericValue;
  quantity?: number;
  refundIncluded?: boolean | null;
  productId: string;
  productName: string;
  variantName?: string | null;
}

export interface PlanRequest {
  status: string;
  processingStatus?: string | null;
  refundStatus?: string | null;
  couponCode?: string | null;
  couponId?: string | null;
  couponAmount?: NumericValue;
  couponAmountOverride?: NumericValue;
  exchangeMode?: string | null;
  exchangeOrderId?: string | null;
  exchangePaymentStatus?: string | null;
  erpFeeSyncedAt?: Date | string | null;
  leftoverCouponCode?: string | null;
  shippingAmount?: NumericValue;
  currency?: string | null;
  feeExchangeRate?: NumericValue;
  exchangeLinesCount?: number;
  items: PlanPiece[];
}

export interface PieceChangeInput {
  changes?: Array<{ itemId: string; type?: string; refundIncluded?: boolean }>;
  /** Switch every piece (the request-level إرجاع / استبدال switch). */
  setAll?: string;
}

/** Category rules for the products involved, from Salla. `known` is false when the lookup failed. */
export interface CategoryRules {
  known: boolean;
  exchangeOnly: Map<string, string>;
  blocked: Map<string, string>;
}

export type BlockCode =
  | 'CLOSED'
  | 'PROCESSING'
  | 'INVALID'
  | 'NO_CHANGE'
  | 'REFUND_IN_FLIGHT'
  | 'REFUNDED'
  | 'EXCHANGE_ORDER_BUSY'
  | 'ACTIVE_REPLACEMENT'
  | 'ERP_POSTED'
  | 'LEFTOVER_COUPON';

export type WarningCode =
  | 'EXCHANGE_ONLY_CATEGORY'
  | 'BLOCKED_CATEGORY'
  | 'POLICY_UNKNOWN'
  | 'COUPON_REVOKE'
  | 'COUPON_UPDATE'
  | 'MANUAL_COUPON'
  | 'CLEARS_OVERRIDE';

/** Which confirmation a warning needs before the change runs. */
export type ConfirmKey = 'policy' | 'coupon' | 'manualCoupon';

export interface PlanWarning {
  code: WarningCode;
  message: string;
  confirm?: ConfirmKey;
}

export interface PieceDiff {
  itemId: string;
  productName: string;
  variantName: string | null;
  from: { type: PieceType; refundIncluded: boolean };
  to: { type: PieceType; refundIncluded: boolean };
}

export interface PiecePlan {
  ok: true;
  diffs: PieceDiff[];
  /** Target type of every piece (id → type / refundIncluded). */
  target: Map<string, { type: PieceType; refundIncluded: boolean }>;
  typeChanged: boolean;
  exchangeSetChanged: boolean;
  before: StoredAmounts;
  after: StoredAmounts;
  /** What happens to an issued coupon: deleted (no exchange piece left) or set to the new credit. */
  couponAction: null | 'revoke' | 'update';
  clearsOverride: boolean;
  dropsExchangeLines: boolean;
  resetRefundStatus: boolean;
  warnings: PlanWarning[];
}

export type PlanResult = PiecePlan | { ok: false; code: BlockCode; message: string };

const CLOSED = new Set(['completed', 'cancelled', 'rejected']);
const ACTIVE_REPLACEMENT = new Set(['pending', 'paid', 'not_required']);

export const BLOCK_MESSAGES: Record<BlockCode, string> = {
  CLOSED: 'الطلب مغلق. أعيديه للمراجعة أولاً ثم غيّري نوع القطع.',
  PROCESSING: 'الطلب قيد المعالجة حالياً، حاولي بعد قليل.',
  INVALID: 'بيانات القطع غير صحيحة.',
  NO_CHANGE: 'لا يوجد تغيير.',
  REFUND_IN_FLIGHT: 'يوجد استرجاع مالي قيد التنفيذ أو نتيجته غير معروفة؛ لا يمكن تغيير القطع الآن.',
  REFUNDED: 'تم استرجاع المبلغ للعميل؛ لا يمكن تغيير نوع القطع أو المبالغ بعد الاسترجاع.',
  EXCHANGE_ORDER_BUSY: 'يتم إنشاء أو إلغاء الطلب البديل الآن، حاولي بعد قليل.',
  ACTIVE_REPLACEMENT: 'للطلب طلب بديل نشط. ألغي الطلب البديل أولاً (يُسترجع أي فرق دفعه العميل) ثم غيّري نوع القطع.',
  ERP_POSTED: 'تم ترحيل رسوم المرتجع إلى نظام ERP؛ لا يمكن تغيير نوع القطع.',
  LEFTOVER_COUPON: 'تم إصدار كوبون الرصيد المتبقي؛ لا يمكن تغيير نوع القطع.',
};

const asType = (value: unknown): PieceType => (value === 'exchange' ? 'exchange' : 'return');
const sameCredit = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function planPieceChanges(request: PlanRequest, input: PieceChangeInput, categories?: CategoryRules): PlanResult {
  const block = (code: BlockCode): PlanResult => ({ ok: false, code, message: BLOCK_MESSAGES[code] });

  if (CLOSED.has(request.status)) return block('CLOSED');
  if (request.processingStatus === 'processing') return block('PROCESSING');
  if (request.items.length === 0) return block('INVALID');

  // Target state of every piece.
  const target = new Map<string, { type: PieceType; refundIncluded: boolean }>(
    request.items.map((item) => [item.id, { type: asType(item.type), refundIncluded: item.refundIncluded !== false }]),
  );
  if (input.setAll !== undefined) {
    if (input.setAll !== 'return' && input.setAll !== 'exchange') return block('INVALID');
    for (const state of target.values()) state.type = input.setAll;
  }
  for (const change of input.changes ?? []) {
    const state = target.get(String(change?.itemId));
    if (!state) return block('INVALID');
    if (change.type !== undefined) {
      if (change.type !== 'return' && change.type !== 'exchange') return block('INVALID');
      state.type = change.type;
    }
    if (change.refundIncluded !== undefined) {
      if (typeof change.refundIncluded !== 'boolean') return block('INVALID');
      state.refundIncluded = change.refundIncluded;
    }
  }

  const diffs: PieceDiff[] = [];
  for (const item of request.items) {
    const from = { type: asType(item.type), refundIncluded: item.refundIncluded !== false };
    const to = target.get(item.id)!;
    // Only return pieces carry the refund flag; an exchange piece's flag is moot.
    const flagChanged = to.type === 'return' && from.refundIncluded !== to.refundIncluded;
    if (from.type !== to.type || flagChanged) {
      diffs.push({ itemId: item.id, productName: item.productName, variantName: item.variantName ?? null, from, to: { ...to } });
    }
  }
  if (diffs.length === 0) return block('NO_CHANGE');

  const typeChanged = diffs.some((diff) => diff.from.type !== diff.to.type);
  const refundStatus = request.refundStatus || 'none';
  if (refundStatus === 'requested' || refundStatus === 'unknown') return block('REFUND_IN_FLIGHT');
  if (refundStatus === 'refunded') return block('REFUNDED');
  if (typeChanged) {
    if (request.exchangePaymentStatus === 'creating' || request.exchangePaymentStatus === 'expiring') {
      return block('EXCHANGE_ORDER_BUSY');
    }
    if (
      request.exchangeMode === 'order' &&
      request.exchangeOrderId &&
      ACTIVE_REPLACEMENT.has(request.exchangePaymentStatus || '')
    ) {
      return block('ACTIVE_REPLACEMENT');
    }
    if (request.erpFeeSyncedAt) return block('ERP_POSTED');
    if (request.leftoverCouponCode) return block('LEFTOVER_COUPON');
  }

  const exchangeIds = (pick: (item: PlanPiece) => PieceType) =>
    request.items.filter((item) => pick(item) === 'exchange').map((item) => item.id).sort().join(',');
  const exchangeSetChanged =
    exchangeIds((item) => asType(item.type)) !== exchangeIds((item) => target.get(item.id)!.type);
  const hasOverride = Number(request.couponAmountOverride) > 0;
  const clearsOverride = exchangeSetChanged && hasOverride;

  const common = { shippingAmount: request.shippingAmount, currency: request.currency, feeExchangeRate: request.feeExchangeRate };
  const before = storedRequestAmounts({
    ...common,
    items: request.items.map((item) => ({ type: item.type, price: item.price, quantity: item.quantity, refundIncluded: item.refundIncluded })),
    couponAmountOverride: request.couponAmountOverride,
  });
  const after = storedRequestAmounts({
    ...common,
    items: request.items.map((item) => ({ ...target.get(item.id)!, price: item.price, quantity: item.quantity })),
    couponAmountOverride: clearsOverride ? null : request.couponAmountOverride,
  });

  const warnings: PlanWarning[] = [];

  let couponAction: PiecePlan['couponAction'] = null;
  if (request.couponCode) {
    const issued = Number(request.couponAmount);
    if (after.creditAmount <= 0) couponAction = 'revoke';
    else if (exchangeSetChanged || !Number.isFinite(issued) || !sameCredit(issued, after.creditAmount)) couponAction = 'update';
  }
  if (couponAction === 'revoke') {
    warnings.push({
      code: 'COUPON_REVOKE',
      message: `سيُحذف كوبون الاستبدال ${request.couponCode} من سلة لأنه لم تبقَ قطع للاستبدال. يُسمح بذلك فقط إذا لم يستخدمه العميل.`,
      confirm: 'coupon',
    });
  } else if (couponAction === 'update') {
    warnings.push({
      code: 'COUPON_UPDATE',
      message: `ستتغير قيمة كوبون الاستبدال ${request.couponCode} في سلة إلى الرصيد الجديد. يُسمح بذلك فقط إذا لم يستخدمه العميل.`,
      confirm: 'coupon',
    });
  }
  if (couponAction && !request.couponId) {
    warnings.push({
      code: 'MANUAL_COUPON',
      message: `الكوبون ${request.couponCode} أُدخل يدوياً ولا يمكن للنظام تعديله في سلة. ${
        couponAction === 'revoke' ? 'احذفيه' : 'عدّلي قيمته'
      } من لوحة سلة بنفسك.`,
      confirm: 'manualCoupon',
    });
  }
  if (clearsOverride) {
    warnings.push({
      code: 'CLEARS_OVERRIDE',
      message: 'قيمة الكوبون المعدّلة يدوياً كانت للقطع السابقة؛ ستُحسب القيمة من جديد ويمكنك تعديلها بعد الحفظ.',
    });
  }

  // Category rules: outlet / National Day pieces are exchange-only; 1 SAR and
  // discounted pieces are not returnable at all. Staff may override, knowingly.
  const switched = diffs.filter((diff) => diff.from.type !== diff.to.type);
  if (switched.length > 0) {
    if (!categories || !categories.known) {
      warnings.push({ code: 'POLICY_UNKNOWN', message: 'تعذر التحقق من تصنيفات المنتجات في سلة؛ تأكدي من سياسة الإرجاع بنفسك.' });
    } else {
      const productOf = new Map(request.items.map((item) => [item.id, item.productId]));
      for (const diff of switched) {
        const productId = productOf.get(diff.itemId) || '';
        const blocked = categories.blocked.get(productId);
        const exchangeOnly = categories.exchangeOnly.get(productId);
        if (blocked) {
          warnings.push({ code: 'BLOCKED_CATEGORY', message: `${diff.productName}: ${blocked}`, confirm: 'policy' });
        } else if (exchangeOnly && diff.to.type === 'return') {
          warnings.push({ code: 'EXCHANGE_ONLY_CATEGORY', message: `${diff.productName}: ${exchangeOnly}`, confirm: 'policy' });
        }
      }
    }
  }

  const exchangeLeft = after.type !== 'return';
  return {
    ok: true,
    diffs,
    target,
    typeChanged,
    exchangeSetChanged,
    before,
    after,
    couponAction,
    clearsOverride,
    dropsExchangeLines: !exchangeLeft && ((request.exchangeLinesCount ?? 0) > 0 || request.exchangeMode === 'order'),
    resetRefundStatus: after.type === 'exchange' && (refundStatus === 'failed' || refundStatus === 'manual'),
    warnings,
  };
}

/** Confirmations the plan still needs, given what staff ticked. */
export function missingConfirmations(plan: PiecePlan, confirm: Partial<Record<ConfirmKey, boolean>> = {}): ConfirmKey[] {
  const needed = new Set(plan.warnings.map((warning) => warning.confirm).filter((key): key is ConfirmKey => Boolean(key)));
  return [...needed].filter((key) => confirm[key] !== true);
}
