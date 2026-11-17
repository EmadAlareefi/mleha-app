/**
 * Predefined return/exchange reasons the customer picks on the returns form,
 * stored as `ReturnRequest.reason`. Shared by the form, returns analytics and
 * the Hermes reports so the Arabic labels stay identical everywhere.
 */
export const RETURN_REASONS = [
  { value: 'defective', label: 'معيب / تالف' },
  { value: 'wrong_item', label: 'منتج خاطئ' },
  { value: 'size_issue', label: 'مشكلة في المقاس' },
  { value: 'changed_mind', label: 'تغيير في الرأي' },
  { value: 'color_mismatch', label: 'اللون مختلف عن الصورة' },
  { value: 'late_delivery', label: 'وصلت متأخرة' },
  { value: 'other', label: 'أخرى' },
] as const;

export type ReturnReasonValue = (typeof RETURN_REASONS)[number]['value'];

/**
 * The per-piece reason lists the customer sees, worded per action. Values are
 * the stored `RETURN_REASONS` values so analytics keep grouping them.
 */
export const CUSTOMER_REASONS: Record<'exchange' | 'return', Array<{ value: ReturnReasonValue; label: string }>> = {
  exchange: [
    { value: 'size_issue', label: 'المقاس غير مناسب' },
    { value: 'color_mismatch', label: 'اللون مختلف عن الصورة' },
    { value: 'defective', label: 'عيب في القطعة' },
    { value: 'late_delivery', label: 'وصلت متأخرة' },
    { value: 'other', label: 'سبب آخر' },
  ],
  return: [
    { value: 'changed_mind', label: 'لم يناسبني التصميم' },
    { value: 'size_issue', label: 'المقاس غير مناسب' },
    { value: 'color_mismatch', label: 'اللون مختلف عن الصورة' },
    { value: 'defective', label: 'عيب في القطعة' },
    { value: 'other', label: 'سبب آخر' },
  ],
};

export const RETURN_REASON_LABELS: Record<string, string> = Object.fromEntries(
  RETURN_REASONS.map((reason) => [reason.value, reason.label])
);

export const FALLBACK_RETURN_REASON_LABEL = 'أسباب غير مصنفة';

export function returnReasonLabel(reason: string | null | undefined): string {
  return (reason && RETURN_REASON_LABELS[reason]) || FALLBACK_RETURN_REASON_LABEL;
}
