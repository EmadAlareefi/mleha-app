import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import WarehouseDashboardClient from './WarehouseDashboardClient';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Shipment, WarehouseInfo } from '@/components/warehouse/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Stats {
  total: number;
  incoming: number;
  outgoing: number;
  handoverConfirmed: number;
  byCompany: Array<{ company: string; count: number }>;
}

const EMPTY_STATS: Stats = {
  total: 0,
  incoming: 0,
  outgoing: 0,
  handoverConfirmed: 0,
  byCompany: [],
};
const WAREHOUSE_SHIPMENTS_PAGE_LIMIT = 300;

function extractUserRoles(session: Session | null): string[] {
  if (!session?.user) {
    return [];
  }

  const sessionUser = session.user as any;
  const inferredRoles = new Set<string>();

  const roles = sessionUser?.roles;
  if (Array.isArray(roles)) {
    roles.forEach((role) => {
      if (typeof role === 'string' && role.trim()) {
        inferredRoles.add(role);
      }
    });
  }

  const legacyRole = sessionUser?.role;
  if (typeof legacyRole === 'string' && legacyRole.trim()) {
    inferredRoles.add(legacyRole);
  }

  const serviceKeys: string[] = Array.isArray(sessionUser?.serviceKeys)
    ? sessionUser.serviceKeys
    : [];
  if (serviceKeys.includes('warehouse')) {
    inferredRoles.add('warehouse');
  }
  if (serviceKeys.includes('admin')) {
    inferredRoles.add('admin');
  }

  return Array.from(inferredRoles);
}

function extractSessionWarehouses(session: Session | null, allowExtraction: boolean): WarehouseInfo[] {
  if (!allowExtraction || !session?.user) {
    return [];
  }

  const warehouses = (session.user as any)?.warehouseData?.warehouses ?? [];
  if (!Array.isArray(warehouses)) {
    return [];
  }

  return warehouses
    .filter((warehouse: any) => warehouse && typeof warehouse.id === 'string')
    .map((warehouse: any) => ({
      id: warehouse.id,
      name: warehouse.name || 'بدون اسم',
      code: warehouse.code || null,
      location: warehouse.location || null,
    }));
}

function pickDefaultWarehouseId(
  isAdmin: boolean,
  hasWarehouseRole: boolean,
  adminWarehouses: WarehouseInfo[],
  sessionWarehouses: WarehouseInfo[]
): string | null {
  if (isAdmin) {
    if (adminWarehouses.length > 0) {
      return adminWarehouses[0].id;
    }
    if (sessionWarehouses.length > 0) {
      return sessionWarehouses[0].id;
    }
    return null;
  }

  if (hasWarehouseRole) {
    if (sessionWarehouses.length > 0) {
      return sessionWarehouses[0].id;
    }
    if (adminWarehouses.length > 0) {
      return adminWarehouses[0].id;
    }
    return null;
  }

  return adminWarehouses[0]?.id ?? null;
}

async function loadAccessibleWarehouses(canLoad: boolean) {
  if (!canLoad) {
    return { warehouses: [] as WarehouseInfo[], error: null as string | null };
  }

  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        location: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return { warehouses, error: null };
  } catch (error) {
    console.error('Failed to load admin warehouses', error);
    return {
      warehouses: [],
      error: 'تعذر تحميل قائمة المستودعات. حاول مرة أخرى لاحقاً.',
    };
  }
}

async function loadWarehouseSnapshot({
  date,
  warehouseId,
}: {
  date: Date;
  warehouseId: string | null;
}): Promise<{ shipments: Shipment[]; stats: Stats; hasMore: boolean }> {
  if (!warehouseId) {
    return { shipments: [], stats: EMPTY_STATS, hasMore: false };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const where = {
    warehouseId,
    scannedAt: {
      gte: startOfDay,
      lte: endOfDay,
    },
  };

  try {
    const shipmentsRaw = await prisma.shipment.findMany({
      where,
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: {
        scannedAt: 'desc',
      },
      take: WAREHOUSE_SHIPMENTS_PAGE_LIMIT + 1,
    });
    const hasMore = shipmentsRaw.length > WAREHOUSE_SHIPMENTS_PAGE_LIMIT;
    const visibleShipments = hasMore
      ? shipmentsRaw.slice(0, WAREHOUSE_SHIPMENTS_PAGE_LIMIT)
      : shipmentsRaw;

    const handoverWhere = {
      ...where,
      handoverScannedAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    const [incoming, outgoing, byCompany, handoverConfirmed] = await Promise.all([
      prisma.shipment.count({
        where: { ...where, type: 'incoming' },
      }),
      prisma.shipment.count({
        where: { ...where, type: 'outgoing' },
      }),
      prisma.shipment.groupBy({
        by: ['company'],
        where,
        _count: {
          company: true,
        },
      }),
      prisma.shipment.count({
        where: handoverWhere,
      }),
    ]);

    const shipments: Shipment[] = visibleShipments.map((shipment) => ({
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      company: shipment.company,
      type: shipment.type as 'incoming' | 'outgoing',
      scannedAt: shipment.scannedAt.toISOString(),
      scannedBy: shipment.scannedBy || null,
      handoverScannedAt: shipment.handoverScannedAt
        ? shipment.handoverScannedAt.toISOString()
        : null,
      handoverScannedBy: shipment.handoverScannedBy || null,
      notes: shipment.notes,
      smsaLiveStatus: ((shipment as any).smsaLiveStatus as any) || null,
      smsaLiveStatusUpdatedAt: (shipment as any).smsaLiveStatusUpdatedAt
        ? (shipment as any).smsaLiveStatusUpdatedAt.toISOString()
        : null,
      warehouse: shipment.warehouse
        ? {
            id: shipment.warehouse.id,
            name: shipment.warehouse.name,
            code: shipment.warehouse.code,
          }
        : null,
    }));

    const stats: Stats = {
      total: incoming + outgoing,
      incoming,
      outgoing,
      handoverConfirmed,
      byCompany: byCompany.map((item) => ({
        company: item.company,
        count: item._count.company,
      })),
    };

    return { shipments, stats, hasMore };
  } catch (error) {
    console.error('Failed to load warehouse snapshot', error);
    return { shipments: [], stats: EMPTY_STATS, hasMore: false };
  }
}

async function loadUserWarehousesFromDb(userId?: string | null): Promise<WarehouseInfo[]> {
  if (!userId) {
    return [];
  }

  try {
    const assignments = await prisma.warehouseAssignment.findMany({
      where: {
        userId,
        warehouse: {
          isActive: true,
        },
      },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
            location: true,
          },
        },
      },
    });

    return assignments
      .filter((assignment) => assignment.warehouse)
      .map((assignment) => ({
        id: assignment.warehouse.id,
        name: assignment.warehouse.name,
        code: assignment.warehouse.code,
        location: assignment.warehouse.location,
      }));
  } catch (error) {
    console.error('Failed to load user warehouses from DB', error);
    return [];
  }
}

export default async function WarehousePage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const userRoles = extractUserRoles(session);
  const isAdmin = userRoles.includes('admin');
  const hasWarehouseRole = userRoles.includes('warehouse') || hasServiceAccess(session, 'warehouse');
  const canAccess = isAdmin || hasWarehouseRole;

  if (!canAccess) {
    return (
      <AppPageShell title="لوحة المستودع" subtitle="لا تملك صلاحية الوصول إلى هذه الصفحة">
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertDescription className="text-center">
            <span className="block text-lg font-semibold">
            لا تملك صلاحية الوصول إلى لوحة المستودع.
            </span>
            <span className="mt-4 block text-sm">
            يرجى التواصل مع المسؤول لمنحك صلاحية خدمة المستودع.
            </span>
          </AlertDescription>
        </Alert>
      </AppPageShell>
    );
  }

  let sessionWarehouses = extractSessionWarehouses(session, hasWarehouseRole);
  if (!isAdmin && hasWarehouseRole && sessionWarehouses.length === 0) {
    sessionWarehouses = await loadUserWarehousesFromDb((session?.user as any)?.id);
  }
  const { warehouses: adminWarehouses, error: adminWarehouseError } = await loadAccessibleWarehouses(
    isAdmin || hasWarehouseRole
  );
  const defaultWarehouseId = pickDefaultWarehouseId(
    isAdmin,
    hasWarehouseRole,
    adminWarehouses,
    sessionWarehouses
  );

  const today = new Date();
  const { shipments, stats, hasMore: initialShipmentsHasMore } = defaultWarehouseId
    ? await loadWarehouseSnapshot({
        date: today,
        warehouseId: defaultWarehouseId,
      })
    : { shipments: [], stats: EMPTY_STATS, hasMore: false };

  return (
    <WarehouseDashboardClient
      isAdmin={isAdmin}
      hasWarehouseRole={hasWarehouseRole}
      sessionWarehouses={sessionWarehouses}
      initialAdminWarehouses={adminWarehouses}
      defaultWarehouseId={defaultWarehouseId}
      initialShipments={shipments}
      initialShipmentsHasMore={initialShipmentsHasMore}
      initialStats={stats}
      initialDateIso={today.toISOString()}
      initialWarehouseError={adminWarehouseError}
    />
  );
}
