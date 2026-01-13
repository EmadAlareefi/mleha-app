import { prisma } from '@/lib/prisma';
import { OrderUserRole } from '@prisma/client';
import {
  ServiceKey,
  ServiceRole,
  getRolesFromServiceKeys,
  sanitizeServiceKeys,
} from './service-definitions';

const serviceRoleToPrismaRole: Record<ServiceRole, OrderUserRole> = {
  orders: OrderUserRole.ORDERS,
  store_manager: OrderUserRole.STORE_MANAGER,
  warehouse: OrderUserRole.WAREHOUSE,
  accountant: OrderUserRole.ACCOUNTANT,
  delivery_agent: OrderUserRole.DELIVERY_AGENT,
};

export async function getUserServiceKeys(userId: string): Promise<ServiceKey[]> {
  const permissions = await prisma.userServicePermission.findMany({
    where: { userId },
    select: { serviceKey: true },
  });

  return permissions.map((permission) => permission.serviceKey as ServiceKey);
}

export async function setUserServiceKeys(
  userId: string,
  serviceKeys: ServiceKey[]
): Promise<{ serviceKeys: ServiceKey[]; roles: ServiceRole[] }> {
  const sanitized = sanitizeServiceKeys(serviceKeys);
  const serviceRoles = getRolesFromServiceKeys(sanitized);
  const prismaRoles = serviceRoles
    .map((role) => serviceRoleToPrismaRole[role])
    .filter(Boolean);
  const primaryRole = prismaRoles[0] ?? OrderUserRole.ORDERS;

  await prisma.$transaction(async (tx) => {
    await tx.userServicePermission.deleteMany({ where: { userId } });
    if (sanitized.length > 0) {
      await tx.userServicePermission.createMany({
        data: sanitized.map((key) => ({ userId, serviceKey: key })),
      });
    }

    await tx.orderUser.update({
      where: { id: userId },
      data: {
        role: primaryRole,
      },
    });
  });

  return { serviceKeys: sanitized, roles: serviceRoles };
}

export function derivePrimaryRole(serviceKeys: ServiceKey[]): OrderUserRole {
  const serviceRoles = getRolesFromServiceKeys(serviceKeys);
  const primaryServiceRole = serviceRoles[0];
  if (primaryServiceRole) {
    return serviceRoleToPrismaRole[primaryServiceRole] ?? OrderUserRole.ORDERS;
  }
  return OrderUserRole.ORDERS;
}
