import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function actorName(session: any) {
  return session?.user?.username || session?.user?.name || session?.user?.email || 'user';
}

async function authorizeReturnsManagement() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, 'returns-management') ? session : null;
}

export async function GET() {
  const session = await authorizeReturnsManagement();
  if (!session) {
    return NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });
  }

  const overrides = await prisma.returnWindowOverride.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ success: true, overrides });
}

export async function POST(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) {
    return NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });
  }

  const body = await request.json();
  const merchantId = typeof body?.merchantId === 'string' ? body.merchantId.trim() : '';
  const reference = normalizeOrderReference(body?.orderNumber);
  if (!merchantId || !reference) {
    return NextResponse.json({ error: 'معرف التاجر ورقم الطلب مطلوبان' }, { status: 400 });
  }

  const order = await getSallaOrderByReference(merchantId, reference);
  if (!order) {
    return NextResponse.json({ error: 'لم يتم العثور على الطلب في سلة' }, { status: 404 });
  }

  const orderId = String(order.id);
  const orderNumber = String(order.reference_id || reference);
  const override = await prisma.returnWindowOverride.upsert({
    where: { merchantId_orderId: { merchantId, orderId } },
    create: { merchantId, orderId, orderNumber, createdBy: actorName(session) },
    update: {
      orderNumber,
      createdBy: actorName(session),
      createdAt: new Date(),
      revokedBy: null,
      revokedAt: null,
    },
  });

  return NextResponse.json({ success: true, override });
}

export async function DELETE(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) {
    return NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });
  }

  const body = await request.json();
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'معرف الاستثناء مطلوب' }, { status: 400 });
  }

  const result = await prisma.returnWindowOverride.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actorName(session) },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: 'الاستثناء غير موجود أو تم إلغاؤه' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
