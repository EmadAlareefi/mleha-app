import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { buildLocalTrackingWhere, localTrackingSelect } from '@/app/lib/local-shipping/tracking-query';
import { LOCAL_SHIPMENT_STATUSES } from '@/app/lib/local-shipping/tracking';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasServiceAccess(session, ['local-shipping', 'returns-management', 'order-shipping'])) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  const params = request.nextUrl.searchParams;
  const search = params.get('search')?.trim() || '';
  const status = params.get('status') || '';
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  if (!Number.isSafeInteger(page) || (status && !Object.keys(LOCAL_SHIPMENT_STATUSES).includes(status))) {
    return NextResponse.json({ error: 'مرشحات غير صالحة' }, { status: 400 });
  }
  const where = buildLocalTrackingWhere({ id: params.get('id'), search, status });
  try {
    const [shipments, total] = await Promise.all([
      prisma.localShipment.findMany({ where, select: localTrackingSelect, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
      prisma.localShipment.count({ where }),
    ]);
    return NextResponse.json({ shipments, total, page, totalPages: Math.ceil(total / 30) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل تتبع الشحنات' }, { status: 500 });
  }
}
