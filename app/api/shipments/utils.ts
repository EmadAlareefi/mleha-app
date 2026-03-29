import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';

export async function resolveWarehouseIds(session: any): Promise<string[]> {
  const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
  if (Array.isArray(warehouses) && warehouses.length > 0) {
    return warehouses
      .map((warehouse) => warehouse?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  const userId = (session?.user as any)?.id;
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
      .map((assignment) => assignment.warehouse?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch (error) {
    console.error('Failed to resolve warehouse IDs from DB', error);
    return [];
  }
}

export function hasWarehouseFeatureAccess(session: any): boolean {
  if (!session?.user) {
    return false;
  }

  if (
    hasServiceAccess(session, [
      'warehouse',
      'local-shipping',
      'shipment-assignments',
      'returns-inspection',
    ])
  ) {
    return true;
  }

  const primaryRole = (session.user as any)?.role;
  if (primaryRole === 'admin' || primaryRole === 'warehouse') {
    return true;
  }
  const roles = ((session.user as any)?.roles || []) as string[];
  return roles.includes('admin') || roles.includes('warehouse');
}
