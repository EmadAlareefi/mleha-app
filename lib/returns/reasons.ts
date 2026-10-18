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
  { value: 'other', label: 'أخرى' },
] as const;

export const RETURN_REASON_LABELS: Record<string, string> = Object.fromEntries(
  RETURN_REASONS.map((reason) => [reason.value, reason.label])
);

export const FALLBACK_RETURN_REASON_LABEL = 'أسباب غير مصنفة';

export function returnReasonLabel(reason: string | null | undefined): string {
  return (reason && RETURN_REASON_LABELS[reason]) || FALLBACK_RETURN_REASON_LABEL;
}
