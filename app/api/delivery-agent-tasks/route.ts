import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const TASK_INCLUDE = {
  deliveryAgent: {
    select: {
      id: true,
      name: true,
      username: true,
      phone: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
    },
  },
  relatedShipment: {
    select: {
      id: true,
      orderNumber: true,
      trackingNumber: true,
      status: true,
    },
  },
};

const REQUEST_TYPES = new Set(['purchase', 'pickup', 'support', 'other', 'custom']);

/**
 * GET /api/delivery-agent-tasks
 * List delivery agent tasks. Delivery agents only see their own tasks.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const serviceKeys = Array.isArray(user.serviceKeys) ? user.serviceKeys : [];
    const hasManagementAccess = serviceKeys.includes('delivery-agent-tasks');
    const params = request.nextUrl.searchParams;
    const deliveryAgentId = params.get('deliveryAgentId');
    const statusParam = params.get('status');
    const includeCompleted = params.get('includeCompleted') === 'true';
    const limitParam = params.get('limit');
    const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 100;

    const baseWhere: any = {};
    const isDeliveryAgent = user.roles?.includes('delivery_agent');

    if (isDeliveryAgent && !hasManagementAccess) {
      baseWhere.deliveryAgentId = user.id;
    } else if (deliveryAgentId) {
      baseWhere.deliveryAgentId = deliveryAgentId;
    }

    const tasksWhere: any = { ...baseWhere };

    if (statusParam) {
      const statuses = statusParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        tasksWhere.status = statuses[0];
      } else if (statuses.length > 1) {
        tasksWhere.status = { in: statuses };
      }
    } else if (!includeCompleted) {
      tasksWhere.status = { in: ['pending', 'in_progress', 'agent_completed'] };
    }

    const tasks = await prisma.deliveryAgentTask.findMany({
      where: tasksWhere,
      include: TASK_INCLUDE,
      orderBy: [
        { status: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    });

    const summaryCounts = await prisma.deliveryAgentTask.groupBy({
      where: baseWhere,
      by: ['status'],
      _count: { _all: true },
    });

    const summary = summaryCounts.reduce(
      (acc, record) => {
        const count = record._count._all;
        acc.total += count;
        if (record.status === 'pending') acc.pending += count;
        if (record.status === 'in_progress') acc.inProgress += count;
        if (record.status === 'agent_completed') acc.awaitingConfirmation += count;
        if (record.status === 'completed') acc.completed += count;
        if (record.status === 'cancelled') acc.cancelled += count;
        return acc;
      },
      { total: 0, pending: 0, inProgress: 0, awaitingConfirmation: 0, completed: 0, cancelled: 0 }
    );

    return NextResponse.json({ success: true, tasks, summary });
  } catch (error) {
    log.error('Error fetching delivery agent tasks', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب المهام' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/delivery-agent-tasks
 * Create a new task for a delivery agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;

    const body = await request.json();
    const {
      deliveryAgentId,
      title,
      requestType = 'purchase',
      requestedItem,
      quantity,
      details,
      priority,
      dueDate,
      relatedShipmentId,
    } = body;

    if (!deliveryAgentId || !title?.trim()) {
      return NextResponse.json(
        { error: 'المندوب واسم الطلب مطلوبان' },
        { status: 400 }
      );
    }

    const sanitizedTitle = title.trim();
    const sanitizedRequestType = (requestType || 'purchase').toString().trim().toLowerCase();
    const normalizedRequestType = REQUEST_TYPES.has(sanitizedRequestType)
      ? sanitizedRequestType
      : 'custom';

    let parsedQuantity: number | undefined;
    if (quantity !== undefined && quantity !== null && quantity !== '') {
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return NextResponse.json({ error: 'الكمية يجب أن تكون رقمًا موجبًا' }, { status: 400 });
      }
      parsedQuantity = Math.round(q);
    }

    let parsedDueDate: Date | undefined;
    if (dueDate) {
      const date = new Date(dueDate);
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: 'تاريخ الاستحقاق غير صالح' }, { status: 400 });
      }
      parsedDueDate = date;
    }

    if (relatedShipmentId) {
      const shipmentExists = await prisma.localShipment.findUnique({
        where: { id: relatedShipmentId },
        select: { id: true },
      });

      if (!shipmentExists) {
        return NextResponse.json(
          { error: 'لم يتم العثور على الشحنة المرتبطة' },
          { status: 404 }
        );
      }
    }

    const deliveryAgent = await prisma.orderUser.findUnique({
      where: { id: deliveryAgentId },
      select: {
        id: true,
        name: true,
        servicePermissions: {
          select: { serviceKey: true },
        },
      },
    });

    if (!deliveryAgent) {
      return NextResponse.json({ error: 'المندوب غير موجود' }, { status: 404 });
    }

    const hasDeliveryPermission = deliveryAgent.servicePermissions.some(
      (permission) => permission.serviceKey === 'my-deliveries'
    );

    if (!hasDeliveryPermission) {
      return NextResponse.json(
        { error: 'المستخدم المحدد ليس مندوب توصيل مفعل' },
        { status: 400 }
      );
    }

    const creatorRecord = await prisma.orderUser.findUnique({
      where: { id: user.id as string },
      select: { id: true },
    });

    const task = await prisma.deliveryAgentTask.create({
      data: {
        deliveryAgentId,
        createdById: creatorRecord?.id,
        createdByName: user.name || null,
        createdByUsername: user.username || null,
        title: sanitizedTitle,
        requestType: normalizedRequestType,
        requestedItem: requestedItem?.toString().trim() || null,
        quantity: parsedQuantity,
        details: details?.toString().trim() || null,
        priority: priority?.toString().trim().toLowerCase() || null,
        dueDate: parsedDueDate,
        relatedShipmentId: relatedShipmentId || null,
      },
      include: TASK_INCLUDE,
    });

    log.info('Delivery agent task created', {
      taskId: task.id,
      deliveryAgentId,
      createdBy: user.username,
    });

    return NextResponse.json({ success: true, task }, { status: 201 });
  } catch (error) {
    log.error('Error creating delivery agent task', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء المهمة' },
      { status: 500 }
    );
  }
}
