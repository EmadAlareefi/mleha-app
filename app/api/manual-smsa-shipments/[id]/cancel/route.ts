import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { cancelB2CShipment } from '@/app/lib/smsa-api';
import { serializeManualSmsaShipment } from '@/app/lib/manual-smsa/serializer';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

interface CancelPayload {
  reason?: string;
}

export async function POST(
  request: NextRequest,
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
      return NextResponse.json({ error: 'لم يتم العثور على الشحنة' }, { status: 404 });
    }

    let payload: CancelPayload | null = null;
    try {
      payload = await request.json();
    } catch {
      payload = null;
    }

    if (shipment.cancelledAt) {
      return NextResponse.json({
        success: true,
        message: 'تم إلغاء هذه الشحنة سابقاً',
        shipment: serializeManualSmsaShipment(shipment),
      });
    }

    const awb = shipment.smsaTrackingNumber || shipment.smsaAwbNumber;
    if (!awb) {
      return NextResponse.json(
        { error: 'لا يوجد رقم بوليصة لإلغائه. تأكد من إنشاء الشحنة بنجاح.' },
        { status: 400 },
      );
    }

    const cancellation = await cancelB2CShipment(awb);
    if (!cancellation.success) {
      return NextResponse.json(
        { error: cancellation.error || 'تعذر إلغاء الشحنة من شركة الشحن' },
        { status: 400 },
      );
    }

    const updated = await prisma.manualSmsaShipment.update({
      where: { id: shipmentId },
      data: {
        cancelledAt: new Date(),
        status: 'cancelled',
        cancellationReason:
          typeof payload?.reason === 'string' && payload.reason.trim()
            ? payload.reason.trim().slice(0, 280)
            : shipment.cancellationReason,
        cancellationResponse: cancellation as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      success: true,
      message: cancellation.message || 'تم إلغاء الشحنة بنجاح',
      shipment: serializeManualSmsaShipment(updated),
    });
  } catch (error) {
    log.error('Failed to cancel manual SMSA shipment', { error, shipmentId });
    return NextResponse.json(
      { error: 'تعذر إلغاء الشحنة في الوقت الحالي' },
      { status: 500 },
    );
  }
}
