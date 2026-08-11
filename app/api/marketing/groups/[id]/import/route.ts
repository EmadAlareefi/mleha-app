import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingActor, marketingErrorResponse } from '@/app/api/marketing/_shared';
import {
  MARKETING_IMPORT_MAX_BYTES,
  parseConsentStatus,
  parseMarketingCustomerCsv,
} from '@/app/lib/marketing-customers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response || !auth.session) return auth.response!;
  const { id } = await context.params;
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'اختر ملف CSV للاستيراد' }, { status: 400 });
    if (file.size > MARKETING_IMPORT_MAX_BYTES) {
      return NextResponse.json({ error: 'حجم ملف CSV يجب ألا يتجاوز 2 ميجابايت' }, { status: 400 });
    }
    const group = await prisma.marketingCustomerGroup.findFirst({ where: { id, isArchived: false }, select: { id: true } });
    if (!group) return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 });
    const defaultConsent = parseConsentStatus(form.get('defaultConsent'));
    const parsed = parseMarketingCustomerCsv(await file.text(), defaultConsent);
    if (!parsed.customers.length) {
      return NextResponse.json({ error: 'لم يتم العثور على أرقام صالحة في الملف', rowErrors: parsed.errors.slice(0, 50) }, { status: 400 });
    }
    const hasOptedIn = parsed.customers.some((customer) => customer.consentStatus === 'opted_in');
    if (hasOptedIn && form.get('confirmMarketingConsent') !== 'true') {
      return NextResponse.json({ error: 'يجب تأكيد وجود موافقة تسويقية صريحة قبل استيراد العملاء كمشتركين' }, { status: 400 });
    }
    const actor = marketingActor(auth.session);
    const result = await prisma.marketingCustomer.createMany({
      data: parsed.customers.map((customer) => ({
        groupId: id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        source: 'csv',
        consentStatus: customer.consentStatus,
        consentRecordedAt: customer.consentStatus === 'unknown' ? null : new Date(),
        consentRecordedBy: customer.consentStatus === 'unknown' ? null : actor.name,
        metadata: { csvRow: customer.row, fileName: file.name.slice(0, 240) },
      })),
      skipDuplicates: true,
    });
    return NextResponse.json({
      success: true,
      imported: result.count,
      skippedDuplicates: parsed.customers.length - result.count + parsed.duplicatePhones,
      invalidRows: parsed.errors.length,
      rowErrors: parsed.errors.slice(0, 50),
    });
  } catch (error) {
    if (error instanceof Error && /CSV|الحد الأعلى|عمود/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return marketingErrorResponse(error, 'تعذر استيراد ملف العملاء');
  }
}
