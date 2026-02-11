import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  ensureShipmentWalletCredit,
  removeShipmentWalletCredit,
} from '@/app/lib/delivery-agent-wallet';

export const runtime = 'nodejs';

/**
 * PATCH /api/shipment-assignments/[id]
 * Update assignment status
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
    const { id: assignmentId } = await params;
    const body = await request.json();

    const {
      status,
      notes,
      deliveryProofUrl,
      recipientName,
      recipientSignature,
      failureReason,
      cancellationReason,
    } = body;

    // Get assignment
    const assignment = await prisma.shipmentAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shipment: {
          include: {
            codCollection: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'التعيين غير موجود' },
        { status: 404 }
      );
    }

    // Check permissions
    const isDeliveryAgent = user.roles?.includes('delivery_agent');
    const isWarehouseAdmin = user.roles?.includes('warehouse') || user.role === 'admin';

    // Delivery agents can only update their own assignments
    if (isDeliveryAgent && assignment.deliveryAgentId !== user.id) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتحديث هذا التعيين' },
        { status: 403 }
      );
    }

    // Only warehouse admins or the assigned delivery agent can update
    if (!isDeliveryAgent && !isWarehouseAdmin) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتحديث التعيينات' },
        { status: 403 }
      );
    }

    // Build update data
    const updateData: any = {};

    if (notes !== undefined) updateData.notes = notes;
    if (deliveryProofUrl !== undefined) updateData.deliveryProofUrl = deliveryProofUrl;
    if (recipientName !== undefined) updateData.recipientName = recipientName;
    if (recipientSignature !== undefined) updateData.recipientSignature = recipientSignature;
    if (failureReason !== undefined) updateData.failureReason = failureReason;
    if (cancellationReason !== undefined) updateData.cancellationReason = cancellationReason;

    // Handle status changes
    if (status) {
      updateData.status = status;

      switch (status) {
        case 'picked_up':
          updateData.pickedUpAt = new Date();
          break;
        case 'delivered':
          updateData.deliveredAt = new Date();
          // Auto-mark COD as collected if delivery agent delivered
          if (assignment.shipment.codCollection && isDeliveryAgent) {
            await prisma.cODCollection.update({
              where: { shipmentId: assignment.shipmentId },
              data: {
                status: 'collected',
                collectedAt: new Date(),
                collectedBy: user.username || user.name,
                collectedAmount: assignment.shipment.codCollection.collectionAmount,
              },
            });
          }
          break;
        case 'failed':
          updateData.failedAt = new Date();
          break;
        case 'cancelled':
          updateData.cancelledAt = new Date();
          break;
      }
    }

    // Update assignment
    const updatedAssignment = await prisma.shipmentAssignment.update({
      where: { id: assignmentId },
      data: updateData,
      include: {
        shipment: {
          include: {
            warehouse: true,
            codCollection: true,
          },
        },
        deliveryAgent: {
          select: {
            id: true,
            name: true,
            username: true,
            phone: true,
          },
        },
      },
    });

    // Update shipment status
    if (status) {
      await prisma.localShipment.update({
        where: { id: assignment.shipmentId },
        data: {
          status,
          deliveredAt: status === 'delivered' ? new Date() : undefined,
          cancelledAt: status === 'cancelled' ? new Date() : undefined,
          cancellationReason: status === 'cancelled' ? cancellationReason : undefined,
        },
      });
    }

    const previousStatus = assignment.status;
    if (previousStatus !== 'delivered' && updatedAssignment.status === 'delivered') {
      await ensureShipmentWalletCredit({
        shipmentId: assignment.shipmentId,
        deliveryAgentId: assignment.deliveryAgentId,
        assignmentId,
        orderNumber: updatedAssignment.shipment?.orderNumber,
        trackingNumber: updatedAssignment.shipment?.trackingNumber,
        createdById: user.id,
        createdByName: user.name || user.username,
      });
    } else if (
      previousStatus === 'delivered' &&
      status &&
      status !== 'delivered'
    ) {
      await removeShipmentWalletCredit(assignment.shipmentId);
    }

    log.info('Shipment assignment updated', {
      assignmentId,
      status,
      updatedBy: user.username,
    });

    return NextResponse.json({
      success: true,
      assignment: updatedAssignment,
    });
  } catch (error) {
    log.error('Error updating shipment assignment', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث التعيين' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/shipment-assignments/[id]
 * Unassign shipment from delivery agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;

    // Only warehouse admins can unassign shipments
    if (!user.roles?.includes('warehouse') && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لإلغاء تعيين الشحنات' },
        { status: 403 }
      );
    }

    const { id: assignmentId } = await params;

    // Get assignment
    const assignment = await prisma.shipmentAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shipment: {
          include: {
            codCollection: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'التعيين غير موجود' },
        { status: 404 }
      );
    }

    // Delete assignment
    await prisma.shipmentAssignment.delete({
      where: { id: assignmentId },
    });

    // Update shipment status back to pending
    await prisma.localShipment.update({
      where: { id: assignment.shipmentId },
      data: { status: 'pending' },
    });

    // Delete COD collection if exists and not yet collected
    if (assignment.shipment.codCollection && assignment.shipment.codCollection.status === 'pending') {
      await prisma.cODCollection.delete({
        where: { shipmentId: assignment.shipmentId },
      });
    }

    log.info('Shipment unassigned', {
      assignmentId,
      shipmentId: assignment.shipmentId,
      unassignedBy: user.username,
    });

    return NextResponse.json({
      success: true,
      message: 'تم إلغاء تعيين الشحنة بنجاح',
    });
  } catch (error) {
    log.error('Error unassigning shipment', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إلغاء تعيين الشحنة' },
      { status: 500 }
    );
  }
}
