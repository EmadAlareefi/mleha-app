import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';
import type { SallaOrder as PrismaSallaOrder } from '@prisma/client';
import { getSallaOrder, getSallaOrderByReference } from '@/app/lib/salla-api';
import type { SallaOrder as RemoteSallaOrder } from '@/app/lib/salla-api';
import { upsertSallaOrderFromPayload } from '@/app/lib/salla-sync';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const roles = user.roles || [user.role];

    // Check if user is admin or warehouse
    const isAuthorized = roles.includes('admin') || roles.includes('warehouse');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('query') || searchParams.get('orderNumber');

    if (!rawQuery || !rawQuery.trim()) {
      return NextResponse.json({ error: 'يرجى إدخال رقم الطلب أو بيانات البحث' }, { status: 400 });
    }

    const searchQuery = rawQuery.trim();
    const digitsOnlyQuery = searchQuery.replace(/[^0-9]/g, '');

    const normalizedQueryVariants = new Set<string>();
    const addVariant = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      normalizedQueryVariants.add(trimmed);
    };

    addVariant(searchQuery);
    addVariant(searchQuery.toLowerCase());
    addVariant(searchQuery.toUpperCase());
    if (digitsOnlyQuery) {
      addVariant(digitsOnlyQuery);
      const noLeadingZeros = digitsOnlyQuery.replace(/^0+/, '');
      if (noLeadingZeros && noLeadingZeros !== digitsOnlyQuery) {
        addVariant(noLeadingZeros);
      }
      addVariant(`#${digitsOnlyQuery}`);
    }

    const phoneVariants = new Set<string>();
    if (digitsOnlyQuery) {
      phoneVariants.add(digitsOnlyQuery);
      const withoutCountryCode = digitsOnlyQuery.startsWith('966') ? digitsOnlyQuery.slice(3) : digitsOnlyQuery;
      phoneVariants.add(withoutCountryCode);
      if (!withoutCountryCode.startsWith('0')) {
        phoneVariants.add(`0${withoutCountryCode}`);
      }
      phoneVariants.add(`+${digitsOnlyQuery}`);
    }
    phoneVariants.add(searchQuery);

    const referencePaths = [
      ['reference_id'],
      ['referenceId'],
      ['reference'],
      ['reference_code'],
      ['referenceCode'],
      ['reference_number'],
      ['referenceNumber'],
      ['order_number'],
      ['orderNumber'],
      ['order_no'],
      ['orderNo'],
    ];

    const phonePaths = [
      ['customer', 'mobile'],
      ['customer', 'phone'],
      ['customer', 'mobile_code'],
      ['customer', 'mobileNumber'],
      ['customer', 'contact'],
      ['shipping_address', 'mobile'],
      ['shipping_address', 'phone'],
      ['billing_address', 'mobile'],
      ['billing_address', 'phone'],
    ];

    const customerIdPaths = [
      ['customer', 'id'],
      ['customer_id'],
      ['customerId'],
      ['customer_number'],
      ['customerNumber'],
    ];

    const sallaFilters: Prisma.SallaOrderWhereInput[] = [];
    const assignmentFilters: Prisma.OrderAssignmentWhereInput[] = [];
    const historyFilters: Prisma.OrderHistoryWhereInput[] = [];
    const addFiltersForBoth = (
      assignmentFilter: Prisma.OrderAssignmentWhereInput,
      historyFilter: Prisma.OrderHistoryWhereInput,
    ) => {
      assignmentFilters.push(assignmentFilter);
      historyFilters.push(historyFilter);
    };

    addFiltersForBoth({ orderNumber: searchQuery }, { orderNumber: searchQuery });
    addFiltersForBoth({ orderId: searchQuery }, { orderId: searchQuery });

    normalizedQueryVariants.forEach((variant) => {
      addFiltersForBoth({ orderNumber: variant }, { orderNumber: variant });
      addFiltersForBoth(
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
      );
      addFiltersForBoth({ orderId: variant }, { orderId: variant });
      addFiltersForBoth(
        { orderId: { contains: variant, mode: 'insensitive' } },
        { orderId: { contains: variant, mode: 'insensitive' } },
      );

      sallaFilters.push(
        { orderNumber: variant },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { referenceId: variant },
        { referenceId: { contains: variant, mode: 'insensitive' } },
        { orderId: variant },
        { orderId: { contains: variant, mode: 'insensitive' } },
        { id: variant },
        { id: { contains: variant, mode: 'insensitive' } },
        { customerId: variant },
        { customerId: { contains: variant, mode: 'insensitive' } },
      );
    });

    referencePaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        addFiltersForBoth(
          { orderData: { path, equals: variant } },
          { orderData: { path, equals: variant } },
        );
        addFiltersForBoth(
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            addFiltersForBoth(
              { orderData: { path, equals: variantNumber } },
              { orderData: { path, equals: variantNumber } },
            );
          }
        }
      });
    });

    customerIdPaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        addFiltersForBoth(
          { orderData: { path, equals: variant } },
          { orderData: { path, equals: variant } },
        );
        addFiltersForBoth(
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            addFiltersForBoth(
              { orderData: { path, equals: variantNumber } },
              { orderData: { path, equals: variantNumber } },
            );
          }
        }
      });
    });

    if (digitsOnlyQuery.length >= 5) {
      phonePaths.forEach((path) => {
        phoneVariants.forEach((variant) => {
          addFiltersForBoth(
            { orderData: { path, string_contains: variant, mode: 'insensitive' } },
            { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          );
          addFiltersForBoth(
            { orderData: { path, equals: variant } },
            { orderData: { path, equals: variant } },
          );
        });
      });

      phoneVariants.forEach((variant) => {
        sallaFilters.push(
          { customerMobile: { contains: variant } },
          { customerMobile: { equals: variant } },
        );
      });
    }

    const buildResponsePayload = (record: any, type: 'assignment' | 'history') => {
      const assignedName = type === 'assignment'
        ? (record.user as any)?.name || (record.user as any)?.username
        : record.userName;

      return {
        id: record.id,
        orderId: record.orderId,
        orderNumber: record.orderNumber,
        orderData: record.orderData,
        merchantId: record.merchantId,
        status: record.status,
        sallaStatus: type === 'assignment' ? record.sallaStatus : record.finalSallaStatus,
        assignedUserId: record.userId,
        assignedUserName: assignedName || '—',
        assignedAt: record.assignedAt.toISOString(),
        startedAt: record.startedAt ? record.startedAt.toISOString() : null,
        completedAt: type === 'assignment'
          ? (record.completedAt ? record.completedAt.toISOString() : null)
          : (record.finishedAt ? record.finishedAt.toISOString() : null),
        notes: record.notes,
        source: type,
      };
    };

    // Search for the order assignment
    const assignment = await prisma.orderAssignment.findFirst({
      where: {
        OR: assignmentFilters,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        assignedAt: 'desc', // Get the most recent assignment
      },
    });

    if (assignment) {
      const payload = buildResponsePayload(assignment, 'assignment');
      const shipment = await getShipmentInfoForOrder({
        merchantId: payload.merchantId,
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
      });

      return NextResponse.json({
        success: true,
        assignment: {
          ...payload,
          shipment,
        },
      });
    }

    const historyEntry = await prisma.orderHistory.findFirst({
      where: {
        OR: historyFilters,
      },
      orderBy: {
        finishedAt: 'desc',
      },
    });

    if (historyEntry) {
      const payload = buildResponsePayload(historyEntry, 'history');
      const shipment = await getShipmentInfoForOrder({
        merchantId: payload.merchantId,
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
      });

      return NextResponse.json({
        success: true,
        assignment: {
          ...payload,
          shipment,
        },
      });
    }

    if (sallaFilters.length > 0) {
      const sallaOrder = await prisma.sallaOrder.findFirst({
        where: {
          merchantId: MERCHANT_ID,
          OR: sallaFilters,
        },
        orderBy: {
          updatedAtRemote: 'desc',
        },
      });

      if (sallaOrder) {
        const payload = buildSallaAssignmentFromRecord(sallaOrder);
        const shipment = await getShipmentInfoForOrder({
          merchantId: payload.merchantId,
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });

        return NextResponse.json({
          success: true,
          assignment: {
            ...payload,
            shipment,
          },
        });
      }

      const syncedOrder = await syncOrderFromSalla(normalizedQueryVariants, digitsOnlyQuery);
      if (syncedOrder?.persisted) {
        const payload = buildSallaAssignmentFromRecord(syncedOrder.persisted);
        const shipment = await getShipmentInfoForOrder({
          merchantId: payload.merchantId,
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });

        return NextResponse.json({
          success: true,
          assignment: {
            ...payload,
            shipment,
          },
        });
      }
      if (syncedOrder?.remote) {
        const payload = buildAssignmentFromRemoteOrder(syncedOrder.remote);
        const shipment = await getShipmentInfoForOrder({
          merchantId: payload.merchantId,
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });

        return NextResponse.json({
          success: true,
          assignment: {
            ...payload,
            shipment,
          },
        });
      }
    }

    return NextResponse.json({
      success: false,
      error: 'لم يتم العثور على الطلب'
    }, { status: 404 });
  } catch (error) {
    console.error('Error searching for order:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الطلب' },
      { status: 500 }
    );
  }
}

type SyncedOrderResult = {
  persisted: PrismaSallaOrder | null;
  remote: RemoteSallaOrder;
};

function buildSallaAssignmentFromRecord(record: PrismaSallaOrder) {
  const placedAt = record.placedAt || record.updatedAtRemote || new Date();
  const orderData = (record.rawOrder as any) || {
    id: record.orderId,
    reference_id: record.referenceId,
    customer: {
      first_name: record.customerName,
      mobile: record.customerMobile,
      email: record.customerEmail,
      city: record.customerCity,
      country: record.customerCountry,
    },
    payment_status: record.paymentStatus,
    payment_method: record.paymentMethod,
    shipping_method: record.fulfillmentCompany,
    delivery: {
      courier_name: record.fulfillmentCompany,
      tracking_number: record.trackingNumber,
    },
  };

  return {
    id: record.id,
    orderId: record.orderId,
    orderNumber: record.orderNumber || record.referenceId || record.orderId,
    orderData,
    status: record.statusSlug || record.statusName || 'unknown',
    sallaStatus: record.statusSlug,
    assignedUserId: 'salla-system',
    assignedUserName: 'بيانات سلة',
    assignedAt: placedAt.toISOString(),
    startedAt: null,
    completedAt: record.updatedAtRemote ? record.updatedAtRemote.toISOString() : null,
    notes: undefined,
    source: 'salla',
    merchantId: record.merchantId,
  };
}

function buildAssignmentFromRemoteOrder(order: RemoteSallaOrder) {
  const placedAt = order.date?.created ? new Date(order.date.created) : new Date();
  const updatedAt = order.date?.updated ? new Date(order.date.updated) : null;

  return {
    id: String(order.id),
    orderId: String(order.id),
    orderNumber: order.reference_id || String(order.id),
    orderData: order,
    status: order.status?.slug || order.status?.name || 'unknown',
    sallaStatus: order.status?.slug,
    assignedUserId: 'salla-system',
    assignedUserName: 'بيانات سلة',
    assignedAt: placedAt.toISOString(),
    startedAt: null,
    completedAt: updatedAt ? updatedAt.toISOString() : null,
    notes: undefined,
    source: 'salla',
    merchantId: (order as any)?.merchant_id || MERCHANT_ID,
  };
}

async function syncOrderFromSalla(
  normalizedQueryVariants: Set<string>,
  digitsOnlyQuery: string
): Promise<SyncedOrderResult | null> {
  const remoteOrder = await fetchRemoteOrderFromSalla(normalizedQueryVariants, digitsOnlyQuery);

  if (!remoteOrder) {
    return null;
  }

  const orderWithMerchant: RemoteSallaOrder & Record<string, any> = {
    ...remoteOrder,
    merchant_id: (remoteOrder as any).merchant_id ?? MERCHANT_ID,
    merchantId: (remoteOrder as any).merchantId ?? MERCHANT_ID,
    store: (remoteOrder as any).store ?? { id: MERCHANT_ID },
    store_id: (remoteOrder as any).store_id ?? MERCHANT_ID,
    storeId: (remoteOrder as any).storeId ?? MERCHANT_ID,
  };

  await upsertSallaOrderFromPayload({
    merchantId: MERCHANT_ID,
    merchant_id: MERCHANT_ID,
    order: orderWithMerchant,
  });

  const remoteOrderId =
    typeof orderWithMerchant.id === 'number' || typeof orderWithMerchant.id === 'string'
      ? String(orderWithMerchant.id)
      : null;

  let persisted: PrismaSallaOrder | null = null;

  if (remoteOrderId) {
    persisted = await prisma.sallaOrder.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId: remoteOrderId,
        },
      },
    });
  }

  if (!persisted) {
    const referenceId =
      (orderWithMerchant as any).referenceId ||
      orderWithMerchant.reference_id ||
      null;

    if (referenceId) {
      persisted = await prisma.sallaOrder.findFirst({
        where: {
          merchantId: MERCHANT_ID,
          OR: [{ referenceId }, { orderNumber: referenceId }],
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    }
  }

  return { persisted, remote: orderWithMerchant };
}

async function fetchRemoteOrderFromSalla(
  normalizedQueryVariants: Set<string>,
  digitsOnlyQuery: string
): Promise<RemoteSallaOrder | null> {
  const orderIdCandidates = new Set<string>();
  if (digitsOnlyQuery) {
    orderIdCandidates.add(digitsOnlyQuery);
    const withoutLeadingZeros = digitsOnlyQuery.replace(/^0+/, '');
    if (withoutLeadingZeros && withoutLeadingZeros !== digitsOnlyQuery) {
      orderIdCandidates.add(withoutLeadingZeros);
    }
  }

  for (const candidate of orderIdCandidates) {
    if (!candidate) continue;
    const order = await getSallaOrder(MERCHANT_ID, candidate);
    if (order) {
      return order;
    }
  }

  for (const variant of normalizedQueryVariants) {
    const trimmed = variant.trim();
    if (!trimmed) continue;
    const order = await getSallaOrderByReference(MERCHANT_ID, trimmed);
    if (order) {
      return order;
    }
  }

  return null;
}

async function getShipmentInfoForOrder(params: {
  merchantId?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
}) {
  const { merchantId, orderId, orderNumber } = params;
  const orConditions: Prisma.SallaShipmentWhereInput[] = [];

  if (orderId) {
    orConditions.push({ orderId }, { orderNumber: orderId });
  }

  if (orderNumber) {
    orConditions.push({ orderNumber }, { orderId: orderNumber });
  }

  if (orConditions.length === 0) {
    return null;
  }

  const shipment = await prisma.sallaShipment.findFirst({
    where: {
      ...(merchantId ? { merchantId } : {}),
      OR: orConditions,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!shipment) {
    return null;
  }

  const shipmentData = shipment.shipmentData as any;
  const labelUrl =
    shipment.labelUrl ||
    shipmentData?.label_url ||
    shipmentData?.label?.url ||
    (typeof shipmentData?.label === 'string' ? shipmentData.label : null);

  return {
    id: shipment.id,
    trackingNumber: shipment.trackingNumber,
    courierName: shipment.courierName,
    status: shipment.status,
    labelUrl,
    labelPrinted: shipment.labelPrinted,
    labelPrintedAt: shipment.labelPrintedAt ? shipment.labelPrintedAt.toISOString() : null,
    printCount: shipment.printCount,
    updatedAt: shipment.updatedAt.toISOString(),
  };
}
