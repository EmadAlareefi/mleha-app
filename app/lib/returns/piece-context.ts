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
import { getActiveReturnWindowOverride } from '@/lib/returns/window-override';
import {
  claimedPieceKeys,
  expandOrderPieces,
  pieceKey,
  productEligibility,
  type OrderPiece,
  type PieceEligibility,
  type PieceRuleContext,
  type WindowOverrideScope,
} from '@/lib/returns/pieces';

/**
 * Loads everything the per-piece rules need for one order: categories,
 * delivery date / window, admin override and pieces already claimed by
 * earlier active requests. Shared by `/api/returns/check` (to show the form)
 * and `/api/returns/create` (to enforce it).
 */
/**
 * Which products are past their return window. With an admin exception and no
 * known delivery date, every product counts as past it, so the exception's
 * scope (return / exchange) still applies instead of allowing both.
 */
export function buildWindowContext(input: {
  categoriesByProductId: Record<string, string[]>;
  productIds: string[];
  deliveryDate: Date | null;
  hasOverride: boolean;
}) {
  const windowExpiredProductIds = new Set<string>();
  const windowExpiredMessages: Record<string, string> = {};
  if (input.deliveryDate) {
    const evaluations = evaluateReturnWindowByProductId({
      categoriesByProductId: input.categoriesByProductId,
      deliveryDate: input.deliveryDate,
    });
    for (const [productId, evaluation] of Object.entries(evaluations)) {
      if (!evaluation.eligible) {
        windowExpiredProductIds.add(productId);
        windowExpiredMessages[productId] = evaluation.policy.message;
      }
    }
  } else if (input.hasOverride) {
    input.productIds.forEach((productId) => windowExpiredProductIds.add(productId));
  }
  return { windowExpiredProductIds, windowExpiredMessages };
}

export async function loadPieceRules(merchantId: string, order: any) {
  const pieces = expandOrderPieces(order);
  const productIds = Array.from(new Set(pieces.map((piece) => piece.productId)));
  const [categoriesByProductId, override, deliveryDateResult, existing] = await Promise.all([
    getCategoryNamesByProductId(merchantId, productIds),
    getActiveReturnWindowOverride(merchantId, String(order.id)),
    resolveReturnDeliveryDate(merchantId, order),
    prisma.returnRequest.findMany({
      where: { merchantId, orderId: String(order.id), status: { notIn: ['cancelled', 'rejected'] } },
      select: { items: { select: { orderItemId: true, unitIndex: true, productId: true, variantId: true, quantity: true } } },
    }),
  ]);

  const windowOverride = Boolean(override);
  const windowOverrideScope: WindowOverrideScope | null = override?.scope ?? null;
  const deliveryDate = deliveryDateResult.date;
  const { windowExpiredProductIds, windowExpiredMessages } = buildWindowContext({
    categoriesByProductId,
    productIds,
    deliveryDate,
    hasOverride: windowOverride,
  });

  const ctx: PieceRuleContext = {
    oneRiyalProductIds: getOneRiyalOfferProductIds(categoriesByProductId),
    discountedProductIds: getDiscountedProductIds(categoriesByProductId),
    outletProductIds: getOutletProductIds(categoriesByProductId),
    nationalDayProductIds: getNationalDayOffersProductIds(categoriesByProductId),
    windowExpiredProductIds,
    windowExpiredMessages,
    windowOverride,
    windowOverrideScope,
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
    windowOverrideScope,
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
  returnOnlyReason?: string;
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
      returnOnlyReason: eligibility.returnOnlyReason,
      alreadyRequested,
    };
  });
}
