import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingActor, marketingErrorResponse, positiveInteger } from '@/app/api/marketing/_shared';
import { normalizeE164Phone } from '@/app/lib/phone';
import { parseConsentStatus } from '@/app/lib/marketing-customers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const page = positiveInteger(searchParams.get('page'), 1, 100_000);
  const perPage = positiveInteger(searchParams.get('perPage'), 50, 100);
  const query = searchParams.get('q')?.trim().slice(0, 120);
  const consent = searchParams.get('consent');
  const where: Prisma.MarketingCustomerWhereInput = {
    groupId: id,
    isActive: true,
    ...(consent && ['unknown', 'opted_in', 'opted_out'].includes(consent) ? { consentStatus: consent } : {}),
    ...(query ? { OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query } },
      { email: { contains: query, mode: 'insensitive' } },
    ] } : {}),
  };
  try {
    const [members, total] = await Promise.all([
      prisma.marketingCustomer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.marketingCustomer.count({ where }),
    ]);
    return NextResponse.json({
      success: true,
      members,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر تحميل عملاء المجموعة');
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response || !auth.session) return auth.response!;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    const phone = normalizeE164Phone(body?.phone);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 160) : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : '';
    const consentStatus = parseConsentStatus(body?.consentStatus);
    if (!phone) return NextResponse.json({ error: 'رقم الجوال غير صالح أو لا يحتوي على رمز دولة' }, { status: 400 });
    if (consentStatus === 'opted_in' && body?.confirmMarketingConsent !== true) {
      return NextResponse.json({ error: 'يجب تأكيد وجود موافقة تسويقية صريحة من العميل' }, { status: 400 });
    }
    const group = await prisma.marketingCustomerGroup.findFirst({ where: { id, isArchived: false }, select: { id: true } });
    if (!group) return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 });
    const actor = marketingActor(auth.session);
    const customer = await prisma.marketingCustomer.upsert({
      where: { groupId_phone: { groupId: id, phone } },
      create: {
        groupId: id,
        phone,
        name: name || null,
        email: email || null,
        source: 'manual',
        consentStatus,
        consentRecordedAt: consentStatus === 'unknown' ? null : new Date(),
        consentRecordedBy: consentStatus === 'unknown' ? null : actor.name,
      },
      update: {
        isActive: true,
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        consentStatus,
        consentRecordedAt: consentStatus === 'unknown' ? null : new Date(),
        consentRecordedBy: consentStatus === 'unknown' ? null : actor.name,
      },
    });
    return NextResponse.json({ success: true, customer }, { status: 201 });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر إضافة العميل إلى المجموعة');
  }
}
