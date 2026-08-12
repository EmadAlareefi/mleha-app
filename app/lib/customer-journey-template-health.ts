import 'server-only';

import { env } from '@/app/lib/env';
import { getZokoTemplates, type ZokoTemplateType } from '@/app/lib/zoko';

export type CustomerJourneyTemplateHealth = {
  step: string;
  label: string;
  templateId: string;
  expectedType: ZokoTemplateType;
  expectedVariables: number;
  actualType: ZokoTemplateType | null;
  actualVariables: number | null;
  language: string | null;
  active: boolean;
  status: 'ok' | 'missing' | 'inactive' | 'mismatch';
  issue: string | null;
};

const EXPECTED_TEMPLATES = [
  {
    step: 'order_received',
    label: 'استلام الطلب والفاتورة',
    templateId: env.ZOKO_TPL_ORDER_RECEIVED_INVOICE,
    expectedType: 'richTemplate',
    expectedVariables: 3,
  },
  {
    step: 'shipped',
    label: 'الشحن ورابط التتبع',
    templateId: env.ZOKO_TPL_ORDER_SHIPPED_LABEL,
    expectedType: 'buttonTemplate',
    expectedVariables: 5,
  },
  {
    step: 'product_rating',
    label: 'التسليم وتقييم المنتجات',
    templateId: env.ZOKO_TPL_ORDER_DELIVERED_RATING,
    expectedType: 'buttonTemplate',
    expectedVariables: 3,
  },
  {
    step: 'cancelled',
    label: 'إلغاء الطلب',
    templateId: env.ZOKO_TPL_ORDER_CANCELLED,
    expectedType: 'template',
    expectedVariables: 2,
  },
  {
    step: 'refunded',
    label: 'إصدار الاسترداد',
    templateId: env.ZOKO_TPL_ORDER_REFUNDED,
    expectedType: 'template',
    expectedVariables: 4,
  },
] as const satisfies ReadonlyArray<{
  step: string;
  label: string;
  templateId: string;
  expectedType: ZokoTemplateType;
  expectedVariables: number;
}>;

export async function getCustomerJourneyTemplateHealth(): Promise<{
  templates: CustomerJourneyTemplateHealth[];
  error: string | null;
}> {
  try {
    const templates = await getZokoTemplates();
    const byId = new Map(templates.map((template) => [template.templateId, template]));
    return {
      templates: EXPECTED_TEMPLATES.map((expected) => {
        const actual = byId.get(expected.templateId);
        if (!actual) {
          return {
            ...expected,
            actualType: null,
            actualVariables: null,
            language: null,
            active: false,
            status: 'missing' as const,
            issue: 'القالب غير موجود في حساب Zoko',
          };
        }
        if (!actual.active) {
          return {
            ...expected,
            actualType: actual.templateType,
            actualVariables: actual.templateVariableCount,
            language: actual.templateLanguage,
            active: false,
            status: 'inactive' as const,
            issue: 'القالب موجود لكنه غير نشط',
          };
        }
        const mismatches: string[] = [];
        if (actual.templateLanguage !== 'ar') mismatches.push(`اللغة ${actual.templateLanguage}`);
        if (actual.templateType !== expected.expectedType) {
          mismatches.push(`النوع ${actual.templateType}`);
        }
        if (actual.templateVariableCount !== expected.expectedVariables) {
          mismatches.push(`المتغيرات ${actual.templateVariableCount}`);
        }
        return {
          ...expected,
          actualType: actual.templateType,
          actualVariables: actual.templateVariableCount,
          language: actual.templateLanguage,
          active: actual.active,
          status: mismatches.length > 0 ? ('mismatch' as const) : ('ok' as const),
          issue: mismatches.length > 0 ? `غير مطابق: ${mismatches.join('، ')}` : null,
        };
      }),
      error: null,
    };
  } catch (error) {
    return {
      templates: EXPECTED_TEMPLATES.map((expected) => ({
        ...expected,
        actualType: null,
        actualVariables: null,
        language: null,
        active: false,
        status: 'missing' as const,
        issue: 'تعذر الاتصال بـ Zoko للتحقق من القالب',
      })),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
