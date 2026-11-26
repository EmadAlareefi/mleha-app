import { splitRequestFinancials } from './request-financials';

type NumericValue = number | string | { toString(): string } | null | undefined;

export interface ERPCreditPiece {
  type: string | null;
  price: NumericValue;
  quantity: number;
  refundIncluded: boolean | null;
}

export interface ERPCreditRequest {
  returnFee: NumericValue;
  shippingAmount: NumericValue;
  refundStatus: string | null;
  refundedAmount: NumericValue;
  couponAmountOverride: NumericValue;
  items: ERPCreditPiece[];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Pieces the customer was paid or credited for. A return piece staff excluded
 * from the refund (e.g. damaged) brought the customer nothing, so ERP does not
 * credit it. Exchange pieces always become coupon credit.
 */
export function isCreditedPiece(piece: Pick<ERPCreditPiece, 'type' | 'refundIncluded'>): boolean {
  return piece.type === 'exchange' || piece.refundIncluded !== false;
}

/**
 * What one return/exchange request credits in ERP and what the customer
 * actually received (refund + exchange coupon), in the order currency. The
 * fee is the difference, so ERP net (credit note − fee invoice) equals what
 * the customer got. A waived fee comes out as 0.
 */
export function getRequestCreditAmounts(request: ERPCreditRequest): {
  credited: number;
  customerValue: number;
  fee: number;
} {
  const shipping = Math.max(0, Number(request.shippingAmount ?? 0) || 0);
  const fee = Math.max(0, Number(request.returnFee ?? 0) || 0);
  const split = splitRequestFinancials({
    pieces: request.items.map((item) => ({
      type: item.type === 'exchange' ? 'exchange' : 'return',
      price: item.price,
      quantity: item.quantity,
      refundIncluded: item.refundIncluded !== false,
    })),
    originalShipping: shipping,
    returnProcessingFee: fee,
    exchangeProcessingFee: fee,
  });

  const credited = roundMoney(
    request.items
      .filter(isCreditedPiece)
      .reduce((total, item) => total + Number(item.price ?? 0) * item.quantity, 0) + shipping
  );
  const refund =
    request.refundStatus === 'refunded' && request.refundedAmount != null
      ? Number(request.refundedAmount)
      : split.refundAmount;
  const coupon =
    request.couponAmountOverride != null ? Number(request.couponAmountOverride) : split.couponAmount;
  const customerValue = roundMoney(refund + coupon);

  return { credited, customerValue, fee: roundMoney(Math.max(0, credited - customerValue)) };
}
