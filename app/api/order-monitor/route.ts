import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

const allowedServices: ServiceKey[] = ['order-prep', 'order-shipping', 'admin-order-prep'];

type AssignmentRecord = {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  orderReference: string | null;
  status: string;
  userId: string;
  userName: string;
  assignedAt: Date;
  startedAt: Date | null;
  waitingAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastStatusUpdateAt: Date;
};

type ShipmentRecord = {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  trackingNumber: string | null;
  courierName: string | null;
  courierCode: string | null;
  status: string | null;
  labelUrl: string | null;
  labelPrinted: boolean;
  labelPrintedAt: Date | null;
  labelPrintedBy: string | null;
  labelPrintedByName: string | null;
  printCount: number | null;
  updatedAt: Date;
  createdAt: Date;
};

type MonitorRecord = {
  merchantId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderReference: string | null;
  assignmentId: string | null;
  prepStatus: string | null;
  preparedById: string | null;
  preparedByName: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  waitingAt: string | null;
  shippedById: string | null;
  shippedByName: string | null;
  shippedAt: string | null;
  shippingStatus: string | null;
  courierName: string | null;
  courierCode: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  labelPrinted: boolean | null;
  labelPrintCount: number | null;
  latestActivityAt: string | null;
};

type InternalMonitorRecord = MonitorRecord & {
  _latestActivityMs: number;
};

const toIso = (value?: Date | null): string | null =>
  value ? value.toISOString() : null;

const maxTimestamp = (currentMs: number, nextDate: Date | null): number => {
  if (!nextDate) {
    return currentMs;
  }
  const nextMs = nextDate.getTime();
  if (Number.isNaN(nextMs)) {
    return currentMs;
  }
  return Math.max(currentMs, nextMs);
};

const parseDateInput = (value: string | null, endOfDay = false): Date | null => {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (endOfDay) {
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  return new Date(year, month - 1, day);
};

const buildAssignmentSearchFilters = (
  query: string,
): Prisma.OrderPrepAssignmentWhereInput[] => {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }
  const digitsOnly = normalized.replace(/[^0-9]/g, '');

  const filters: Prisma.OrderPrepAssignmentWhereInput[] = [
    { orderNumber: { contains: normalized, mode: 'insensitive' } },
    { orderId: { contains: normalized, mode: 'insensitive' } },
    { orderReference: { contains: normalized, mode: 'insensitive' } },
    { userName: { contains: normalized, mode: 'insensitive' } },
  ];

  if (digitsOnly) {
    filters.push(
      { orderNumber: digitsOnly },
      { orderId: digitsOnly },
      { orderReference: digitsOnly },
    );
  }

  return filters;
};

const buildShipmentSearchFilters = (query: string): Prisma.SallaShipmentWhereInput[] => {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }
  const digitsOnly = normalized.replace(/[^0-9]/g, '');
  const filters: Prisma.SallaShipmentWhereInput[] = [
    { orderNumber: { contains: normalized, mode: 'insensitive' } },
    { orderId: { contains: normalized, mode: 'insensitive' } },
    { trackingNumber: { contains: normalized, mode: 'insensitive' } },
    { courierName: { contains: normalized, mode: 'insensitive' } },
  ];
  if (digitsOnly) {
    filters.push(
      { orderNumber: digitsOnly },
      { orderId: digitsOnly },
      { trackingNumber: digitsOnly },
    );
  }
  return filters;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasServiceAccess(session, allowedServices)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('query') || '').trim();
    const limitParam = searchParams.get('limit');
    const limit = Math.max(
      1,
      Math.min(Number.parseInt(limitParam || '', 10) || DEFAULT_LIMIT, MAX_LIMIT),
    );
    const daysParam = searchParams.get('days');
    const requestedMerchantId = searchParams.get('merchantId') || MERCHANT_ID;
    const missingShipmentOnly = searchParams.get('missingShipment') === '1';
    const statusFilter = (searchParams.get('prepStatus') || '').trim();
    const startDate = parseDateInput(searchParams.get('startDate'), false);
    const endDate = parseDateInput(searchParams.get('endDate'), true);

    const useCustomDateRange = Boolean(startDate || endDate);
    const resolvedDays = query || useCustomDateRange
      ? null
      : Math.max(1, Number.parseInt(daysParam || `${DEFAULT_DAYS}`, 10) || DEFAULT_DAYS);
    const sinceDate = resolvedDays ? new Date(Date.now() - resolvedDays * DAY_MS) : null;

    const assignmentWhere: Prisma.OrderPrepAssignmentWhereInput = {
      merchantId: requestedMerchantId,
    };
    const assignmentDateFilter: Prisma.DateTimeFilter = {};
    if (startDate) {
      assignmentDateFilter.gte = startDate;
    }
    if (endDate) {
      assignmentDateFilter.lte = endDate;
    }
    if (assignmentDateFilter.gte || assignmentDateFilter.lte) {
      assignmentWhere.assignedAt = assignmentDateFilter;
    } else if (sinceDate) {
      assignmentWhere.assignedAt = { gte: sinceDate };
    }
    if (query) {
      const filters = buildAssignmentSearchFilters(query);
      if (filters.length) {
        assignmentWhere.OR = filters;
      }
    }
    if (statusFilter) {
      assignmentWhere.status = statusFilter;
    }

    const assignments = await prisma.orderPrepAssignment.findMany({
      where: assignmentWhere,
      orderBy: [
        { completedAt: 'desc' },
        { assignedAt: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        orderNumber: true,
        orderReference: true,
        status: true,
        userId: true,
        userName: true,
        assignedAt: true,
        startedAt: true,
        waitingAt: true,
        completedAt: true,
        cancelledAt: true,
        lastStatusUpdateAt: true,
      },
    });

    const orderIds = assignments.map((assignment) => assignment.orderId);

    const shipmentDateFilter: Prisma.DateTimeFilter = {};
    if (startDate) {
      shipmentDateFilter.gte = startDate;
    }
    if (endDate) {
      shipmentDateFilter.lte = endDate;
    }
    const hasCustomDateFilter = Boolean(shipmentDateFilter.gte || shipmentDateFilter.lte);

    const shipmentWhere: Prisma.SallaShipmentWhereInput = {
      merchantId: requestedMerchantId,
    };
    if (query) {
      const shipmentFilters = buildShipmentSearchFilters(query);
      if (shipmentFilters.length) {
        shipmentWhere.OR = shipmentFilters;
      }
    } else {
      if (orderIds.length && sinceDate) {
        shipmentWhere.OR = [
          { orderId: { in: orderIds } },
          { updatedAt: { gte: sinceDate } },
        ];
      } else if (orderIds.length && !hasCustomDateFilter) {
        shipmentWhere.orderId = { in: orderIds };
      } else if (sinceDate) {
        shipmentWhere.updatedAt = { gte: sinceDate };
      }
    }
    if (hasCustomDateFilter) {
      shipmentWhere.updatedAt = shipmentDateFilter;
    }

    const shipments = await prisma.sallaShipment.findMany({
      where: shipmentWhere,
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        orderNumber: true,
        trackingNumber: true,
        courierName: true,
        courierCode: true,
        status: true,
        labelUrl: true,
        labelPrinted: true,
        labelPrintedAt: true,
        labelPrintedBy: true,
        labelPrintedByName: true,
        printCount: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const recordMap = new Map<string, InternalMonitorRecord>();

    assignments.forEach((assignment: AssignmentRecord) => {
      const latestAt =
        assignment.completedAt ??
        assignment.lastStatusUpdateAt ??
        assignment.assignedAt;
      recordMap.set(assignment.orderId, {
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
        orderNumber: assignment.orderNumber ?? assignment.orderId,
        orderReference: assignment.orderReference,
        assignmentId: assignment.id,
        prepStatus: assignment.status,
        preparedById: assignment.userId,
        preparedByName: assignment.userName,
        assignedAt: toIso(assignment.assignedAt),
        startedAt: toIso(assignment.startedAt),
        waitingAt: toIso(assignment.waitingAt),
        completedAt: toIso(assignment.completedAt),
        cancelledAt: toIso(assignment.cancelledAt),
        shippedById: null,
        shippedByName: null,
        shippedAt: null,
        shippingStatus: null,
        courierName: null,
        courierCode: null,
        trackingNumber: null,
        labelUrl: null,
        labelPrinted: null,
        labelPrintCount: null,
        latestActivityAt: latestAt ? latestAt.toISOString() : null,
        _latestActivityMs: latestAt ? latestAt.getTime() : 0,
      });
    });

    shipments.forEach((shipment: ShipmentRecord) => {
      const existing = recordMap.get(shipment.orderId);
      const base: InternalMonitorRecord =
        existing ??
        {
          merchantId: shipment.merchantId,
          orderId: shipment.orderId,
          orderNumber: shipment.orderNumber ?? shipment.orderId,
          orderReference: null,
          assignmentId: null,
          prepStatus: null,
          preparedById: null,
          preparedByName: null,
          assignedAt: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          waitingAt: null,
          shippedById: null,
          shippedByName: null,
          shippedAt: null,
          shippingStatus: null,
          courierName: null,
          courierCode: null,
          trackingNumber: null,
          labelUrl: null,
          labelPrinted: null,
          labelPrintCount: null,
          latestActivityAt: null,
          _latestActivityMs: 0,
        };

      base.shippedById = shipment.labelPrintedBy ?? base.shippedById;
      base.shippedByName = shipment.labelPrintedByName ?? base.shippedByName;
      base.shippedAt = toIso(shipment.labelPrintedAt) ?? base.shippedAt;
      base.shippingStatus = shipment.status ?? base.shippingStatus;
      base.courierName = shipment.courierName ?? base.courierName;
      base.courierCode = shipment.courierCode ?? base.courierCode;
      base.trackingNumber = shipment.trackingNumber ?? base.trackingNumber;
      base.labelUrl = shipment.labelUrl ?? base.labelUrl;
      base.labelPrinted = shipment.labelPrinted ?? base.labelPrinted;
      base.labelPrintCount = shipment.printCount ?? base.labelPrintCount;

      const shipmentActivity =
        shipment.labelPrintedAt ?? shipment.updatedAt ?? shipment.createdAt;
      base._latestActivityMs = maxTimestamp(base._latestActivityMs, shipmentActivity);
      base.latestActivityAt =
        base._latestActivityMs > 0 ? new Date(base._latestActivityMs).toISOString() : base.latestActivityAt;

      recordMap.set(shipment.orderId, base);
    });

    let mergedRecords = Array.from(recordMap.values())
      .sort((a, b) => b._latestActivityMs - a._latestActivityMs)
      .map(({ _latestActivityMs, ...rest }) => ({
        ...rest,
        latestActivityAt:
          rest.latestActivityAt ??
          (_latestActivityMs > 0 ? new Date(_latestActivityMs).toISOString() : null),
      }));

    if (statusFilter) {
      mergedRecords = mergedRecords.filter((record) => record.prepStatus === statusFilter);
    }
    if (missingShipmentOnly) {
      mergedRecords = mergedRecords.filter(
        (record) =>
          !record.shippingStatus &&
          !record.trackingNumber &&
          !record.labelUrl &&
          !record.labelPrinted,
      );
    }

    mergedRecords = mergedRecords.slice(0, limit);

    return NextResponse.json({
      success: true,
      records: mergedRecords,
      meta: {
        query: query || null,
        limit,
        days: resolvedDays,
        counts: {
          assignments: assignments.length,
          shipments: shipments.length,
          records: mergedRecords.length,
        },
        lastRefreshedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Failed to load order monitor data', error);
    return NextResponse.json(
      { error: 'Failed to load monitor data' },
      { status: 500 },
    );
  }
}
