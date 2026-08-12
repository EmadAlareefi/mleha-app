import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingActor, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { MARKETING_CAMPAIGN_MAX_RECIPIENTS } from '@/app/lib/marketing-customers';
import { getZokoTemplates } from '@/app/lib/zoko';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  const groupId = new URL(request.url).searchParams.get('groupId') || undefined;
  try {
    const campaigns = await prisma.marketingCampaign.findMany({
      where: groupId ? { groupId } : undefined,
      include: { group: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
    return NextResponse.json({ success: true, campaigns });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر تحميل سجل الحملات');
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeMarketing();
  if (auth.response || !auth.session) return auth.response!;
  try {
    const body = await request.json().catch(() => null);
    const groupId = typeof body?.groupId === 'string' ? body.groupId : '';
    const templateId = typeof body?.templateId === 'string' ? body.templateId.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const templateArgs = Array.isArray(body?.templateArgs)
      ? body.templateArgs.map((value: unknown) => String(value ?? '').trim())
      : [];
    if (!groupId || !templateId || !name) {
      return NextResponse.json({ error: 'اسم الحملة والمجموعة والقالب مطلوبة' }, { status: 400 });
    }
    if (name.length > 120) return NextResponse.json({ error: 'اسم الحملة طويل جداً' }, { status: 400 });
    if (templateArgs.some((value: string) => !value || value.length > 1000)) {
      return NextResponse.json({ error: 'جميع متغيرات القالب مطلوبة وبحد أقصى 1000 حرف' }, { status: 400 });
    }

    const [group, templates] = await Promise.all([
      prisma.marketingCustomerGroup.findFirst({ where: { id: groupId, isArchived: false } }),
      getZokoTemplates(),
    ]);
    if (!group) return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 });
    const template = templates.find((row) => row.templateId === templateId && row.active && row.channel === 'whatsapp');
    if (!template) return NextResponse.json({ error: 'قالب زوكو غير موجود أو غير نشط' }, { status: 400 });
    if (templateArgs.length !== template.templateVariableCount) {
      return NextResponse.json({ error: `القالب يحتاج ${template.templateVariableCount} متغير` }, { status: 400 });
    }
    const members = await prisma.marketingCustomer.findMany({
      where: { groupId, isActive: true, consentStatus: 'opted_in' },
      select: { id: true, name: true, phone: true },
      orderBy: [{ createdAt: 'asc' }],
      take: MARKETING_CAMPAIGN_MAX_RECIPIENTS + 1,
    });
    if (!members.length) {
      return NextResponse.json({ error: 'لا يوجد عملاء لديهم موافقة تسويقية صريحة في المجموعة' }, { status: 400 });
    }
    if (members.length > MARKETING_CAMPAIGN_MAX_RECIPIENTS) {
      return NextResponse.json({ error: `الحد الأعلى للحملة ${MARKETING_CAMPAIGN_MAX_RECIPIENTS} مستلم` }, { status: 400 });
    }
    const actor = marketingActor(auth.session);
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.marketingCampaign.create({
        data: {
          groupId,
          name,
          templateId: template.templateId,
          templateLanguage: template.templateLanguage,
          templateType: template.templateType,
          templateDescription: template.templateDesc || null,
          templateVariableCount: template.templateVariableCount,
          templateArgs,
          totalRecipients: members.length,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
      await tx.marketingCampaignMessage.createMany({
        data: members.map((member) => ({
          campaignId: created.id,
          customerId: member.id,
          recipient: member.phone,
          customerName: member.name,
        })),
      });
      return created;
    });
    return NextResponse.json({ success: true, campaign }, { status: 201 });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر إنشاء الحملة التسويقية');
  }
}
