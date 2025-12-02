import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { OrderUserRole, Prisma } from '@prisma/client';

export const runtime = 'nodejs';

const ROLE_MAP: Record<string, OrderUserRole> = {
  orders: OrderUserRole.ORDERS,
  store_manager: OrderUserRole.STORE_MANAGER,
  warehouse: OrderUserRole.WAREHOUSE,
  accountant: OrderUserRole.ACCOUNTANT,
};

function normalizeRole(role?: string | null): OrderUserRole {
  if (!role) return OrderUserRole.ORDERS;
  const normalized = role.toLowerCase();
  if (!ROLE_MAP[normalized]) {
    throw new Error('دور المستخدم غير صالح');
  }
  return ROLE_MAP[normalized];
}

function serializeWarehouses(assignments: any[]) {
  return assignments
    .map((assignment) => assignment?.warehouse)
    .filter(Boolean)
    .map((warehouse: any) => ({
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
      location: warehouse.location,
    }));
}

async function syncWarehouseAssignments(userId: string, warehouseIds: string[]) {
  await prisma.warehouseAssignment.deleteMany({
    where: {
      userId,
      warehouseId: {
        notIn: warehouseIds,
      },
    },
  });

  const existing = await prisma.warehouseAssignment.findMany({
    where: { userId },
    select: { warehouseId: true },
  });
  const existingIds = new Set(existing.map((assignment) => assignment.warehouseId));

  for (const warehouseId of warehouseIds) {
    if (!existingIds.has(warehouseId)) {
      await prisma.warehouseAssignment.create({
        data: {
          userId,
          warehouseId,
        },
      });
    }
  }
}

function isWarehouseSchemaMissing(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021'
  );
}

async function isWarehouseSchemaReady() {
  try {
    await prisma.warehouse.count();
    return true;
  } catch (error) {
    if (isWarehouseSchemaMissing(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * PUT /api/order-users/[id]
 * Update an order user
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتحديث المستخدمين' },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const {
      username,
      name,
      email,
      phone,
      orderType,
      specificStatus,
      isActive,
      autoAssign,
      maxOrders,
      password,
      role: roleInput,
      roles: rolesInput, // New: array of roles
      warehouseIds = [],
    } = body;

    let prismaRole: OrderUserRole | undefined;
    if (roleInput) {
      try {
        prismaRole = normalizeRole(roleInput);
      } catch (roleError) {
        return NextResponse.json(
          { error: roleError instanceof Error ? roleError.message : 'دور المستخدم غير صالح' },
          { status: 400 }
        );
      }
    }

    const effectiveRole = prismaRole ?? undefined;

    // Check if username is being changed and validate uniqueness
    if (username) {
      const currentUser = await prisma.orderUser.findUnique({
        where: { id },
        select: { username: true },
      });

      if (currentUser && username !== currentUser.username) {
        // Username is being changed, check if new username is already taken
        const existingUser = await prisma.orderUser.findUnique({
          where: { username },
        });

        if (existingUser) {
          return NextResponse.json(
            { error: 'اسم المستخدم موجود بالفعل. الرجاء اختيار اسم مستخدم آخر.' },
            { status: 400 }
          );
        }
      }
    }

    const updateData: any = {
      name,
      email,
      phone,
      isActive,
    };

    // Add username to update data if provided
    if (username) {
      updateData.username = username;
    }

    const finalRole = effectiveRole || undefined;
    if (finalRole) {
      updateData.role = finalRole;
    }

    const roleToUse = finalRole || (await prisma.orderUser.findUnique({
      where: { id },
      select: { role: true },
    }))?.role || OrderUserRole.ORDERS;

    if (roleToUse === OrderUserRole.ORDERS) {
      updateData.orderType = orderType;
      updateData.specificStatus =
        orderType === 'specific_status' ? specificStatus : null;
      updateData.autoAssign = autoAssign;
      updateData.maxOrders = maxOrders;
    } else {
      updateData.orderType = 'all';
      updateData.specificStatus = null;
      updateData.autoAssign = false;
      updateData.maxOrders = 0;
    }

    // Only update password if provided
    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const warehousesAvailable = await isWarehouseSchemaReady();
    if (roleToUse === OrderUserRole.WAREHOUSE && !warehousesAvailable) {
      return NextResponse.json(
        {
          error:
            'لا يمكن تحديث مستخدم المستودع قبل تطبيق مخطط المستودعات. يرجى تشغيل `prisma migrate deploy` أولاً.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }

    const updateArgs: any = {
      where: { id },
      data: updateData,
    };

    if (warehousesAvailable) {
      updateArgs.include = {
        warehouseAssignments: {
          include: { warehouse: true },
        },
      };
    }

    const user = await prisma.orderUser.update(updateArgs);

    // Handle multi-role assignments
    if (rolesInput && Array.isArray(rolesInput) && rolesInput.length > 0) {
      const rolesToAssign = rolesInput.map((r: string) => normalizeRole(r));
      const { setUserRoles } = await import('@/app/lib/user-roles');
      await setUserRoles(user.id, rolesToAssign, (session.user as any)?.username || 'admin');
    }

    let warehouses = warehousesAvailable && (user as any).warehouseAssignments
      ? serializeWarehouses((user as any).warehouseAssignments)
      : [];

    // Check if user has warehouse role from roles array
    const hasWarehouseRole = rolesInput && Array.isArray(rolesInput)
      ? rolesInput.some((r: string) => normalizeRole(r) === OrderUserRole.WAREHOUSE)
      : roleToUse === OrderUserRole.WAREHOUSE;

    if (hasWarehouseRole) {
      const ids = Array.isArray(warehouseIds) ? warehouseIds : [];
      if (ids.length === 0) {
        return NextResponse.json(
          { error: 'يجب ربط مستخدم المستودع بمستودع واحد على الأقل' },
          { status: 400 }
        );
      }
      await syncWarehouseAssignments(user.id, ids);
      warehouses = await prisma.warehouse.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          code: true,
          location: true,
        },
      });
    } else if (warehousesAvailable) {
      await syncWarehouseAssignments(user.id, []);
      warehouses = [];
    }

    log.info('Order user updated', { userId: user.id, username: user.username });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role.toLowerCase(),
        orderType: user.orderType,
        specificStatus: user.specificStatus,
        isActive: user.isActive,
        autoAssign: user.autoAssign,
        maxOrders: user.maxOrders,
        warehouses,
      },
    });
  } catch (error) {
    log.error('Error updating order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث المستخدم' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/order-users/[id]
 * Delete an order user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بحذف المستخدمين' },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    await prisma.orderUser.delete({
      where: { id },
    });

    log.info('Order user deleted', { userId: id });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    log.error('Error deleting order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء حذف المستخدم' },
      { status: 500 }
    );
  }
}
