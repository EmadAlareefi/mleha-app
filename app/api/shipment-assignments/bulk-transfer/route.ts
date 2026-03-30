import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const TRANSFERABLE_STATUSES = new Set(['assigned']);

/**
 * POST /api/shipment-assignments/bulk-transfer
 * Move multiple shipments from one delivery agent to another
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const isWarehouseAdmin = user.roles?.includes('warehouse') || user.role === 'admin';

    if (!isWarehouseAdmin) {
      return NextResponse.json({ error: 'ليس لديك صلاحية لنقل الشحنات' }, { status: 403 });
    }

    const body = await request.json();
    const { assignmentIds, targetAgentId } = body || {};

    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0 || !targetAgentId) {
      return NextResponse.json(
        { error: 'حدد الشحنات المراد نقلها واختر المندوب الجديد' },
        { status: 400 }
      );
    }

    const uniqueAssignmentIds = Array.from(
      new Set(
        assignmentIds
          .map((id: unknown) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id: string) => Boolean(id))
      )
    );

    if (uniqueAssignmentIds.length === 0) {
      return NextResponse.json(
        { error: 'لا يوجد شحنات صالحة للنقل' },
        { status: 400 }
      );
    }

    const assignments = await prisma.shipmentAssignment.findMany({
      where: { id: { in: uniqueAssignmentIds } },
      select: {
        id: true,
        deliveryAgentId: true,
        status: true,
      },
    });

    if (assignments.length !== uniqueAssignmentIds.length) {
      return NextResponse.json(
        { error: 'تعذر العثور على جميع الشحنات المحددة' },
        { status: 404 }
      );
    }

    const invalidAssignment = assignments.find(
      (assignment) => !TRANSFERABLE_STATUSES.has(assignment.status)
    );

    if (invalidAssignment) {
      return NextResponse.json(
        { error: 'يمكن نقل الشحنات ذات حالة "مُعيّنة" فقط' },
        { status: 400 }
      );
    }

    const sourceAgentId = assignments[0].deliveryAgentId;
    const hasMultipleAgents = assignments.some(
      (assignment) => assignment.deliveryAgentId !== sourceAgentId
    );

    if (hasMultipleAgents) {
      return NextResponse.json(
        { error: 'يرجى اختيار شحنات من نفس المندوب قبل النقل' },
        { status: 400 }
      );
    }

    if (sourceAgentId === targetAgentId) {
      return NextResponse.json(
        { error: 'المندوب الجديد مطابق للمندوب الحالي' },
        { status: 400 }
      );
    }

    const targetAgent = await prisma.orderUser.findUnique({
      where: { id: targetAgentId },
      select: {
        id: true,
        name: true,
        username: true,
        servicePermissions: {
          select: { serviceKey: true },
        },
      },
    });

    if (!targetAgent) {
      return NextResponse.json({ error: 'المندوب الجديد غير موجود' }, { status: 404 });
    }

    const hasDeliveryPermission = targetAgent.servicePermissions.some(
      (permission) => permission.serviceKey === 'my-deliveries'
    );

    if (!hasDeliveryPermission) {
      return NextResponse.json(
        { error: 'المستخدم المحدد ليس مندوب توصيل مفعل' },
        { status: 400 }
      );
    }

    const now = new Date();

    await prisma.shipmentAssignment.updateMany({
      where: { id: { in: uniqueAssignmentIds } },
      data: {
        deliveryAgentId: targetAgentId,
        assignedAt: now,
        assignedBy: user.username || user.name,
      },
    });

    log.info('Bulk shipment transfer completed', {
      assignmentCount: uniqueAssignmentIds.length,
      sourceAgentId,
      targetAgentId,
      transferredBy: user.username || user.name,
    });

    return NextResponse.json({
      success: true,
      transferredCount: uniqueAssignmentIds.length,
    });
  } catch (error) {
    log.error('Error transferring shipment assignments in bulk', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء نقل الشحنات' },
      { status: 500 }
    );
  }
}
