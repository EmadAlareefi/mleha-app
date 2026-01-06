import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { log } from '@/app/lib/logger';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const roles: string[] = user.roles || [user.role];

    if (!roles.includes('orders')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const body = await request.json();
    const orderNumberInput = (body?.orderNumber || '').toString().trim();

    if (!orderNumberInput) {
      return NextResponse.json({ error: 'رقم الطلب مطلوب' }, { status: 400 });
    }

    const now = new Date();

    const existingAssignment = await prisma.orderAssignment.findFirst({
      where: {
        OR: [
          { orderNumber: orderNumberInput },
          { orderId: orderNumberInput },
        ],
      },
    });

    if (existingAssignment) {
      const updated = await prisma.orderAssignment.update({
        where: { id: existingAssignment.id },
        data: {
          userId: user.id,
          status: 'assigned',
          assignedAt: now,
          startedAt: null,
          completedAt: null,
          removedAt: null,
        },
      });

      log.info('Order assignment reopened for user', {
        orderId: updated.orderId,
        orderNumber: updated.orderNumber,
        userId: user.id,
      });

      return NextResponse.json({
        success: true,
        assignmentId: updated.id,
        status: 'assignment_reused',
      });
    }

    const historyEntry = await prisma.orderHistory.findFirst({
      where: {
        OR: [
          { orderNumber: orderNumberInput },
          { orderId: orderNumberInput },
        ],
      },
      orderBy: {
        finishedAt: 'desc',
      },
    });

    if (!historyEntry) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على سجل لهذا الطلب' },
        { status: 404 }
      );
    }

    const newAssignment = await prisma.orderAssignment.create({
      data: {
        userId: user.id,
        merchantId: historyEntry.merchantId,
        orderId: historyEntry.orderId,
        orderNumber: historyEntry.orderNumber,
        orderData: historyEntry.orderData ?? Prisma.JsonNull,
        status: 'assigned',
        assignedAt: now,
        sallaStatus: historyEntry.finalSallaStatus,
      },
    });

    log.info('Order assignment created from history', {
      orderId: newAssignment.orderId,
      orderNumber: newAssignment.orderNumber,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      assignmentId: newAssignment.id,
      status: 'assignment_created',
    });
  } catch (error) {
    log.error('Failed to reopen order from history', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إعادة فتح الطلب' },
      { status: 500 }
    );
  }
}
