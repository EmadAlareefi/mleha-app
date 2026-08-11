import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingActor, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;

  try {
    const [groups, consentCounts] = await Promise.all([
      prisma.marketingCustomerGroup.findMany({
        where: { isArchived: false },
        include: { _count: { select: { members: true, campaigns: true } } },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      prisma.marketingCustomer.groupBy({
        by: ['groupId', 'consentStatus'],
        where: { isActive: true },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, Record<string, number>>();
    consentCounts.forEach((row) => {
      const current = counts.get(row.groupId) || {};
      current[row.consentStatus] = row._count._all;
      counts.set(row.groupId, current);
    });

    return NextResponse.json({
      success: true,
      groups: groups.map((group) => ({
        ...group,
        memberCount: group._count.members,
        campaignCount: group._count.campaigns,
        optedInCount: counts.get(group.id)?.opted_in || 0,
        optedOutCount: counts.get(group.id)?.opted_out || 0,
        unknownConsentCount: counts.get(group.id)?.unknown || 0,
        _count: undefined,
      })),
    });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر تحميل مجموعات العملاء');
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeMarketing();
  if (auth.response || !auth.session) return auth.response!;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (!name) return NextResponse.json({ error: 'اسم المجموعة مطلوب' }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: 'اسم المجموعة طويل جداً' }, { status: 400 });
    if (description.length > 1000) return NextResponse.json({ error: 'وصف المجموعة طويل جداً' }, { status: 400 });
    const actor = marketingActor(auth.session);
    const group = await prisma.marketingCustomerGroup.create({
      data: {
        name,
        description: description || null,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    return NextResponse.json({
      success: true,
      group: { ...group, memberCount: 0, campaignCount: 0, optedInCount: 0, optedOutCount: 0, unknownConsentCount: 0 },
    }, { status: 201 });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر إنشاء مجموعة العملاء');
  }
}
