import { prisma } from '@/lib/prisma';
import { OrderUserRole } from '@prisma/client';
import { log } from './logger';

/**
 * Get all roles assigned to a user
 */
export async function getUserRoles(userId: string): Promise<OrderUserRole[]> {
  const roleAssignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    select: { role: true },
  });

  // If no role assignments exist, fall back to legacy single role field
  if (roleAssignments.length === 0) {
    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    return user ? [user.role] : [];
  }

  return roleAssignments.map(ra => ra.role);
}

/**
 * Check if user has a specific role
 */
export async function userHasRole(
  userId: string,
  role: OrderUserRole | string
): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.some(r => r === role || r.toLowerCase() === role.toLowerCase());
}

/**
 * Check if user has any of the specified roles
 */
export async function userHasAnyRole(
  userId: string,
  roles: (OrderUserRole | string)[]
): Promise<boolean> {
  const userRoles = await getUserRoles(userId);
  return roles.some(role =>
    userRoles.some(
      ur => ur === role || ur.toLowerCase() === role.toLowerCase()
    )
  );
}

/**
 * Assign a role to a user (idempotent)
 */
export async function assignRole(
  userId: string,
  role: OrderUserRole,
  assignedBy?: string
): Promise<void> {
  try {
    await prisma.userRoleAssignment.create({
      data: {
        userId,
        role,
        assignedBy,
      },
    });
    log.info('Role assigned to user', { userId, role, assignedBy });
  } catch (error: any) {
    // Ignore unique constraint violations (role already assigned)
    if (error.code === 'P2002') {
      log.info('Role already assigned to user', { userId, role });
      return;
    }
    throw error;
  }
}

/**
 * Remove a role from a user
 */
export async function removeRole(
  userId: string,
  role: OrderUserRole
): Promise<void> {
  await prisma.userRoleAssignment.deleteMany({
    where: {
      userId,
      role,
    },
  });
  log.info('Role removed from user', { userId, role });
}

/**
 * Set exact roles for a user (replaces all existing roles)
 */
export async function setUserRoles(
  userId: string,
  roles: OrderUserRole[],
  assignedBy?: string
): Promise<void> {
  await prisma.$transaction(async tx => {
    // Remove all existing role assignments
    await tx.userRoleAssignment.deleteMany({
      where: { userId },
    });

    // Add new role assignments
    if (roles.length > 0) {
      await tx.userRoleAssignment.createMany({
        data: roles.map(role => ({
          userId,
          role,
          assignedBy,
        })),
      });
    }

    log.info('User roles updated', { userId, roles, assignedBy });
  });
}

/**
 * Migrate user from legacy single role to role assignments
 * This is idempotent and safe to run multiple times
 */
export async function migrateUserToRoleAssignments(
  userId: string
): Promise<void> {
  const user = await prisma.orderUser.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Check if migration already done
  const existingAssignments = await prisma.userRoleAssignment.count({
    where: { userId },
  });

  if (existingAssignments > 0) {
    log.info('User already has role assignments', { userId });
    return;
  }

  // Create role assignment from legacy role field
  await assignRole(userId, user.role, 'migration');
  log.info('Migrated user to role assignments', { userId, role: user.role });
}

/**
 * Bulk migrate all users from legacy roles to role assignments
 */
export async function migrateAllUsersToRoleAssignments(): Promise<number> {
  const users = await prisma.orderUser.findMany({
    where: {
      roleAssignments: {
        none: {}, // Only users without role assignments
      },
    },
    select: { id: true, role: true },
  });

  let migrated = 0;
  for (const user of users) {
    try {
      await assignRole(user.id, user.role, 'bulk-migration');
      migrated++;
    } catch (error) {
      log.error('Failed to migrate user', { userId: user.id, error });
    }
  }

  log.info('Bulk migration completed', { migrated, total: users.length });
  return migrated;
}

/**
 * Get role display names in Arabic
 */
export function getRoleDisplayName(role: OrderUserRole | string): string {
  const roleNames: Record<string, string> = {
    ORDERS: 'تحضير الطلبات',
    STORE_MANAGER: 'إدارة المرتجعات',
    WAREHOUSE: 'المستودع',
    ACCOUNTANT: 'المحاسبة',
    DELIVERY_AGENT: 'مناديب توصيل',
    admin: 'مدير النظام',
  };

  return roleNames[role] || role;
}

/**
 * Get role display names for an array of roles
 */
export function getRoleDisplayNames(roles: (OrderUserRole | string)[]): string {
  return roles.map(getRoleDisplayName).join(' + ');
}
