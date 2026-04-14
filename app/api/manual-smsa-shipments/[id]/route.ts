import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeManualSmsaShipment } from '@/app/lib/manual-smsa/serializer';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: shipmentId } = await params;
  if (!shipmentId) {
    return NextResponse.json({ error: 'معرف الشحنة مطلوب' }, { status: 400 });
  }

  try {
    const shipment = await prisma.manualSmsaShipment.findUnique({
      where: { id: shipmentId },
    });

    if (!shipment || shipment.deletedAt) {
      return NextResponse.json({ error: 'الشحنة غير موجودة' }, { status: 404 });
    }

    if (!shipment.cancelledAt) {
      return NextResponse.json(
        { error: 'يجب إلغاء الشحنة أولاً قبل حذفها' },
        { status: 400 },
      );
    }

    const updated = await prisma.manualSmsaShipment.update({
      where: { id: shipmentId },
      data: {
        deletedAt: new Date(),
        status: 'deleted',
      },
    });

    return NextResponse.json({
      success: true,
      shipment: serializeManualSmsaShipment(updated),
    });
  } catch (error) {
    log.error('Failed to delete manual SMSA shipment', { error, shipmentId });
    return NextResponse.json(
      { error: 'تعذر حذف الشحنة حالياً' },
      { status: 500 },
    );
  }
}
