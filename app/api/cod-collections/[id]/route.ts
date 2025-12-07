import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * PATCH /api/cod-collections/[id]
 * Update COD collection status
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
    const { id: collectionId } = await params;
    const body = await request.json();

    const {
      status,
      collectedAmount,
      receiptUrl,
      depositMethod,
      depositReference,
      depositNotes,
      reconciliationNotes,
      discrepancyAmount,
      discrepancyReason,
      notes,
    } = body;

    // Get collection
    const collection = await prisma.cODCollection.findUnique({
      where: { id: collectionId },
      include: {
        shipment: {
          include: {
            assignment: true,
          },
        },
      },
    });

    if (!collection) {
      return NextResponse.json(
        { error: 'سجل التحصيل غير موجود' },
        { status: 404 }
      );
    }

    // Check permissions based on status transition
    const isDeliveryAgent = user.roles?.includes('delivery_agent');
    const isWarehouseAdmin = user.roles?.includes('warehouse') || user.role === 'admin';
    const isAccountant = user.roles?.includes('accountant') || user.role === 'admin';

    // Build update data
    const updateData: any = {};

    if (notes !== undefined) updateData.notes = notes;
    if (receiptUrl !== undefined) updateData.receiptUrl = receiptUrl;

    // Handle status changes
    if (status) {
      switch (status) {
        case 'collected':
          // Delivery agents can mark as collected
          if (!isDeliveryAgent) {
            return NextResponse.json(
              { error: 'فقط مندوب التوصيل يمكنه تحديث حالة التحصيل' },
              { status: 403 }
            );
          }
          updateData.status = 'collected';
          updateData.collectedAt = new Date();
          updateData.collectedBy = user.username || user.name;
          updateData.collectedAmount = collectedAmount || collection.collectionAmount;
          break;

        case 'deposited':
          // Warehouse admins can mark as deposited
          if (!isWarehouseAdmin) {
            return NextResponse.json(
              { error: 'فقط موظف المستودع يمكنه تسجيل الإيداع' },
              { status: 403 }
            );
          }
          updateData.status = 'deposited';
          updateData.depositedAt = new Date();
          updateData.depositedBy = user.username || user.name;
          if (depositMethod !== undefined) updateData.depositMethod = depositMethod;
          if (depositReference !== undefined) updateData.depositReference = depositReference;
          if (depositNotes !== undefined) updateData.depositNotes = depositNotes;
          break;

        case 'reconciled':
          // Accountants can mark as reconciled
          if (!isAccountant) {
            return NextResponse.json(
              { error: 'فقط المحاسب يمكنه تسوية المبالغ' },
              { status: 403 }
            );
          }
          updateData.status = 'reconciled';
          updateData.reconciledAt = new Date();
          updateData.reconciledBy = user.username || user.name;
          if (reconciliationNotes !== undefined) updateData.reconciliationNotes = reconciliationNotes;
          if (discrepancyAmount !== undefined) updateData.discrepancyAmount = discrepancyAmount;
          if (discrepancyReason !== undefined) updateData.discrepancyReason = discrepancyReason;
          break;

        case 'failed':
          // Delivery agents or warehouse admins can mark as failed
          if (!isDeliveryAgent && !isWarehouseAdmin) {
            return NextResponse.json(
              { error: 'ليس لديك صلاحية لتحديث هذا السجل' },
              { status: 403 }
            );
          }
          updateData.status = 'failed';
          break;

        default:
          return NextResponse.json(
            { error: 'حالة غير صالحة' },
            { status: 400 }
          );
      }
    }

    // Update collection
    const updatedCollection = await prisma.cODCollection.update({
      where: { id: collectionId },
      data: updateData,
      include: {
        shipment: {
          include: {
            assignment: {
              include: {
                deliveryAgent: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    log.info('COD collection updated', {
      collectionId,
      status,
      updatedBy: user.username,
    });

    return NextResponse.json({
      success: true,
      collection: updatedCollection,
    });
  } catch (error) {
    log.error('Error updating COD collection', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث سجل التحصيل' },
      { status: 500 }
    );
  }
}
