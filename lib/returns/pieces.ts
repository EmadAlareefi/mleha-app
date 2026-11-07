import { ONE_RIYAL_OFFER_ITEM_MESSAGE } from './categories';
import { RIBBON_REMOVED_MESSAGE } from './protection-ribbon';
import { getOrderItemUnitPrice } from './item-price';
import { getOrderItemProductId } from './order-item-id';

/**
 * Returns v2 works on *pieces*: one physical unit of one order line. A line
 * with quantity 2 is two pieces, and each piece carries its own return or
 * exchange choice. Category and window rules are keyed by product, so two
 * pieces of the same product always get the same rules, but the customer can
 * still return one and exchange the other.
 *
 * Everything here is pure so the rules can be tested without Salla or a DB.
 */

export type PieceType = 'return' | 'exchange';
export const PIECE_TYPES: readonly PieceType[] = ['return', 'exchange'];

export type PieceBlockCode =
  | 'ONE_RIYAL_OFFER'
  | 'DISCOUNTED_CATEGORY'
  | 'RETURN_PERIOD_EXPIRED'
  | 'RIBBON_REMOVED'
  | 'ALREADY_REQUESTED';

export interface PieceEligibility {
  allowedTypes: PieceType[];
  blockedCode?: PieceBlockCode;
  blockedReason?: string;
  /** Set when only exchange is allowed, to explain why return is disabled. */
  exchangeOnlyReason?: string;
}

export interface PieceRuleContext {
  oneRiyalProductIds: Set<string>;
  discountedProductIds: Set<string>;
  outletProductIds: Set<string>;
  nationalDayProductIds: Set<string>;
  windowExpiredProductIds: Set<string>;
  windowExpiredMessages?: Record<string, string>;
  /** An admin override exempts only the time-window rule. */
  windowOverride?: boolean;
}

export const DISCOUNTED_PIECE_MESSAGE = 'منتجات التخفيضات غير قابلة للإرجاع أو الاستبدال';
export const OUTLET_EXCHANGE_ONLY_MESSAGE = 'منتجات اوتليت مليحة متاحة للاستبدال فقط';
export const NATIONAL_DAY_EXCHANGE_ONLY_MESSAGE = 'منتجات عروض اليوم الوطني متاحة للاستبدال فقط';
export const WINDOW_EXPIRED_PIECE_MESSAGE = 'انتهت مدة الإرجاع المسموحة لهذا المنتج';
export const ALREADY_REQUESTED_PIECE_MESSAGE = 'تم تقديم طلب لهذه القطعة مسبقاً';

/** Rules for one product, independent of which piece of it the customer picks. */
export function productEligibility(productId: string, ctx: PieceRuleContext): PieceEligibility {
  // Precedence mirrors the original create route: a 1 SAR item would otherwise
  // be reported as "exchange only" through its other categories.
  if (ctx.oneRiyalProductIds.has(productId)) {
    return { allowedTypes: [], blockedCode: 'ONE_RIYAL_OFFER', blockedReason: ONE_RIYAL_OFFER_ITEM_MESSAGE };
  }
  if (ctx.discountedProductIds.has(productId)) {
    return { allowedTypes: [], blockedCode: 'DISCOUNTED_CATEGORY', blockedReason: DISCOUNTED_PIECE_MESSAGE };
  }
  if (!ctx.windowOverride && ctx.windowExpiredProductIds.has(productId)) {
    return {
      allowedTypes: [],
      blockedCode: 'RETURN_PERIOD_EXPIRED',
      blockedReason: ctx.windowExpiredMessages?.[productId] || WINDOW_EXPIRED_PIECE_MESSAGE,
    };
  }
  if (ctx.outletProductIds.has(productId)) {
    return { allowedTypes: ['exchange'], exchangeOnlyReason: OUTLET_EXCHANGE_ONLY_MESSAGE };
  }
  if (ctx.nationalDayProductIds.has(productId)) {
    return { allowedTypes: ['exchange'], exchangeOnlyReason: NATIONAL_DAY_EXCHANGE_ONLY_MESSAGE };
  }
  return { allowedTypes: ['return', 'exchange'] };
}

export const pieceKey = (orderItemId: string | number, unitIndex: number) =>
  `${String(orderItemId).trim()}:${unitIndex}`;

interface OrderLineLike {
  id?: string | number;
  quantity?: number | string;
  [key: string]: any;
}

export interface OrderPiece {
  orderItemId: string;
  unitIndex: number;
  /** How many pieces the line has, for "piece 1 of 2" labels. */
  lineQuantity: number;
  productId: string;
  variantId?: string;
  variantName?: string;
  productName: string;
  productSku?: string;
  unitPrice: number;
}

/** Expands every order line into one entry per physical piece. */
export function expandOrderPieces(order: { items?: OrderLineLike[] | null } | null | undefined): OrderPiece[] {
  const pieces: OrderPiece[] = [];
  for (const line of order?.items || []) {
    const orderItemId = String(line?.id ?? '').trim();
    const quantity = Math.max(0, Math.floor(Number(line?.quantity) || 0));
    if (!orderItemId || quantity < 1) continue;
    const base = {
      orderItemId,
      lineQuantity: quantity,
      productId: getOrderItemProductId(line) || orderItemId,
      variantId: line.variant?.id ? String(line.variant.id) : undefined,
      variantName: line.variant?.name,
      productName: line.name || line.product?.name || 'منتج',
      productSku: line.sku || line.product?.sku,
      unitPrice: getOrderItemUnitPrice(line as any),
    };
    for (let unitIndex = 0; unitIndex < quantity; unitIndex++) {
      pieces.push({ ...base, unitIndex });
    }
  }
  return pieces;
}

export interface StoredPieceRow {
  orderItemId?: string | null;
  unitIndex?: number | null;
  productId: string;
  variantId?: string | null;
  quantity: number;
}

/**
 * Pieces already claimed by earlier active requests on the same order.
 *
 * v2 rows name their piece exactly. Legacy rows only carry product/variant and
 * a quantity, so they claim that many of the lowest still-free pieces on the
 * first matching line(s), which is what the old form would have picked.
 */
export function claimedPieceKeys(pieces: OrderPiece[], rows: StoredPieceRow[]): Set<string> {
  const claimed = new Set<string>();
  for (const row of rows) {
    if (row.orderItemId && Number.isInteger(row.unitIndex)) {
      claimed.add(pieceKey(row.orderItemId, row.unitIndex as number));
    }
  }
  for (const row of rows) {
    if (row.orderItemId && Number.isInteger(row.unitIndex)) continue;
    let remaining = Math.max(0, Math.floor(row.quantity || 0));
    for (const piece of pieces) {
      if (remaining === 0) break;
      const sameLine = row.orderItemId
        ? piece.orderItemId === String(row.orderItemId)
        : piece.productId === String(row.productId) &&
          (!row.variantId || piece.variantId === String(row.variantId));
      const key = pieceKey(piece.orderItemId, piece.unitIndex);
      if (sameLine && !claimed.has(key)) {
        claimed.add(key);
        remaining--;
      }
    }
  }
  return claimed;
}

export interface RequestedPiece {
  orderItemId?: string | number;
  unitIndex?: number;
  type?: string;
  /** true = protection ribbon removed (not eligible). */
  ribbonRemoved?: unknown;
}

export interface ResolvedPiece extends OrderPiece {
  type: PieceType;
  ribbonRemoved: false;
}

export type ResolvePiecesResult =
  | { ok: true; pieces: ResolvedPiece[] }
  | {
      ok: false;
      code:
        | 'EMPTY'
        | 'UNKNOWN_PIECE'
        | 'DUPLICATE_PIECE'
        | 'INVALID_TYPE'
        | 'RIBBON_UNANSWERED'
        | PieceBlockCode
        | 'EXCHANGE_ONLY';
      error: string;
      piece?: OrderPiece;
    };

/**
 * Validates what the customer submitted against the order and the rules.
 * Only `orderItemId`, `unitIndex`, `type` and the ribbon answer come from the
 * request; price, name and variant are read back from the order.
 */
export function resolveRequestedPieces(
  order: { items?: OrderLineLike[] | null } | null | undefined,
  requested: RequestedPiece[] | null | undefined,
  options: {
    rules: (productId: string) => PieceEligibility;
    claimed?: Set<string>;
  },
): ResolvePiecesResult {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, code: 'EMPTY', error: 'الرجاء اختيار قطعة واحدة على الأقل' };
  }
  const byKey = new Map(expandOrderPieces(order).map((piece) => [pieceKey(piece.orderItemId, piece.unitIndex), piece]));
  const seen = new Set<string>();
  const pieces: ResolvedPiece[] = [];

  for (const entry of requested) {
    const unitIndex = Number(entry?.unitIndex);
    const key = pieceKey(entry?.orderItemId ?? '', unitIndex);
    const piece = Number.isInteger(unitIndex) ? byKey.get(key) : undefined;
    if (!piece) {
      return { ok: false, code: 'UNKNOWN_PIECE', error: 'أحد المنتجات المحددة غير موجود في هذا الطلب' };
    }
    if (seen.has(key)) {
      return { ok: false, code: 'DUPLICATE_PIECE', error: 'المنتجات المحددة غير صحيحة أو مكررة.', piece };
    }
    seen.add(key);

    if (entry.type !== 'return' && entry.type !== 'exchange') {
      return { ok: false, code: 'INVALID_TYPE', error: 'الرجاء اختيار استرجاع أو استبدال لكل قطعة', piece };
    }
    if (typeof entry.ribbonRemoved !== 'boolean') {
      return { ok: false, code: 'RIBBON_UNANSWERED', error: 'الرجاء تحديد حالة شريط الحماية لكل قطعة قبل المتابعة.', piece };
    }
    if (entry.ribbonRemoved) {
      return { ok: false, code: 'RIBBON_REMOVED', error: RIBBON_REMOVED_MESSAGE, piece };
    }
    if (options.claimed?.has(key)) {
      return { ok: false, code: 'ALREADY_REQUESTED', error: ALREADY_REQUESTED_PIECE_MESSAGE, piece };
    }

    const eligibility = options.rules(piece.productId);
    if (eligibility.blockedCode) {
      return { ok: false, code: eligibility.blockedCode, error: eligibility.blockedReason || 'هذا المنتج غير قابل للإرجاع', piece };
    }
    if (!eligibility.allowedTypes.includes(entry.type)) {
      return { ok: false, code: 'EXCHANGE_ONLY', error: eligibility.exchangeOnlyReason || 'هذا المنتج متاح للاستبدال فقط', piece };
    }

    pieces.push({ ...piece, type: entry.type, ribbonRemoved: false });
  }

  return { ok: true, pieces };
}

interface LegacyItem {
  orderItemId?: string | number;
  quantity?: number;
  ribbonRemoved?: unknown;
}

/**
 * Converts the pre-v2 payload (one type, `quantity` per line plus one ribbon
 * answer per piece) so a browser still running the old bundle during a deploy
 * keeps working. It picks the first `quantity` intact pieces of each line.
 */
export function legacyItemsToPieces(items: LegacyItem[] | null | undefined, type: unknown): RequestedPiece[] | null {
  if (!Array.isArray(items)) return null;
  const pieces: RequestedPiece[] = [];
  for (const item of items) {
    const answers = Array.isArray(item?.ribbonRemoved) ? (item.ribbonRemoved as unknown[]) : [];
    let wanted = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    answers.forEach((removed, unitIndex) => {
      if (wanted > 0 && removed === false) {
        pieces.push({ orderItemId: item.orderItemId, unitIndex, type: String(type), ribbonRemoved: false });
        wanted--;
      }
    });
    // Not enough intact pieces: submit one removed piece so validation names the reason.
    if (wanted > 0) {
      const removedIndex = answers.findIndex((removed) => removed === true);
      pieces.push({
        orderItemId: item.orderItemId,
        unitIndex: removedIndex >= 0 ? removedIndex : 0,
        type: String(type),
        ribbonRemoved: removedIndex >= 0 ? true : undefined,
      });
    }
  }
  return pieces;
}

/** `return`, `exchange`, or `mixed` when a request has both. */
export function deriveRequestType(types: Iterable<string>): 'return' | 'exchange' | 'mixed' {
  const set = new Set(types);
  if (set.has('return') && set.has('exchange')) return 'mixed';
  return set.has('exchange') ? 'exchange' : 'return';
}
