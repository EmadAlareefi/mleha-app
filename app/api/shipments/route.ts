import { after, NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  AMBIGUOUS_NUMERIC_COMPANY_IDS,
  SHIPMENT_COMPANIES,
  detectShipmentCompany,
  isAmbiguousShipmentCompanyTrackingNumber,
  isValidTrackingNumber,
} from '@/lib/shipment-detector';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { resolveWarehouseIds, hasWarehouseFeatureAccess } from '@/app/api/shipments/utils';
import { markSallaOrderDelivering } from '@/app/lib/local-shipping/salla-status';
import { log } from '@/app/lib/logger';

interface AutoMarkAssignmentResult {
  updated: boolean;
  localShipment?: {
    merchantId: string;
    orderId: string;
    orderNumber: string;
    trackingNumber: string;
  };
}

const DEFAULT_SHIPMENTS_LIMIT = 300;
const MAX_SHIPMENTS_LIMIT = 1000;

function getPagination(searchParams: URLSearchParams) {
  const pageParam = Number.parseInt(searchParams.get('page') || '', 10);
  const limitParam = Number.parseInt(searchParams.get('limit') || '', 10);

  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const requestedLimit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_SHIPMENTS_LIMIT;
  const limit = Math.min(requestedLimit, MAX_SHIPMENTS_LIMIT);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

async function autoMarkAssignmentPickedUp(trackingNumber: string): Promise<AutoMarkAssignmentResult> {
  if (!trackingNumber) {
    return { updated: false };
  }

  const localShipment = await prisma.localShipment.findUnique({
    where: { trackingNumber },
    include: {
      assignment: true,
    },
  });

  if (!localShipment?.assignment) {
    return { updated: false };
  }

  if (localShipment.assignment.status !== 'assigned') {
    return { updated: false };
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const assignmentUpdate = await tx.shipmentAssignment.updateMany({
      where: {
        id: localShipment.assignment!.id,
        status: 'assigned',
      },
      data: {
        status: 'picked_up',
        pickedUpAt: now,
      },
    });

    if (assignmentUpdate.count === 0) {
      return false;
    }

    await tx.localShipment.updateMany({
      where: {
        id: localShipment.id,
        status: 'assigned',
      },
      data: {
        status: 'picked_up',
      },
    });

    return true;
  });

  if (!updated) {
    return { updated: false };
  }

  return {
    updated: true,
    localShipment: {
      merchantId: localShipment.merchantId,
      orderId: localShipment.orderId,
      orderNumber: localShipment.orderNumber,
      trackingNumber: localShipment.trackingNumber,
    },
  };
}

async function runPostCreateShipmentSideEffects({
  type,
  trackingNumber,
  warehouseId,
}: {
  type: 'incoming' | 'outgoing';
  trackingNumber: string;
  warehouseId: string;
}) {
  if (type === 'incoming') {
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { smsaTrackingNumber: trackingNumber },
    });

    if (!returnRequest) {
      return;
    }

    await prisma.returnRequest.update({
      where: { id: returnRequest.id },
      data: {
        status: 'delivered',
        updatedAt: new Date(),
      },
    });

    log.info('Updated return request status from warehouse scan', {
      returnRequestId: returnRequest.id,
      trackingNumber,
      warehouseId,
      status: 'delivered',
    });

    try {
      const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
      const accessToken = await getSallaAccessToken(returnRequest.merchantId);

      if (!accessToken) {
        return;
      }

      const baseUrl = 'https://api.salla.dev/admin/v2';
      const url = `${baseUrl}/orders/${returnRequest.orderId}/status`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug: 'restoring' }),
      });

      if (response.ok) {
        log.info('Salla order status updated to restoring from warehouse scan', {
          orderId: returnRequest.orderId,
          returnRequestId: returnRequest.id,
          trackingNumber,
        });
      } else {
        const errorText = await response.text();
        log.warn('Failed to update Salla order status to restoring from warehouse scan', {
          orderId: returnRequest.orderId,
          returnRequestId: returnRequest.id,
          trackingNumber,
          error: errorText,
        });
      }
    } catch (error) {
      log.error('Error updating Salla order status to restoring from warehouse scan', {
        trackingNumber,
        error,
      });
    }
    return;
  }

  try {
    const autoMarkResult = await autoMarkAssignmentPickedUp(trackingNumber);
    if (!autoMarkResult.updated) {
      return;
    }

    log.info('Auto-marked assignment as picked up from warehouse scan', {
      trackingNumber,
      warehouseId,
    });

    if (autoMarkResult.localShipment) {
      await markSallaOrderDelivering({
        merchantId: autoMarkResult.localShipment.merchantId,
        orderId: autoMarkResult.localShipment.orderId,
        orderNumber: autoMarkResult.localShipment.orderNumber,
        trackingNumber: autoMarkResult.localShipment.trackingNumber,
        action: 'warehouse-scan',
      });
    }
  } catch (error) {
    log.error('Failed to auto mark assignment as picked up from warehouse scan', {
      trackingNumber,
      warehouseId,
      error,
    });
  }
}

// GET /api/shipments - Get all shipments with optional filtering
export async function GET(request: NextRequest) {
  const requestStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى الشحنات' },
        { status: 401 }
      );
    }

    if (!hasWarehouseFeatureAccess(session)) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض الشحنات' },
        { status: 403 }
      );
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const hasWarehouseRole = roles.includes('warehouse');

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'incoming' or 'outgoing'
    const company = searchParams.get('company');
    const date = searchParams.get('date'); // ISO date string
    const { page, limit, skip } = getPagination(searchParams);
    const requestedWarehouseId = searchParams.get('warehouseId') || undefined;

    const where: any = {};

    if (type) {
      where.type = type;
    }

    if (company) {
      where.company = company;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      where.scannedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (requestedWarehouseId) {
      where.warehouseId = requestedWarehouseId;
    } else if (hasWarehouseRole) {
      where.warehouseId = {
        not: null,
      };
    }

    const shipmentsQuery: Parameters<typeof prisma.shipment.findMany>[0] = {
      where,
      orderBy: {
        scannedAt: 'desc',
      },
      select: {
        id: true,
        trackingNumber: true,
        company: true,
        type: true,
        scannedAt: true,
        scannedBy: true,
        handoverScannedAt: true,
        handoverScannedBy: true,
        notes: true,
        smsaLiveStatus: true,
        smsaLiveStatusUpdatedAt: true,
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      skip,
      take: limit + 1,
    };

    const queryStartedAt = Date.now();
    const shipmentsPage = await prisma.shipment.findMany(shipmentsQuery);
    const queryDurationMs = Date.now() - queryStartedAt;
    const hasMore = shipmentsPage.length > limit;
    const shipments = hasMore ? shipmentsPage.slice(0, limit) : shipmentsPage;

    log.info('Warehouse shipments list query completed', {
      durationMs: Date.now() - requestStartedAt,
      queryDurationMs,
      page,
      limit,
      count: shipments.length,
      hasMore,
      filteredByDate: Boolean(date),
      filteredByWarehouse: Boolean(where.warehouseId),
      filteredByCompany: Boolean(company),
      filteredByType: Boolean(type),
    });

    return NextResponse.json(shipments, {
      headers: {
        'X-Pagination-Page': String(page),
        'X-Pagination-Limit': String(limit),
        'X-Pagination-Count': String(shipments.length),
        'X-Pagination-Has-More': String(hasMore),
        'X-Pagination-Next-Page': hasMore ? String(page + 1) : '',
      },
    });
  } catch (error) {
    log.error('Error fetching shipments', { error });
    return NextResponse.json(
      { error: 'فشل في جلب الشحنات' },
      { status: 500 }
    );
  }
}

// POST /api/shipments - Create a new shipment
export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لتسجيل الشحنات' },
        { status: 401 }
      );
    }

    if (!hasWarehouseFeatureAccess(session)) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لتسجيل الشحنات' },
        { status: 403 }
      );
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const isWarehouseUser = roles.includes('warehouse');

    const body = await request.json();
    const { trackingNumber, type, scannedBy, notes, warehouseId, company: requestedCompany } = body;
    const normalizedTrackingNumber =
      typeof trackingNumber === 'string' ? trackingNumber.trim() : '';

    // Validate tracking number
    if (!normalizedTrackingNumber || !isValidTrackingNumber(normalizedTrackingNumber)) {
      return NextResponse.json(
        { error: 'رقم التتبع غير صالح' },
        { status: 400 }
      );
    }

    // Validate type
    if (!type || (type !== 'incoming' && type !== 'outgoing')) {
      return NextResponse.json(
        { error: 'نوع الشحنة يجب أن يكون وارد أو صادر' },
        { status: 400 }
      );
    }
    const shipmentType = type as 'incoming' | 'outgoing';

    if (!warehouseId || typeof warehouseId !== 'string') {
      return NextResponse.json(
        { error: 'يجب تحديد المستودع المرتبط بالشحنة' },
        { status: 400 }
      );
    }

    const allowedWarehouseIds =
      isWarehouseUser ? await resolveWarehouseIds(session) : null;

    if (isWarehouseUser) {
      if (!allowedWarehouseIds || !allowedWarehouseIds.includes(warehouseId)) {
        return NextResponse.json(
          { error: 'لا تملك صلاحية لتسجيل شحنات لهذا المستودع' },
          { status: 403 }
        );
      }
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true, name: true },
    });

    if (!warehouse) {
      return NextResponse.json(
        { error: 'المستودع المحدد غير موجود أو غير نشط' },
        { status: 400 }
      );
    }

    // Check if tracking number already exists
    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber: normalizedTrackingNumber },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: 'رقم التتبع موجود مسبقاً',
          existing: existing
        },
        { status: 409 }
      );
    }

    const normalizedRequestedCompany =
      typeof requestedCompany === 'string' ? requestedCompany.trim().toLowerCase() : '';
    const isAmbiguousCompany = isAmbiguousShipmentCompanyTrackingNumber(normalizedTrackingNumber);
    const allowedManualCompanies = new Set<string>(AMBIGUOUS_NUMERIC_COMPANY_IDS);

    if (normalizedRequestedCompany) {
      if (!SHIPMENT_COMPANIES[normalizedRequestedCompany] || normalizedRequestedCompany === 'unknown') {
        return NextResponse.json(
          { error: 'شركة الشحن المحددة غير صالحة' },
          { status: 400 }
        );
      }

      if (isAmbiguousCompany && !allowedManualCompanies.has(normalizedRequestedCompany)) {
        return NextResponse.json(
          { error: 'اختر RedBox أو FedEx أو SMSA للأرقام الرقمية المكونة من 12 خانة' },
          { status: 400 }
        );
      }
    }

    if (isAmbiguousCompany && !normalizedRequestedCompany) {
      return NextResponse.json(
        { error: 'يرجى اختيار شركة الشحن لهذا الرقم: RedBox أو FedEx أو SMSA' },
        { status: 400 }
      );
    }

    const detectedCompany = detectShipmentCompany(normalizedTrackingNumber);

    if (
      normalizedRequestedCompany &&
      !isAmbiguousCompany &&
      normalizedRequestedCompany !== detectedCompany.id
    ) {
      return NextResponse.json(
        { error: 'لا يمكن تغيير شركة الشحن لرقم تتبع غير ملتبس' },
        { status: 400 }
      );
    }

    const company = isAmbiguousCompany
      ? SHIPMENT_COMPANIES[normalizedRequestedCompany]!
      : detectedCompany;

    // Create shipment
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: normalizedTrackingNumber,
        company: company.id,
        type: shipmentType,
        warehouseId,
        scannedBy:
          scannedBy ||
          (session.user as any)?.username ||
          (session.user as any)?.name ||
          (session.user as any)?.id ||
          null,
        notes,
      },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    after(async () => {
      try {
        await runPostCreateShipmentSideEffects({
          type: shipmentType,
          trackingNumber: normalizedTrackingNumber,
          warehouseId,
        });
      } catch (error) {
        log.error('Failed to run post-create shipment side effects', {
          trackingNumber: normalizedTrackingNumber,
          warehouseId,
          type: shipmentType,
          error,
        });
      }
    });

    log.info('Warehouse shipment created', {
      durationMs: Date.now() - requestStartedAt,
      shipmentId: shipment.id,
      trackingNumber: normalizedTrackingNumber,
      warehouseId,
      type: shipmentType,
    });

    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    log.error('Error creating shipment', { error });
    return NextResponse.json(
      { error: 'فشل في إنشاء الشحنة' },
      { status: 500 }
    );
  }
}
