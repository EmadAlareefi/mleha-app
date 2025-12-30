import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrderByReference } from '@/app/lib/salla-api';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const ACTIVE_ASSIGNMENT_STATUSES = ['assigned', 'preparing', 'shipped'];

const hasPriorityAccess = (sessionUser: any): boolean => {
  if (!sessionUser) return false;
  const roles: string[] = sessionUser.roles || (sessionUser.role ? [sessionUser.role] : []);
  return roles.includes('admin') || roles.includes('store_manager');
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || !hasPriorityAccess(session.user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const searchQuery = searchParams.get('search')?.trim();

    const where: any = {
      merchantId: MERCHANT_ID,
    };

    if (searchQuery) {
      where.OR = [
        { orderNumber: { contains: searchQuery, mode: 'insensitive' } },
        { customerName: { contains: searchQuery, mode: 'insensitive' } },
        { createdByName: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    const highPriorityOrders = await prisma.highPriorityOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (highPriorityOrders.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const orderIds = highPriorityOrders.map((order) => order.orderId);
    const activeAssignments = await prisma.orderAssignment.findMany({
      where: {
        orderId: { in: orderIds },
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      },
      select: {
        orderId: true,
        status: true,
        assignedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    const assignmentMap = new Map(
      activeAssignments.map((assignment) => [
        assignment.orderId,
        {
          status: assignment.status,
          assignedAt: assignment.assignedAt,
          userName: assignment.user?.name || assignment.user?.username || 'غير معروف',
        },
      ]),
    );

    const data = highPriorityOrders.map((order) => ({
      ...order,
      assignment: assignmentMap.get(order.orderId) || null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    log.error('Failed to load high priority orders', { error });
    return NextResponse.json({ error: 'فشل جلب الطلبات ذات الأولوية' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || !hasPriorityAccess(session.user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const body = await request.json();
    const orderReference = (body.orderNumber || body.orderReference || '').toString().trim();
    const reason = (body.reason || '').toString().trim();
    const notes = (body.notes || '').toString().trim();

    if (!orderReference) {
      return NextResponse.json(
        { error: 'يرجى إدخال رقم الطلب' },
        { status: 400 },
      );
    }

    const order = await getSallaOrderByReference(MERCHANT_ID, orderReference);

    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب في سلة' },
        { status: 404 },
      );
    }

    const orderId = order.id?.toString();
    if (!orderId) {
      return NextResponse.json(
        { error: 'رقم الطلب من سلة غير صالح' },
        { status: 422 },
      );
    }

    const customerName = [
      order.customer?.first_name?.trim(),
      order.customer?.last_name?.trim(),
    ]
      .filter(Boolean)
      .join(' ')
      || order.customer?.name
      || '';

    const record = await prisma.highPriorityOrder.upsert({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId,
        },
      },
      update: {
        orderNumber: order.reference_id?.toString() || order.order_number?.toString() || orderId,
        customerName,
        reason: reason || null,
        notes: notes || null,
      },
      create: {
        merchantId: MERCHANT_ID,
        orderId,
        orderNumber: order.reference_id?.toString() || order.order_number?.toString() || orderId,
        customerName,
        reason: reason || null,
        notes: notes || null,
        createdById: (session.user as any)?.id || null,
        createdByName: session.user.name || null,
        createdByUsername: (session.user as any)?.username || null,
      },
    });

    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    log.error('Failed to mark high priority order', { error });
    return NextResponse.json({ error: 'فشل تحديد الطلب كعالي الأولوية' }, { status: 500 });
  }
}
