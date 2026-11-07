import { prisma } from '@/lib/prisma';
import {
  evaluateReturnWindowByProductId,
  getCategoryNamesByProductId,
  getDiscountedProductIds,
  getNationalDayOffersProductIds,
  getOneRiyalOfferProductIds,
  getOutletProductIds,
  resolveReturnDeliveryDate,
} from '@/lib/returns/policy';
import { hasActiveReturnWindowOverride } from '@/lib/returns/window-override';
import {
  claimedPieceKeys,
  expandOrderPieces,
  pieceKey,
  productEligibility,
  type OrderPiece,
  type PieceEligibility,
  type PieceRuleContext,
} from '@/lib/returns/pieces';

/**
 * Loads everything the per-piece rules need for one order: categories,
 * delivery date / window, admin override and pieces already claimed by
 * earlier active requests. Shared by `/api/returns/check` (to show the form)
 * and `/api/returns/create` (to enforce it).
 */
export async function loadPieceRules(merchantId: string, order: any) {
  const pieces = expandOrderPieces(order);
  const productIds = Array.from(new Set(pieces.map((piece) => piece.productId)));
  const [categoriesByProductId, windowOverride, deliveryDateResult, existing] = await Promise.all([
    getCategoryNamesByProductId(merchantId, productIds),
    hasActiveReturnWindowOverride(merchantId, String(order.id)),
    resolveReturnDeliveryDate(merchantId, order),
    prisma.returnRequest.findMany({
      where: { merchantId, orderId: String(order.id), status: { notIn: ['cancelled', 'rejected'] } },
      select: { items: { select: { orderItemId: true, unitIndex: true, productId: true, variantId: true, quantity: true } } },
    }),
  ]);

  const deliveryDate = deliveryDateResult.date;
  const evaluations = deliveryDate
    ? evaluateReturnWindowByProductId({ categoriesByProductId, deliveryDate })
    : {};
  const windowExpiredProductIds = new Set<string>();
  const windowExpiredMessages: Record<string, string> = {};
  for (const [productId, evaluation] of Object.entries(evaluations)) {
    if (!evaluation.eligible) {
      windowExpiredProductIds.add(productId);
      windowExpiredMessages[productId] = evaluation.policy.message;
    }
  }

  const ctx: PieceRuleContext = {
    oneRiyalProductIds: getOneRiyalOfferProductIds(categoriesByProductId),
    discountedProductIds: getDiscountedProductIds(categoriesByProductId),
    outletProductIds: getOutletProductIds(categoriesByProductId),
    nationalDayProductIds: getNationalDayOffersProductIds(categoriesByProductId),
    windowExpiredProductIds,
    windowExpiredMessages,
    windowOverride,
  };

  const claimed = claimedPieceKeys(
    pieces,
    existing.flatMap((request) => request.items),
  );

  return {
    pieces,
    ctx,
    claimed,
    categoriesByProductId,
    windowOverride,
    deliveryDateResult,
    rules: (productId: string): PieceEligibility => productEligibility(productId, ctx),
  };
}

export interface PublicPiece {
  orderItemId: string;
  unitIndex: number;
  lineQuantity: number;
  productId: string;
  allowedTypes: PieceEligibility['allowedTypes'];
  blockedCode?: string;
  blockedReason?: string;
  exchangeOnlyReason?: string;
  alreadyRequested: boolean;
}

/** The per-piece view the customer form renders. */
export function toPublicPieces(
  pieces: OrderPiece[],
  rules: (productId: string) => PieceEligibility,
  claimed: Set<string>,
): PublicPiece[] {
  return pieces.map((piece) => {
    const eligibility = rules(piece.productId);
    const alreadyRequested = claimed.has(pieceKey(piece.orderItemId, piece.unitIndex));
    return {
      orderItemId: piece.orderItemId,
      unitIndex: piece.unitIndex,
      lineQuantity: piece.lineQuantity,
      productId: piece.productId,
      allowedTypes: alreadyRequested ? [] : eligibility.allowedTypes,
      blockedCode: alreadyRequested ? 'ALREADY_REQUESTED' : eligibility.blockedCode,
      blockedReason: alreadyRequested ? 'تم تقديم طلب لهذه القطعة مسبقاً' : eligibility.blockedReason,
      exchangeOnlyReason: eligibility.exchangeOnlyReason,
      alreadyRequested,
    };
  });
}
