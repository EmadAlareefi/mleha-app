export type ReturnItemCondition =
  | 'good'
  | 'worn'
  | 'missing_parts'
  | 'damaged';

export const CONDITION_LABELS: Record<ReturnItemCondition, string> = {
  good: 'سليم',
  worn: 'ملبوس',
  missing_parts: 'ناقص',
  damaged: 'تالف',
};

export const CONDITION_DESCRIPTIONS: Record<ReturnItemCondition, string> = {
  good: 'لا توجد ملاحظات ويبدو المنتج صالحًا للبيع مباشرة',
  worn: 'تم ارتداؤه أو فتحه ويحتاج تنظيفاً أو تقييم سعره مجددًا',
  missing_parts: 'تم استلامه ناقص الملحقات أو بدون التغليف الكامل',
  damaged: 'تالف ولا يمكن بيعه مرة أخرى',
};

export const CONDITION_ORDER: ReturnItemCondition[] = [
  'good',
  'worn',
  'missing_parts',
  'damaged',
];

export function isReturnItemCondition(value: unknown): value is ReturnItemCondition {
  return typeof value === 'string' && (CONDITION_ORDER as string[]).includes(value);
}

export interface InspectionBadge {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
}

export interface InspectionSummary {
  totalUnits: number;
  inspectedUnits: number;
  outstandingUnits: number;
  flaggedUnits: number;
  breakdown: Record<ReturnItemCondition, number>;
  badges: InspectionBadge[];
}

type InspectableItem = {
  quantity?: number | null;
  conditionStatus?: ReturnItemCondition | null;
};

const emptyBreakdown = (): Record<ReturnItemCondition, number> => ({
  good: 0,
  worn: 0,
  missing_parts: 0,
  damaged: 0,
});

/**
 * Summarize condition selections for return items.
 */
export function summarizeItemConditions(items: InspectableItem[]): InspectionSummary {
  const summary: InspectionSummary = {
    totalUnits: 0,
    inspectedUnits: 0,
    outstandingUnits: 0,
    flaggedUnits: 0,
    breakdown: emptyBreakdown(),
    badges: [],
  };

  items.forEach((item) => {
    const units = Math.max(1, item.quantity ?? 1);
    summary.totalUnits += units;

    if (item.conditionStatus && CONDITION_ORDER.includes(item.conditionStatus)) {
      summary.inspectedUnits += units;
      summary.breakdown[item.conditionStatus] += units;
    } else {
      summary.outstandingUnits += units;
    }
  });

  summary.flaggedUnits =
    summary.inspectedUnits - summary.breakdown.good;

  const badges: InspectionBadge[] = [];

  if (summary.totalUnits === 0) {
    badges.push({
      label: 'لا توجد عناصر في طلب الإرجاع',
      tone: 'muted',
    });
  } else if (summary.inspectedUnits === 0) {
    badges.push({
      label: 'بانتظار فحص المرتجع',
      tone: 'warning',
    });
  } else if (summary.outstandingUnits > 0) {
    badges.push({
      label: `تم فحص ${summary.inspectedUnits}/${summary.totalUnits} عناصر`,
      tone: 'warning',
    });
  } else if (summary.flaggedUnits === 0) {
    badges.push({
      label: 'كافة العناصر سليمة',
      tone: 'success',
    });
  } else {
    badges.push({
      label: `${summary.flaggedUnits} عنصر بحاجة لاتخاذ قرار`,
      tone: summary.flaggedUnits > 1 ? 'danger' : 'warning',
    });
  }

  (['worn', 'missing_parts', 'damaged'] as ReturnItemCondition[]).forEach((key) => {
    if (summary.breakdown[key] > 0) {
      badges.push({
        label: `${summary.breakdown[key]} ${CONDITION_LABELS[key]}`,
        tone: key === 'worn' ? 'warning' : 'danger',
      });
    }
  });

  summary.badges = badges;
  return summary;
}
