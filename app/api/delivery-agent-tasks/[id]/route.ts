import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  ensureTaskWalletCredit,
  removeTaskWalletCredit,
} from '@/app/lib/delivery-agent-wallet';

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

const STATUS_WHITELIST = ['pending', 'in_progress', 'completed', 'cancelled'];

/**
 * PATCH /api/delivery-agent-tasks/[id]
 * Update a delivery agent task
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const serviceKeys = Array.isArray(user.serviceKeys) ? user.serviceKeys : [];
    const hasManagementAccess = serviceKeys.includes('delivery-agent-tasks');
    const { id } = await params;
    const body = await request.json();

    const task = await prisma.deliveryAgentTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: 'المهمة غير موجودة' }, { status: 404 });
    }

    const isDeliveryAgent = user.roles?.includes('delivery_agent');
    const restrictsToOwnTasks = isDeliveryAgent && !hasManagementAccess;
    const isAssignedAgent = task.deliveryAgentId === user.id;
    const isWarehouseAdmin = user.roles?.includes('warehouse') || user.role === 'admin';
    const isCreator = Boolean(task.createdById && task.createdById === user.id);

    if (restrictsToOwnTasks && !isAssignedAgent) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتحديث هذه المهمة' },
        { status: 403 }
      );
    }

    if (!isAssignedAgent && !hasManagementAccess && !isWarehouseAdmin && !isCreator) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتحديث المهام' },
        { status: 403 }
      );
    }

    const updateData: any = {};

    if (body.status) {
      const status = body.status.toString();

      if (!STATUS_WHITELIST.includes(status)) {
        return NextResponse.json({ error: 'حالة غير صحيحة' }, { status: 400 });
      }

      if (isDeliveryAgent && !['pending', 'in_progress', 'completed'].includes(status)) {
        return NextResponse.json(
          { error: 'لا يمكن للمندوب إلغاء المهام' },
          { status: 403 }
        );
      }

      updateData.status = status;
      updateData.completedAt = status === 'completed' ? new Date() : null;
    }

    if (body.completionNotes !== undefined) {
      updateData.completionNotes = body.completionNotes?.toString().trim() || null;
    }

    const canEditDetails = !restrictsToOwnTasks || isWarehouseAdmin || isCreator;

    if (canEditDetails) {
      if (body.title !== undefined) {
        if (!body.title?.toString().trim()) {
          return NextResponse.json({ error: 'لا يمكن ترك العنوان فارغًا' }, { status: 400 });
        }
        updateData.title = body.title.toString().trim();
      }

      if (body.details !== undefined) {
        updateData.details = body.details?.toString().trim() || null;
      }

      if (body.requestedItem !== undefined) {
        updateData.requestedItem = body.requestedItem?.toString().trim() || null;
      }

      if (body.priority !== undefined) {
        updateData.priority = body.priority?.toString().trim().toLowerCase() || null;
      }

      if (body.requestType !== undefined) {
        updateData.requestType = body.requestType?.toString().trim().toLowerCase() || 'custom';
      }

      if (body.quantity !== undefined) {
        if (body.quantity === null || body.quantity === '') {
          updateData.quantity = null;
        } else {
          const qty = Number(body.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            return NextResponse.json({ error: 'الكمية يجب أن تكون رقمًا موجبًا' }, { status: 400 });
          }
          updateData.quantity = Math.round(qty);
        }
      }

      if (body.dueDate !== undefined) {
        if (!body.dueDate) {
          updateData.dueDate = null;
        } else {
          const parsed = new Date(body.dueDate);
          if (Number.isNaN(parsed.getTime())) {
            return NextResponse.json({ error: 'تاريخ الاستحقاق غير صالح' }, { status: 400 });
          }
          updateData.dueDate = parsed;
        }
      }

      if (body.relatedShipmentId !== undefined) {
        if (!body.relatedShipmentId) {
          updateData.relatedShipmentId = null;
        } else {
          const shipmentExists = await prisma.localShipment.findUnique({
            where: { id: body.relatedShipmentId as string },
            select: { id: true },
          });

          if (!shipmentExists) {
            return NextResponse.json(
              { error: 'لم يتم العثور على الشحنة المرتبطة' },
              { status: 404 }
            );
          }

          updateData.relatedShipmentId = body.relatedShipmentId;
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'لا توجد تحديثات لتطبيقها' }, { status: 400 });
    }

    const updatedTask = await prisma.deliveryAgentTask.update({
      where: { id },
      data: updateData,
      include: TASK_INCLUDE,
    });

    const previousStatus = task.status;
    if (previousStatus !== 'completed' && updatedTask.status === 'completed') {
      await ensureTaskWalletCredit({
        taskId: task.id,
        deliveryAgentId: task.deliveryAgentId,
        title: updatedTask.title,
        createdById: user.id,
        createdByName: user.name || user.username,
      });
    } else if (previousStatus === 'completed' && updatedTask.status !== 'completed') {
      await removeTaskWalletCredit(task.id);
    }

    log.info('Delivery agent task updated', {
      taskId: id,
      updatedBy: user.username,
      status: updatedTask.status,
    });

    return NextResponse.json({ success: true, task: updatedTask });
  } catch (error) {
    log.error('Error updating delivery agent task', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث المهمة' },
      { status: 500 }
    );
  }
}
