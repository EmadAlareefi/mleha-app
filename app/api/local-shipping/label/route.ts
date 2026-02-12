import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import { generateLocalShipmentLabelPdf, getMerchantLabelInfo } from '@/app/lib/local-shipping/label';

export const runtime = 'nodejs';

const buildShipmentFilters = (params: {
  shipmentId?: string | null;
  trackingNumber?: string | null;
  orderNumber?: string | null;
}) => {
  const orConditions: Record<string, unknown>[] = [];
  if (params.shipmentId) {
    orConditions.push({ id: params.shipmentId });
  }
  if (params.trackingNumber) {
    orConditions.push({ trackingNumber: params.trackingNumber });
  }
  if (params.orderNumber) {
    orConditions.push({ orderNumber: params.orderNumber });
  }
  return orConditions;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    if (!hasServiceAccess(session, ['order-shipping', 'local-shipping', 'warehouse', 'shipment-assignments'])) {
      return NextResponse.json({ error: 'لا تملك صلاحية الوصول لهذه البوليصة' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const shipmentId = searchParams.get('shipmentId');
    const trackingNumber = searchParams.get('trackingNumber');
    const orderNumber = searchParams.get('orderNumber');

    if (!shipmentId && !trackingNumber && !orderNumber) {
      return NextResponse.json(
        { error: 'يلزم توفير معرف الشحنة أو رقم التتبع أو رقم الطلب' },
        { status: 400 },
      );
    }

    const filters = buildShipmentFilters({ shipmentId, trackingNumber, orderNumber });
    const shipment = await prisma.localShipment.findFirst({
      where: {
        OR: filters,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'لم يتم العثور على الشحنة المحلية المطلوبة' }, { status: 404 });
    }

    const pdfBuffer = await generateLocalShipmentLabelPdf(shipment, getMerchantLabelInfo());
    log.info('Generated local shipment label PDF', {
      shipmentId: shipment.id,
      orderNumber: shipment.orderNumber,
    });

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="local-shipment-${shipment.trackingNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    log.error('Failed to generate local shipment label', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء ملف البوليصة' },
      { status: 500 },
    );
  }
}
