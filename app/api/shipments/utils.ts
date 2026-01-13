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
