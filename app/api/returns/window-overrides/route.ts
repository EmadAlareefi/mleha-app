import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function isAdmin(session: any) {
  const role = session?.user?.role;
  const roles = session?.user?.roles ?? (role ? [role] : []);
  return role === 'admin' || roles.includes('admin');
}

function actorName(session: any) {
  return session?.user?.username || session?.user?.name || session?.user?.email || 'admin';
}

async function authorizeAdmin() {
  const session = await getServerSession(authOptions);
  return isAdmin(session) ? session : null;
}

export async function GET() {
  const session = await authorizeAdmin();
  if (!session) {
    return NextResponse.json({ error: 'هذه الصلاحية متاحة للمسؤول فقط' }, { status: 403 });
  }

  const overrides = await prisma.returnWindowOverride.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ success: true, overrides });
}

export async function POST(request: NextRequest) {
  const session = await authorizeAdmin();
  if (!session) {
    return NextResponse.json({ error: 'هذه الصلاحية متاحة للمسؤول فقط' }, { status: 403 });
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
  const session = await authorizeAdmin();
  if (!session) {
    return NextResponse.json({ error: 'هذه الصلاحية متاحة للمسؤول فقط' }, { status: 403 });
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
