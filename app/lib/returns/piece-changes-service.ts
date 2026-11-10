import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder } from '@/app/lib/salla-api';
import { deleteSallaCoupon, updateSallaCoupon } from '@/app/lib/salla-coupons';
import { computeRequestAmounts, type RequestAmounts } from '@/app/lib/returns/exchange-coupon';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { checkCouponUnused, type CouponCheck } from '@/app/lib/returns/coupon-revoke';
import { STAFF_LOCK_MESSAGE, withStaffLock } from '@/app/lib/returns/request-lock';
import { toSallaCouponAmount } from '@/lib/returns/exchange-coupon-amount';
import { ONE_RIYAL_OFFER_ITEM_MESSAGE } from '@/lib/returns/categories';
import {
  getCategoryNamesByProductId,
  getDiscountedProductIds,
  getNationalDayOffersProductIds,
  getOneRiyalOfferProductIds,
  getOutletProductIds,
} from '@/lib/returns/policy';
import {
  DISCOUNTED_PIECE_MESSAGE,
  NATIONAL_DAY_EXCHANGE_ONLY_MESSAGE,
  OUTLET_EXCHANGE_ONLY_MESSAGE,
} from '@/lib/returns/pieces';
import {
  missingConfirmations,
  planPieceChanges,
  type CategoryRules,
  type ConfirmKey,
  type PieceChangeInput,
  type PieceDiff,
  type PiecePlan,
  type PlanRequest,
  type PlanWarning,
} from '@/lib/returns/piece-changes';

/**
 * Applies a staff change to a request's pieces (return ↔ exchange, or a piece
 * in / out of the money refund). See lib/returns/piece-changes.ts for the rules.
 *
 * A dry run returns the preview the confirm dialog shows: before / after money
 * (computed live, as processing will), the coupon outcome, and the warnings
 * that need a tick. The real run re-plans under the staff lock, settles the
 * coupon in Salla first (each step written down as it happens, so a later
 * failure leaves a consistent row), then writes pieces + amounts + audit in one
 * transaction.
 */

const COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');
const round = (value: number) => Math.round(value * 100) / 100;

type Db = Pick<typeof prisma, 'returnRequest' | 'returnItem' | 'returnExchangeLine' | '$transaction'>;

export interface PieceChangeDeps {
  db: Db;
  loadCategories(merchantId: string, productIds: string[]): Promise<CategoryRules>;
  getOrder(merchantId: string, orderId: string): Promise<any | null>;
  computeAmounts(request: any, liveOrder: any): Promise<RequestAmounts>;
  checkCoupon(request: any): Promise<CouponCheck>;
  deleteCoupon(merchantId: string, couponId: string): Promise<boolean>;
  updateCouponAmount(merchantId: string, couponId: string, sallaAmount: number): Promise<{ success: boolean; error?: string }>;
  notifyCoupon: typeof notifyExchangeCoupon;
  lock: typeof withStaffLock;
  now(): Date;
}

export const productionPieceDeps: PieceChangeDeps = {
  db: prisma,
  async loadCategories(merchantId, productIds) {
    const byProduct = await getCategoryNamesByProductId(merchantId, productIds);
    const blocked = new Map<string, string>();
    const exchangeOnly = new Map<string, string>();
    for (const id of getOneRiyalOfferProductIds(byProduct)) blocked.set(id, ONE_RIYAL_OFFER_ITEM_MESSAGE);
    for (const id of getDiscountedProductIds(byProduct)) if (!blocked.has(id)) blocked.set(id, DISCOUNTED_PIECE_MESSAGE);
    for (const id of getOutletProductIds(byProduct)) exchangeOnly.set(id, OUTLET_EXCHANGE_ONLY_MESSAGE);
    for (const id of getNationalDayOffersProductIds(byProduct)) {
      if (!exchangeOnly.has(id)) exchangeOnly.set(id, NATIONAL_DAY_EXCHANGE_ONLY_MESSAGE);
    }
    return { known: true, blocked, exchangeOnly };
  },
  getOrder: (merchantId, orderId) => getSallaOrder(merchantId, orderId),
  computeAmounts: (request, liveOrder) => computeRequestAmounts(request, liveOrder),
  checkCoupon: (request) => checkCouponUnused(request),
  deleteCoupon: deleteSallaCoupon,
  async updateCouponAmount(merchantId, couponId, sallaAmount) {
    const result = await updateSallaCoupon(merchantId, couponId, { amount: sallaAmount });
    return { success: result.success, error: result.error };
  },
  notifyCoupon: notifyExchangeCoupon,
  lock: withStaffLock,
  now: () => new Date(),
};

export interface PieceChangeRequest extends PieceChangeInput {
  id: string;
  actor: string;
  dryRun?: boolean;
  confirm?: Partial<Record<ConfirmKey, boolean>>;
  note?: string;
  /** After a coupon amount change, WhatsApp the updated coupon to the customer. */
  notifyCustomer?: boolean;
}

interface MoneySide {
  type: string;
  refund: number;
  credit: number;
  fee: number;
}

export interface PieceChangePreview {
  diffs: PieceDiff[];
  typeChanged: boolean;
  before: MoneySide;
  after: MoneySide;
  currency: string;
  coupon: null | {
    action: 'revoke' | 'update';
    code: string;
    manual: boolean;
    newAmount: number | null;
    check: CouponCheck | null;
  };
  dropsExchangeLines: boolean;
  clearsOverride: boolean;
  warnings: PlanWarning[];
  /** Confirmations still missing for the real run. */
  needs: ConfirmKey[];
}

export type PieceChangeResult =
  | { ok: true; executed: boolean; preview: PieceChangePreview; message?: string }
  | { ok: false; status: number; code: string; message: string; preview?: PieceChangePreview };

class PieceChangeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const loadRequest = (db: Db, id: string) =>
  db.returnRequest.findUnique({ where: { id }, include: { items: true, exchangeLines: { select: { id: true } } } });

type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

function toPlanRequest(request: LoadedRequest, processingStatus?: string): PlanRequest {
  return {
    status: request.status,
    processingStatus: processingStatus ?? request.processingStatus,
    refundStatus: request.refundStatus,
    couponCode: request.couponCode,
    couponId: request.couponId,
    couponAmount: request.couponAmount,
    couponAmountOverride: request.couponAmountOverride,
    exchangeMode: request.exchangeMode,
    exchangeOrderId: request.exchangeOrderId,
    exchangePaymentStatus: request.exchangePaymentStatus,
    erpFeeSyncedAt: request.erpFeeSyncedAt,
    leftoverCouponCode: request.leftoverCouponCode,
    shippingAmount: request.shippingAmount,
    currency: request.currency,
    feeExchangeRate: request.feeExchangeRate,
    exchangeLinesCount: request.exchangeLines?.length ?? 0,
    items: request.items.map((item) => ({
      id: item.id,
      type: item.type,
      price: item.price,
      quantity: item.quantity,
      refundIncluded: item.refundIncluded,
      productId: item.productId,
      productName: item.productName,
      variantName: item.variantName,
    })),
  };
}

/** The request as it will be after the change, for the live amount calculation. */
function withTarget(request: LoadedRequest, plan: PiecePlan) {
  return {
    ...request,
    couponAmountOverride: plan.clearsOverride ? null : request.couponAmountOverride,
    items: request.items.map((item) => ({ ...item, ...plan.target.get(item.id)! })),
  };
}

const side = (amounts: RequestAmounts): MoneySide => ({
  type: amounts.requestType,
  refund: amounts.refundAmount,
  credit: amounts.couponAmount,
  fee: amounts.processingFee,
});

async function planWithRules(request: LoadedRequest, input: PieceChangeInput, deps: PieceChangeDeps, processingStatus?: string) {
  const first = planPieceChanges(toPlanRequest(request, processingStatus), input);
  if (!first.ok || !first.typeChanged) return first;
  const switched = new Set(first.diffs.filter((diff) => diff.from.type !== diff.to.type).map((diff) => diff.itemId));
  const productIds = request.items.filter((item) => switched.has(item.id)).map((item) => item.productId);
  const categories = await deps
    .loadCategories(request.merchantId, productIds)
    .catch((): CategoryRules => ({ known: false, blocked: new Map(), exchangeOnly: new Map() }));
  return planPieceChanges(toPlanRequest(request, processingStatus), input, categories);
}

async function appendAudit(db: Db, id: string, entry: Record<string, unknown>) {
  const current = await db.returnRequest.findUnique({ where: { id }, select: { processingAudit: true } });
  const audit = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
  await db.returnRequest.update({ where: { id }, data: { processingAudit: [...audit, entry] as any } });
}

export async function applyPieceChanges(
  input: PieceChangeRequest,
  deps: PieceChangeDeps = productionPieceDeps,
): Promise<PieceChangeResult> {
  const request = await loadRequest(deps.db, input.id);
  if (!request) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'طلب الإرجاع غير موجود' };

  const plan = await planWithRules(request, input, deps);
  if (!plan.ok) {
    return { ok: false, status: plan.code === 'PROCESSING' ? 409 : 400, code: plan.code, message: plan.message };
  }

  // Live amounts, the way processing will compute them.
  const order = await deps.getOrder(request.merchantId, request.orderId).catch(() => null);
  const before = await deps.computeAmounts(request, order);
  const after = await deps.computeAmounts(withTarget(request, plan), order);
  const couponCheck = plan.couponAction && request.couponCode ? await deps.checkCoupon(request) : null;
  const preview: PieceChangePreview = {
    diffs: plan.diffs,
    typeChanged: plan.typeChanged,
    before: side(before),
    after: side(after),
    currency: after.currency || request.currency,
    coupon:
      plan.couponAction && request.couponCode
        ? {
            action: plan.couponAction,
            code: request.couponCode,
            manual: !request.couponId,
            newAmount: plan.couponAction === 'update' ? after.couponAmount : null,
            check: couponCheck,
          }
        : null,
    dropsExchangeLines: plan.dropsExchangeLines,
    clearsOverride: plan.clearsOverride,
    warnings: plan.warnings,
    needs: missingConfirmations(plan, input.confirm),
  };
  if (input.dryRun) return { ok: true, executed: false, preview };
  if (preview.needs.length > 0) {
    return { ok: false, status: 409, code: 'NEEDS_CONFIRMATION', message: 'يلزم تأكيد التغييرات قبل الحفظ', preview };
  }
  if (couponCheck && !couponCheck.unused) {
    return { ok: false, status: 409, code: 'COUPON_USED', message: couponCheck.reason, preview };
  }

  const now = deps.now();
  let message = 'تم حفظ نوع القطع وتحديث المبالغ.';
  try {
    const locked = await deps.lock(
      input.id,
      async (previousStatus) => {
        // The state may have moved since the preview: decide again under the lock.
        const fresh = await loadRequest(deps.db, input.id);
        if (!fresh) throw new PieceChangeError(404, 'NOT_FOUND', 'طلب الإرجاع غير موجود');
        const freshPlan = await planWithRules(fresh, input, deps, previousStatus);
        if (!freshPlan.ok) throw new PieceChangeError(409, freshPlan.code, freshPlan.message);
        if (missingConfirmations(freshPlan, input.confirm).length > 0) {
          throw new PieceChangeError(409, 'NEEDS_CONFIRMATION', 'تغيّر الطلب منذ المعاينة، راجعي التغييرات مرة أخرى');
        }

        // Coupon first (Salla), each step recorded at once.
        let couponOutcome: 'revoked' | 'updated' | null = null;
        let newCredit: RequestAmounts | null = null;
        if (freshPlan.couponAction && fresh.couponCode) {
          const check = await deps.checkCoupon(fresh);
          if (!check.unused) throw new PieceChangeError(409, 'COUPON_USED', check.reason);
          if (freshPlan.couponAction === 'revoke') {
            if (fresh.couponId && !(await deps.deleteCoupon(fresh.merchantId, fresh.couponId))) {
              throw new PieceChangeError(502, 'COUPON_DELETE_FAILED', 'تعذر حذف الكوبون من سلة؛ لم يتغير شيء.');
            }
            await deps.db.returnRequest.update({
              where: { id: fresh.id },
              data: { couponCode: null, couponId: null, couponCreatedAt: null },
            });
            await appendAudit(deps.db, fresh.id, {
              at: now.toISOString(),
              step: 'coupon',
              result: 'ok',
              by: input.actor,
              details: { revoked: true, code: fresh.couponCode, manual: !fresh.couponId },
            });
            couponOutcome = 'revoked';
          } else {
            newCredit = await deps.computeAmounts(withTarget(fresh, freshPlan), order);
            if (fresh.couponId) {
              const result = await deps.updateCouponAmount(fresh.merchantId, fresh.couponId, toSallaCouponAmount(newCredit.couponAmountSar));
              if (!result.success) {
                throw new PieceChangeError(502, 'COUPON_UPDATE_FAILED', `تعذر تعديل قيمة الكوبون في سلة: ${result.error || ''}`.trim());
              }
            }
            await deps.db.returnRequest.update({
              where: { id: fresh.id },
              data: {
                couponAmount: newCredit.couponAmount,
                ...(freshPlan.after.type === 'exchange' ? { totalRefundAmount: newCredit.couponAmount } : {}),
              },
            });
            await appendAudit(deps.db, fresh.id, {
              at: now.toISOString(),
              step: 'coupon',
              result: 'ok',
              by: input.actor,
              details: { updated: true, code: fresh.couponCode, amount: newCredit.couponAmount, manual: !fresh.couponId },
            });
            couponOutcome = 'updated';
          }
        }

        const stored = freshPlan.after;
        const data: Prisma.ReturnRequestUpdateInput = {
          type: stored.type,
          returnFee: stored.returnFee,
          totalRefundAmount: stored.totalRefundAmount,
          couponAmount: stored.couponAmount,
          reviewedBy: input.actor,
          reviewedAt: now,
        };
        if (couponOutcome === 'updated' && newCredit) {
          // The coupon in Salla now carries this exact credit.
          data.couponAmount = newCredit.couponAmount;
          if (stored.type === 'exchange') data.totalRefundAmount = newCredit.couponAmount;
        }
        if (freshPlan.clearsOverride) {
          data.couponAmountOverride = null;
          data.couponAmountOverrideBy = null;
          data.couponAmountOverrideAt = null;
          data.couponAmountOverrideNote = null;
        }
        if (freshPlan.dropsExchangeLines) {
          data.exchangeMode = 'coupon';
          data.exchangeCreditAmount = null;
          data.exchangePaymentMethod = null;
          data.leftoverCouponAmount = null;
        } else if (fresh.exchangeMode === 'order' && !fresh.exchangeOrderId) {
          // Saved replacements remain; "retry" builds the order from this credit.
          data.exchangeCreditAmount = stored.creditAmount;
        }
        if (freshPlan.resetRefundStatus) {
          data.refundStatus = 'none';
          data.refundError = null;
          data.refundTransactionId = null;
        }

        const current = await deps.db.returnRequest.findUnique({ where: { id: fresh.id }, select: { processingAudit: true } });
        const audit = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
        data.processingAudit = [
          ...audit,
          {
            at: now.toISOString(),
            step: 'type_change',
            result: 'ok',
            by: input.actor,
            details: {
              changes: freshPlan.diffs.map((diff) => ({
                product: diff.productName,
                variant: diff.variantName,
                from: diff.from.type,
                to: diff.to.type,
                refundIncluded: diff.to.type === 'return' ? diff.to.refundIncluded : undefined,
              })),
              before: preview.before,
              after: preview.after,
              coupon: couponOutcome,
              clearedOverride: freshPlan.clearsOverride || undefined,
              droppedReplacementLines: freshPlan.dropsExchangeLines || undefined,
              confirmed: freshPlan.warnings.filter((warning) => warning.confirm).map((warning) => warning.code),
              note: input.note?.trim() || undefined,
            },
          },
        ] as any;

        await deps.db.$transaction(async (tx) => {
          for (const diff of freshPlan.diffs) {
            await tx.returnItem.update({
              where: { id: diff.itemId },
              data: { type: diff.to.type, refundIncluded: diff.to.refundIncluded },
            });
          }
          if (freshPlan.dropsExchangeLines) {
            await tx.returnExchangeLine.deleteMany({ where: { returnRequestId: fresh.id } });
          }
          await tx.returnRequest.update({ where: { id: fresh.id }, data });
        });

        if (couponOutcome === 'revoked') message = `تم الحفظ وحذف الكوبون ${fresh.couponCode} من سلة.`;
        if (couponOutcome === 'updated' && newCredit && fresh.couponCode) {
          message = `تم الحفظ وتحديث قيمة الكوبون ${fresh.couponCode}.`;
          if (input.notifyCustomer) {
            const expiryDate = new Date(now.getTime() + COUPON_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
            const notification = await deps
              .notifyCoupon({
                customerName: fresh.customerName,
                customerPhone: fresh.customerPhone,
                orderNumber: fresh.orderNumber,
                couponCode: fresh.couponCode,
                discountedAmount: toSallaCouponAmount(newCredit.couponAmountSar),
                fullAmount: round(newCredit.couponAmount),
                currency: fresh.currency,
                sarFullAmount: newCredit.couponAmountSar,
                expiryDate,
              })
              .catch((error) => ({ status: 'failed' as const, error: String(error) }));
            message += notification.status === 'sent' ? ' وأُرسل للعميل على الواتساب.' : ' (لم يُرسل الواتساب).';
          }
        }
      },
      { db: deps.db },
    );
    if (!locked.ok) {
      return locked.reason === 'not_found'
        ? { ok: false, status: 404, code: 'NOT_FOUND', message: 'طلب الإرجاع غير موجود' }
        : { ok: false, status: 409, code: 'LOCKED', message: STAFF_LOCK_MESSAGE, preview };
    }
  } catch (error) {
    if (error instanceof PieceChangeError) return { ok: false, status: error.status, code: error.code, message: error.message, preview };
    log.error('Piece change failed', { returnRequestId: input.id, error });
    return { ok: false, status: 500, code: 'FAILED', message: 'تعذر حفظ التغييرات', preview };
  }

  log.info('Return pieces changed', { returnRequestId: input.id, by: input.actor, changes: preview.diffs.length });
  return { ok: true, executed: true, preview, message };
}
