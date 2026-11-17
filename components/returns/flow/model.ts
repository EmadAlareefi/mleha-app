import { buildReturnFeeQuote, getOriginalShippingFee, type ReturnFeeQuote } from '@/lib/returns/fees';
import { getItemAttributes } from '@/lib/returns/item-attributes';
import { getOrderItemUnitListPrice, getOrderItemUnitPrice } from '@/lib/returns/item-price';
import { pieceKey, type PieceType } from '@/lib/returns/pieces';
import { splitRequestFinancials, type SplitFinancials } from '@/lib/returns/request-financials';
import { planExchangeSettlement, type ExchangeSettlement } from '@/lib/returns/exchange-settlement';
import { CUSTOMER_REASONS } from '@/lib/returns/reasons';
import type { PublicPiece } from '@/app/lib/returns/piece-context';
import type { ExchangeCartLine } from '@/components/returns/ExchangePicker';
import type { Calc, CalcRow } from './ui';

export interface OrderItem {
  id: number;
  product_id?: number | string;
  productId?: number | string;
  name?: string;
  sku?: string;
  thumbnail?: string;
  currency?: string;
  images?: { image?: string }[];
  product?: { id?: number | string; name: string; sku?: string; price: number; thumbnail?: string };
  variant?: { id: number; name: string };
  quantity: number;
  amounts?: Record<string, unknown>;
}

export interface ReturnsOrder {
  id: number;
  reference_id: string;
  status: { name: string; slug: string } | string;
  amounts: {
    total: { amount: number; currency: string };
    shipping_cost?: { amount: number; taxable?: boolean; currency?: string };
    shipping_tax?: { amount?: number; currency?: string };
    options_total?: { amount: number; currency?: string };
  };
  items: OrderItem[];
  returnFeeQuotes?: { return: ReturnFeeQuote; exchange: ReturnFeeQuote };
  returnFeeQuoteError?: string;
  isInternational?: boolean;
  /** ISO instant the order was placed (from the lookup). */
  placedAt?: string | null;
  /** A packer has already picked the order up. */
  prepStarted?: boolean;
}

export interface PieceState {
  selected: boolean;
  type: PieceType;
  reason: string;
  other: string;
  /** undefined until the customer answers the protection-ribbon question. */
  ribbonRemoved?: boolean;
}

export interface PieceView {
  key: string;
  piece: PublicPiece;
  name: string;
  imageUrl: string | null;
  details: string;
  /** What the customer paid for this piece (after discounts): what is refunded. */
  price: number;
  /** Price before discounts, shown struck through when higher than `price`. */
  listPrice: number;
}

export type ExchangeMode = 'order' | 'coupon';

export const reasonLabel = (type: PieceType, value: string) =>
  CUSTOMER_REASONS[type].find((reason) => reason.value === value)?.label ?? '';

/** Fallback when /api/returns/check sent no pieces: every piece open, the server decides. */
export function piecesFromOrder(order: ReturnsOrder): PublicPiece[] {
  return (order.items ?? []).flatMap((item) =>
    Array.from({ length: Math.max(0, item.quantity) }, (_, unitIndex) => ({
      orderItemId: String(item.id),
      unitIndex,
      lineQuantity: item.quantity,
      productId: String(item.product?.id ?? item.product_id ?? item.productId ?? item.id),
      allowedTypes: ['return', 'exchange'] as PieceType[],
      alreadyRequested: false,
    })),
  );
}

export function itemImage(item: OrderItem | undefined): string | null {
  return item?.images?.[0]?.image || item?.product?.thumbnail || item?.thumbnail || null;
}

export function itemDetails(item: OrderItem | undefined): string {
  if (!item) return '';
  const { color, size } = getItemAttributes(item);
  return [size && `المقاس: ${size}`, color && `اللون: ${color}`].filter(Boolean).join(' · ') || item.variant?.name || '';
}

export function buildPieceViews(order: ReturnsOrder, pieces: PublicPiece[]): PieceView[] {
  const items = new Map((order.items ?? []).map((item) => [String(item.id), item]));
  return pieces
    .filter((piece) => items.has(piece.orderItemId))
    .map((piece) => {
      const item = items.get(piece.orderItemId)!;
      const name = item.name || item.product?.name || 'منتج';
      const unit = piece.lineQuantity > 1 ? ` (القطعة ${piece.unitIndex + 1} من ${piece.lineQuantity})` : '';
      return {
        key: pieceKey(piece.orderItemId, piece.unitIndex),
        piece,
        name: `${name}${unit}`,
        imageUrl: itemImage(item),
        details: itemDetails(item),
        price: getOrderItemUnitPrice(item as Parameters<typeof getOrderItemUnitPrice>[0]),
        listPrice: getOrderItemUnitListPrice(item as Parameters<typeof getOrderItemUnitListPrice>[0]),
      };
    });
}

export function orderCurrency(order: ReturnsOrder) {
  return order.returnFeeQuotes?.return?.currency || order.amounts?.total?.currency || 'SAR';
}

export interface Money {
  currency: string;
  split: SplitFinancials;
  settlement: ExchangeSettlement;
  cartTotal: number;
  hasReturn: boolean;
  hasExchange: boolean;
  replacing: boolean;
  returnCount: number;
  exchangeCount: number;
}

export function computeMoney(
  order: ReturnsOrder,
  chosen: Array<{ view: PieceView; state: PieceState }>,
  mode: ExchangeMode,
  cart: ExchangeCartLine[],
): Money {
  const currency = orderCurrency(order);
  const returnQuote = order.returnFeeQuotes?.return ?? buildReturnFeeQuote('return', currency, 1, 'sar');
  const exchangeQuote = order.returnFeeQuotes?.exchange ?? buildReturnFeeQuote('exchange', currency, 1, 'sar');
  const split = splitRequestFinancials({
    pieces: chosen.map(({ view, state }) => ({ type: state.type, price: view.price })),
    originalShipping: getOriginalShippingFee(order.amounts),
    returnProcessingFee: returnQuote.processingFee,
    exchangeProcessingFee: exchangeQuote.processingFee,
  });
  const returnCount = chosen.filter(({ state }) => state.type === 'return').length;
  const exchangeCount = chosen.length - returnCount;
  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return {
    currency,
    split,
    settlement: planExchangeSettlement(split.couponAmount, cartTotal),
    cartTotal,
    hasReturn: returnCount > 0,
    hasExchange: exchangeCount > 0,
    replacing: exchangeCount > 0 && mode === 'order',
    returnCount,
    exchangeCount,
  };
}

const FEE_EXCEEDS_NOTE =
  'رسوم الشحن أكبر من المبلغ المدفوع للقطعة (بعد الخصم أو الكوبون المستخدم في الطلب)، لذلك لا يوجد مبلغ يُسترد.';
const FEE_EXCEEDS_COUPON_NOTE =
  'رسوم الشحن أكبر من المبلغ المدفوع للقطعة (بعد الخصم أو الكوبون المستخدم في الطلب)، لذلك لا يتبقى رصيد للكوبون.';

const countLabel = (base: string, plural: string, count: number) => (count > 1 ? `${plural} (${count})` : base);

/** The money card in the prototype's layout, fed by the real split. */
export function buildCalc(money: Money): Calc {
  const { split, settlement, hasReturn, hasExchange, replacing } = money;
  const mixed = hasReturn && hasExchange;
  const rows: CalcRow[] = [];
  if (hasExchange) {
    rows.push({
      label: mixed ? countLabel('قيمة قطعة الاستبدال', 'قيمة قطع الاستبدال', money.exchangeCount) : countLabel('قيمة القطعة', 'قيمة القطع', money.exchangeCount),
      value: split.exchangeItemsTotal,
    });
  }
  if (hasReturn) {
    rows.push({
      label: mixed ? countLabel('قيمة قطعة الاسترجاع', 'قيمة قطع الاسترجاع', money.returnCount) : countLabel('قيمة القطعة', 'قيمة القطع', money.returnCount),
      value: split.returnItemsTotal,
    });
  }
  if (split.originalShipping > 0) rows.push({ label: 'شحن الطلب الأصلي', value: split.originalShipping, sub: 'يُضاف لأنكِ دفعتِه عند الشراء' });
  rows.push({ label: mixed ? 'رسوم الشحن (مرة واحدة)' : 'رسوم الشحن', value: split.processingFee, minus: true, sub: mixed ? 'تُخصم من المبلغ المسترد' : undefined });

  if (!hasExchange) {
    return {
      rows,
      totalLabel: 'المبلغ المسترد',
      totalValue: split.refundAmount,
      note: split.refundAmount <= 0 ? FEE_EXCEEDS_NOTE : 'يتحدد المبلغ النهائي بعد فحص القطعة.',
    };
  }
  if (!replacing) {
    if (!hasReturn) {
      return { rows, totalLabel: 'رصيد الكوبون', totalValue: split.couponAmount, note: split.couponAmount <= 0 ? FEE_EXCEEDS_COUPON_NOTE : undefined };
    }
    rows.push({ label: 'رصيد الكوبون (قطع الاستبدال)', value: split.couponAmount, strong: true });
    return { rows, totalLabel: 'المبلغ المسترد', totalValue: split.refundAmount, note: 'يتحدد المبلغ المسترد نهائيًا بعد فحص القطعة.' };
  }
  rows.push({ label: 'رصيد الاستبدال', value: split.couponAmount, strong: true });
  if (hasReturn) rows.push({ label: 'المبلغ المسترد (قطع الاسترجاع)', value: split.refundAmount, strong: true, sub: 'يتحدد نهائيًا بعد فحص القطعة' });
  if (money.cartTotal > 0) rows.push({ label: 'سعر البديل', value: money.cartTotal, minus: true });
  if (settlement.needsPayment) return { rows, totalLabel: 'المطلوب دفعه', totalValue: settlement.amountDue, due: true };
  if (settlement.leftover > 0 && money.cartTotal > 0) {
    return { rows, totalLabel: 'رصيد متبقٍ يصلك ككوبون', totalValue: settlement.leftover, note: 'يصلك الكوبون عبر واتساب بعد فحص القطعة.' };
  }
  return { rows, totalLabel: 'لا يوجد مبلغ مستحق', totalValue: 0 };
}
