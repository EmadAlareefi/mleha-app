import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';
import type { ProblemItem, ProblemReason } from './types';

/**
 * What happens to an order when the packer reports a problem. Same rules as the
 * old page, made explicit (and shown to the packer before confirming):
 * - any item "coming soon", or "other" → review (تحت المراجعة R)
 * - every item missing or damaged     → refund decision (X4)
 * - some items missing, the rest OK   → ship what is available and record the
 *                                        shortage for /order-shortages
 */
export type ProblemOutcome = 'review' | 'refund' | 'partial';

export const PROBLEM_REASON_LABELS: Record<ProblemReason, string> = {
  not_found: 'غير موجود في الموقع',
  damaged: 'تالف',
  coming_soon: 'سيتوفر قريباً',
  other: 'مشكلة أخرى',
};

export const OUTCOME_LABELS: Record<ProblemOutcome, string> = {
  review: 'سيتحوّل الطلب إلى "تحت المراجعة" للمشرف',
  refund: 'سيتحوّل الطلب إلى X4 (غير متوفر – إرجاع مبلغ)',
  partial: 'سيُشحن المتوفر ويُسجَّل النقص لإرجاع المبلغ',
};

export function decideProblemOutcome(itemCount: number, problems: ProblemItem[]): ProblemOutcome | null {
  if (problems.length === 0) return null;
  if (problems.some((item) => item.reason === 'coming_soon' || item.reason === 'other')) return 'review';
  const missing = new Set(problems.map((item) => item.index));
  return missing.size >= itemCount ? 'refund' : 'partial';
}

export function outcomeTargetStatusId(outcome: Exclude<ProblemOutcome, 'partial'>): number {
  return outcome === 'refund' ? STATUS_IDS.UNDER_REVIEW_X4 : STATUS_IDS.UNDER_REVIEW;
}

export function outcomeEscalationReason(outcome: Exclude<ProblemOutcome, 'partial'>, problems: ProblemItem[]): string {
  if (outcome === 'refund') return 'missing_items';
  return problems.some((item) => item.reason === 'coming_soon') ? 'coming_soon' : 'manual_review';
}

/** The note kept on the escalation and written to the Salla order history. */
export function buildProblemNote(orderNumber: string, problems: ProblemItem[], extraNote?: string | null): string {
  const lines = problems.map(
    (item, position) =>
      `${position + 1}- ${item.name || 'منتج بدون اسم'} (SKU: ${item.sku || 'غير متوفر'}) - ${PROBLEM_REASON_LABELS[item.reason]}`,
  );
  const extra = extraNote?.trim() ? `\nملاحظة المجهِّز: ${extraNote.trim().slice(0, 400)}` : '';
  return `المنتجات غير الجاهزة للطلب (${orderNumber}):\n${lines.join('\n')}${extra}`;
}

export function isProblemReason(value: unknown): value is ProblemReason {
  return value === 'not_found' || value === 'damaged' || value === 'coming_soon' || value === 'other';
}
