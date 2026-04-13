import type { SmsaLiveStatus } from '@/types/smsa';

const MAJOR_SMSA_STATUSES: {
  label: string;
  codes?: string[];
  keywords?: string[];
}[] = [
  {
    label: 'تم التسليم',
    codes: ['DL'],
    keywords: ['delivered', 'تم التسليم'],
  },
  {
    label: 'خارج للتسليم',
    codes: ['OD', 'WC', 'CC'],
    keywords: ['out for delivery', 'with courier'],
  },
  {
    label: 'قيد النقل',
    codes: ['IT', 'IN', 'AR', 'MA', 'TR', 'DP', 'DE'],
    keywords: ['in transit', 'transit', 'arrived', 'departed', 'معالجة'],
  },
  {
    label: 'بانتظار الاستلام',
    codes: ['PU', 'PP', 'PA'],
    keywords: ['pickup', 'awaiting'],
  },
  {
    label: 'مرتجع للمرسل',
    codes: ['RT', 'RC'],
    keywords: ['return'],
  },
  {
    label: 'ملغي',
    codes: ['CX', 'CCL'],
    keywords: ['cancel'],
  },
];

export const resolveMajorSmsaStatus = (tracking: SmsaLiveStatus | null | undefined): string | null => {
  if (!tracking) {
    return null;
  }
  const code = tracking.code?.trim().toUpperCase();
  const description = tracking.description?.trim().toLowerCase() || '';

  const match = MAJOR_SMSA_STATUSES.find((status) => {
    const codeMatch = code && status.codes?.some((candidate) => candidate === code);
    const keywordMatch =
      description &&
      status.keywords?.some((keyword) => description.includes(keyword.toLowerCase()));
    return Boolean(codeMatch || keywordMatch);
  });

  if (match) {
    return match.label;
  }

  if (tracking.delivered) {
    return 'تم التسليم';
  }

  return tracking.description || null;
};
