import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireAffiliateManagementSession } from '../authorization';
import { log } from '@/app/lib/logger';

export async function POST(request: NextRequest) {
  const authCheck = await requireAffiliateManagementSession();
  if (!authCheck.allowed || !authCheck.session) {
    return authCheck.response!;
  }

  const sessionUser = (authCheck.session as { user?: { id?: string | null } } | undefined)?.user;

  try {
    const body = await request.json();
    const {
      affiliateId,
      amount,
      currency = 'SAR',
      reference,
      memo,
      status = 'PAID',
      paidAt,
      periodStart,
      periodEnd,
    } = body;

    if (!affiliateId || amount === undefined || amount === null) {
      return NextResponse.json({ error: 'الرجاء تحديد المسوق والمبلغ' }, { status: 400 });
    }

    const payoutAmount = Number(amount);
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return NextResponse.json({ error: 'المبلغ المدخل غير صالح' }, { status: 400 });
    }

    const affiliateExists = await prisma.orderUser.findFirst({
      where: { id: affiliateId, affiliateName: { not: null } },
      select: { id: true },
    });
    if (!affiliateExists) {
      return NextResponse.json({ error: 'لم يتم العثور على المسوق المحدد' }, { status: 404 });
    }

    const allowedStatuses = new Set(['PENDING', 'APPROVED', 'PAID', 'CANCELLED']);
    const normalizedStatus = allowedStatuses.has(String(status).toUpperCase())
      ? (String(status).toUpperCase() as 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED')
      : 'PAID';

    const payout = await prisma.affiliatePayout.create({
      data: {
        affiliateId,
        amount: new Prisma.Decimal(payoutAmount),
        currency,
        status: normalizedStatus,
        reference: reference?.trim() || null,
        memo: memo?.trim() || null,
        paidAt:
          normalizedStatus === 'PAID'
            ? new Date(paidAt || Date.now())
            : paidAt
            ? new Date(paidAt)
            : null,
        periodStart: periodStart ? new Date(periodStart) : null,
        periodEnd: periodEnd ? new Date(periodEnd) : null,
        recordedById: sessionUser?.id ?? null,
      },
      include: {
        recordedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    return NextResponse.json({ success: true, payout });
  } catch (error) {
    log.error('Error recording affiliate payout', { error });
    return NextResponse.json({ error: 'تعذر تسجيل الدفعة' }, { status: 500 });
  }
}
