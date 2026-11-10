import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteSallaCoupon, getSallaCouponUsage } from '@/app/lib/salla-coupons';
import { extractAppliedCouponCodes } from '@/app/lib/returns/exchange-order';
import { STAFF_LOCK_MESSAGE, withStaffLock } from '@/app/lib/returns/request-lock';

/**
 * Whether an exchange coupon is still unused, so staff may delete it or change
 * its amount (switching pieces back to return, or swapping the coupon for a
 * replacement order). All three must hold; any lookup that fails refuses:
 *
 * 1. No customer order was linked to it (linkExchangeOrderFromWebhook links an
 *    order that applies an EX… coupon).
 * 2. Salla's coupon statistics show no use. Salla counts only orders that
 *    reached "in progress", so this alone misses new or unpaid orders…
 * 3. …hence the local order mirror is also scanned for any order placed since
 *    the coupon was created that carries the code.
 */

export interface CouponRequest {
  merchantId: string;
  couponCode: string | null;
  couponId: string | null;
  couponCreatedAt: Date | null;
  createdAt: Date;
  exchangeMode: string;
  exchangeOrderId: string | null;
  exchangeOrderNumber: string | null;
}

export interface CouponUsageDeps {
  getCouponUsage(merchantId: string, couponId: string): Promise<number | null>;
  /** Order numbers in the mirror carrying the code since `since`, or null when the scan failed. */
  findOrdersUsingCode(merchantId: string, code: string, since: Date): Promise<string[] | null>;
}

export type CouponCheck = { unused: true } | { unused: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export const productionCouponUsageDeps: CouponUsageDeps = {
  getCouponUsage: (merchantId, couponId) => getSallaCouponUsage(merchantId, couponId),
  async findOrdersUsingCode(merchantId, code, since) {
    try {
      const rows = await prisma.$queryRaw<Array<{ orderId: string; orderNumber: string | null; rawOrder: unknown }>>(Prisma.sql`
        SELECT "orderId", "orderNumber", "rawOrder"
        FROM "SallaOrder"
        WHERE "merchantId" = ${merchantId}
          AND ("placedAt" IS NULL OR "placedAt" >= ${since})
          AND "rawOrder"::text ILIKE ${`%${code}%`}
        LIMIT 20
      `);
      const wanted = code.trim().toUpperCase();
      return rows
        .filter((row) => extractAppliedCouponCodes((row.rawOrder ?? {}) as Record<string, any>).includes(wanted))
        .map((row) => row.orderNumber || row.orderId);
    } catch {
      return null;
    }
  },
};

export async function checkCouponUnused(
  request: CouponRequest,
  deps: CouponUsageDeps = productionCouponUsageDeps,
): Promise<CouponCheck> {
  const code = request.couponCode?.trim();
  if (!code) return { unused: false, reason: 'لا يوجد كوبون لهذا الطلب' };

  // In coupon mode exchangeOrderId is the customer's order that used the coupon.
  if (request.exchangeMode !== 'order' && request.exchangeOrderId) {
    return { unused: false, reason: `استخدم العميل الكوبون في الطلب #${request.exchangeOrderNumber || request.exchangeOrderId}` };
  }

  if (request.couponId) {
    const usage = await deps.getCouponUsage(request.merchantId, request.couponId).catch(() => null);
    if (usage === null) return { unused: false, reason: 'تعذر التحقق من استخدام الكوبون في سلة، حاولي بعد قليل' };
    if (usage > 0) return { unused: false, reason: `الكوبون مستخدم في سلة (${usage} طلب)` };
  }

  const since = new Date((request.couponCreatedAt ?? request.createdAt).getTime() - DAY_MS);
  const orders = await deps.findOrdersUsingCode(request.merchantId, code, since).catch(() => null);
  if (orders === null) return { unused: false, reason: 'تعذر البحث في الطلبات عن استخدام الكوبون، حاولي بعد قليل' };
  if (orders.length > 0) return { unused: false, reason: `الكوبون مستخدم في الطلب #${orders[0]}` };
  return { unused: true };
}

export interface RevokeInput {
  id: string;
  actor: string;
  /** Staff ticked "تأكدت أن العميل لم يستخدم الكوبون". */
  confirmUnused?: boolean;
  /** For a coupon entered by hand: staff deleted it in Salla themselves. */
  confirmManualDeleted?: boolean;
}

export type RevokeResult = { ok: true; message: string } | { ok: false; status: number; error: string };

/**
 * Deletes an unused exchange coupon so the credit can go elsewhere (a
 * replacement order, or a switch to a money refund). Runs under the staff lock;
 * Salla first, then the request, so they never disagree.
 */
export async function revokeExchangeCoupon(
  input: RevokeInput,
  deps: CouponUsageDeps & { deleteCoupon(merchantId: string, couponId: string): Promise<boolean> } = {
    ...productionCouponUsageDeps,
    deleteCoupon: deleteSallaCoupon,
  },
): Promise<RevokeResult> {
  const request = await prisma.returnRequest.findUnique({ where: { id: input.id } });
  if (!request) return { ok: false, status: 404, error: 'طلب الإرجاع غير موجود' };
  if (!request.couponCode) return { ok: false, status: 400, error: 'لا يوجد كوبون لهذا الطلب' };
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    return { ok: false, status: 409, error: 'الطلب مغلق؛ أعيديه للمراجعة أولاً.' };
  }
  if (!input.confirmUnused) return { ok: false, status: 409, error: 'أكّدي أن العميل لم يستخدم الكوبون' };
  if (!request.couponId && !input.confirmManualDeleted) {
    return { ok: false, status: 409, error: 'الكوبون أُدخل يدوياً: احذفيه من سلة ثم أكّدي ذلك' };
  }

  const check = await checkCouponUnused(request, deps);
  if (!check.unused) return { ok: false, status: 409, error: check.reason };

  let result: RevokeResult = { ok: false, status: 500, error: 'تعذر إلغاء الكوبون' };
  const locked = await withStaffLock(input.id, async () => {
    if (request.couponId && !(await deps.deleteCoupon(request.merchantId, request.couponId))) {
      result = { ok: false, status: 502, error: 'تعذر حذف الكوبون من سلة؛ لم يتغير شيء.' };
      return;
    }
    const current = await prisma.returnRequest.findUnique({ where: { id: input.id }, select: { processingAudit: true } });
    const audit = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
    await prisma.returnRequest.updateMany({
      where: { id: input.id, couponCode: request.couponCode },
      data: {
        couponCode: null,
        couponId: null,
        couponCreatedAt: null,
        processingAudit: [
          ...audit,
          {
            at: new Date().toISOString(),
            step: 'coupon',
            result: 'ok',
            by: input.actor,
            details: { revoked: true, code: request.couponCode, manual: !request.couponId },
          },
        ] as any,
      },
    });
    result = { ok: true, message: `تم إلغاء الكوبون ${request.couponCode}. يمكنك الآن إنشاء طلب بديل أو تغيير نوع القطع.` };
  });
  if (!locked.ok) return { ok: false, status: 409, error: STAFF_LOCK_MESSAGE };
  return result;
}
