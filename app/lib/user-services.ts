import { prisma } from '@/lib/prisma';
import { OrderUserRole } from '@prisma/client';
import {
  ServiceKey,
  ServiceRole,
  getDefaultServiceKeysForRoles,
  getRolesFromServiceKeys,
  sanitizeServiceKeys,
} from './service-definitions';

const prismaRoleToServiceRole: Record<OrderUserRole, ServiceRole> = {
  [OrderUserRole.ORDERS]: 'orders',
  [OrderUserRole.STORE_MANAGER]: 'store_manager',
  [OrderUserRole.WAREHOUSE]: 'warehouse',
  [OrderUserRole.ACCOUNTANT]: 'accountant',
  [OrderUserRole.DELIVERY_AGENT]: 'delivery_agent',
};

const serviceRoleToPrismaRole: Record<ServiceRole, OrderUserRole> = {
  orders: OrderUserRole.ORDERS,
  store_manager: OrderUserRole.STORE_MANAGER,
  warehouse: OrderUserRole.WAREHOUSE,
  accountant: OrderUserRole.ACCOUNTANT,
  delivery_agent: OrderUserRole.DELIVERY_AGENT,
};

export function toServiceRoles(roles: OrderUserRole[]): ServiceRole[] {
  const unique = new Set<ServiceRole>();
  roles.forEach((role) => {
    const mapped = prismaRoleToServiceRole[role];
    if (mapped) {
      unique.add(mapped);
    }
  });
  return Array.from(unique);
}

export async function getUserServiceKeys(userId: string): Promise<ServiceKey[]> {
  const permissions = await prisma.userServicePermission.findMany({
    where: { userId },
    select: { serviceKey: true },
  });

  return permissions.map((permission) => permission.serviceKey as ServiceKey);
}

export async function ensureUserServiceKeys(
  userId: string,
  fallbackRoles: OrderUserRole[]
): Promise<ServiceKey[]> {
  const existing = await getUserServiceKeys(userId);
  if (existing.length > 0) {
    return existing;
  }

  const serviceRoles = toServiceRoles(fallbackRoles);
  const defaults = getDefaultServiceKeysForRoles(serviceRoles);

  if (defaults.length === 0) {
    return [];
  }

  await setUserServiceKeys(userId, defaults);
  return defaults;
}

export async function setUserServiceKeys(
  userId: string,
  serviceKeys: ServiceKey[],
  assignedBy?: string
): Promise<{ serviceKeys: ServiceKey[]; roles: ServiceRole[]; prismaRoles: OrderUserRole[] }> {
  const sanitized = sanitizeServiceKeys(serviceKeys);
  const serviceRoles = getRolesFromServiceKeys(sanitized);
  const prismaRoles = serviceRoles.map((role) => serviceRoleToPrismaRole[role]);
  const primaryRole = prismaRoles[0] ?? OrderUserRole.ORDERS;

  await prisma.$transaction(async (tx) => {
    await tx.userServicePermission.deleteMany({ where: { userId } });
    if (sanitized.length > 0) {
      await tx.userServicePermission.createMany({
        data: sanitized.map((key) => ({ userId, serviceKey: key })),
      });
    }

    await tx.userRoleAssignment.deleteMany({ where: { userId } });
    if (prismaRoles.length > 0) {
      await tx.userRoleAssignment.createMany({
        data: prismaRoles.map((role) => ({ userId, role, assignedBy })),
      });
    }

    await tx.orderUser.update({
      where: { id: userId },
      data: {
        role: primaryRole,
      },
    });
  });

  return { serviceKeys: sanitized, roles: serviceRoles, prismaRoles };
}

export function mapServiceKeysToPrismaRoles(serviceKeys: ServiceKey[]): OrderUserRole[] {
  const serviceRoles = getRolesFromServiceKeys(serviceKeys);
  return serviceRoles.map((role) => serviceRoleToPrismaRole[role]);
}

export function mapPrismaRolesToServiceKeys(roles: OrderUserRole[]): ServiceKey[] {
  const serviceRoles = toServiceRoles(roles);
  return getDefaultServiceKeysForRoles(serviceRoles);
}
