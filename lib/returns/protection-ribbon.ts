export const RIBBON_REMOVED_MESSAGE =
  'لا يمكن إرجاع أو استبدال الفساتين بعد إزالة شريط الحماية.';
export const RIBBON_UNANSWERED_MESSAGE =
  'الرجاء تحديد حالة شريط الحماية لكل قطعة قبل المتابعة.';

/** true means removed; false means intact. Missing answers never imply intact. */
export function getRibbonEligibility(answers: unknown, orderedQuantity: number) {
  const complete = Number.isInteger(orderedQuantity) && orderedQuantity > 0 &&
    Array.isArray(answers) && answers.length === orderedQuantity &&
    Array.from(answers).every((answer) => typeof answer === 'boolean');

  return {
    complete,
    intactQuantity: complete ? (answers as boolean[]).filter((removed) => !removed).length : 0,
  };
}

interface RibbonRequestItem {
  orderItemId?: number | string;
  quantity?: number;
  ribbonRemoved?: unknown;
}

export function validateRibbonItems(
  order: { items?: { id?: number | string; quantity?: number }[] | null },
  items: RibbonRequestItem[],
): { ok: true } | { ok: false; error: string } {
  const orderItems = new Map((order.items ?? []).map((item) => [String(item.id), item]));
  const seen = new Set<string>();

  for (const item of items) {
    const id = String(item?.orderItemId ?? '').trim();
    const orderedItem = orderItems.get(id);
    // One declaration per order line prevents duplicates from reusing intact pieces.
    if (!orderedItem || seen.has(id)) {
      return { ok: false, error: 'المنتجات المحددة غير صحيحة أو مكررة.' };
    }
    seen.add(id);
    const eligibility = getRibbonEligibility(item.ribbonRemoved, Number(orderedItem.quantity));
    if (!eligibility.complete) {
      return { ok: false, error: RIBBON_UNANSWERED_MESSAGE };
    }
    if (!Number.isInteger(item.quantity) || !item.quantity || item.quantity < 1) {
      return { ok: false, error: 'الكمية المطلوبة غير صحيحة' };
    }
    if (item.quantity > eligibility.intactQuantity) {
      return { ok: false, error: RIBBON_REMOVED_MESSAGE };
    }
  }
  return { ok: true };
}
