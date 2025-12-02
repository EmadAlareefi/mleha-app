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
 * GET /api/order-users
 * Get all order users
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى هذه الصفحة' },
      { status: 403 }
    );
  }

  try {
    const warehousesAvailable = await isWarehouseSchemaReady();
    const select: any = {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      orderType: true,
      specificStatus: true,
      isActive: true,
      autoAssign: true,
      maxOrders: true,
      createdAt: true,
      roleAssignments: {
        select: {
          role: true,
        },
      },
      assignments: {
        where: {
          status: {
            in: ['assigned', 'preparing'],
          },
        },
        select: {
          id: true,
        },
      },
    };

    if (warehousesAvailable) {
      select.warehouseAssignments = {
        include: {
          warehouse: true,
        },
      };
    }

    const users = await prisma.orderUser.findMany({
      select,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      warehousesSupported: warehousesAvailable,
      users: users.map((user: any) => {
        const { warehouseAssignments, assignments, role, roleAssignments, ...rest } = user;

        // Get roles array from roleAssignments, fallback to single role
        const rolesArray = roleAssignments && roleAssignments.length > 0
          ? roleAssignments.map((ra: any) => ra.role.toLowerCase())
          : [(role || OrderUserRole.ORDERS).toLowerCase()];

        return {
          ...rest,
          role: (role || OrderUserRole.ORDERS).toLowerCase(), // Primary role for backward compatibility
          roles: rolesArray, // Array of all roles
          _count: {
            assignments: assignments.length,
          },
          warehouses: warehousesAvailable
            ? serializeWarehouses(warehouseAssignments)
            : [],
        };
      }),
    });
  } catch (error) {
    log.error('Error fetching order users', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب المستخدمين' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/order-users
 * Create a new order user
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const {
      username,
      password,
      name,
      email,
      phone,
      orderType,
      specificStatus,
      autoAssign,
      maxOrders,
      role: roleInput,
      roles: rolesInput, // New: array of roles
      warehouseIds = [],
    } = body;

    // Validation
    if (!username || !password || !name || !orderType) {
      return NextResponse.json(
        { error: 'اسم المستخدم، كلمة المرور، الاسم، ونوع الطلب مطلوبة' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUser = await prisma.orderUser.findUnique({
      where: { username },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'اسم المستخدم موجود بالفعل' },
        { status: 400 }
      );
    }

    let prismaRole: OrderUserRole;
    try {
      prismaRole = normalizeRole(roleInput);
    } catch (roleError) {
      return NextResponse.json(
        { error: roleError instanceof Error ? roleError.message : 'دور المستخدم غير صالح' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    if (prismaRole === OrderUserRole.WAREHOUSE) {
      const schemaReady = await isWarehouseSchemaReady();
      if (!schemaReady) {
        return NextResponse.json(
          {
            error:
              'يجب تحديث قاعدة البيانات لدعم مستخدمي المستودعات. شغّل `prisma migrate deploy` ثم أعد المحاولة.',
            missingWarehousesTable: true,
          },
          { status: 503 }
        );
      }

      if (!Array.isArray(warehouseIds) || warehouseIds.length === 0) {
        return NextResponse.json(
          { error: 'يجب ربط مستخدم المستودع بمستودع واحد على الأقل' },
          { status: 400 }
        );
      }
    }

    // Create user
    const user = await prisma.orderUser.create({
      data: {
        username,
        password: hashedPassword,
        name,
        email,
        phone,
        role: prismaRole,
        orderType: prismaRole === OrderUserRole.ORDERS ? orderType : 'all',
        specificStatus:
          prismaRole === OrderUserRole.ORDERS && orderType === 'specific_status'
            ? specificStatus
            : null,
        autoAssign: prismaRole === OrderUserRole.ORDERS ? autoAssign !== false : false,
        maxOrders: prismaRole === OrderUserRole.ORDERS ? maxOrders || 50 : 50,
      },
    });

    // Handle multi-role assignments
    const rolesToAssign = rolesInput && Array.isArray(rolesInput) && rolesInput.length > 0
      ? rolesInput.map((r: string) => normalizeRole(r))
      : [prismaRole];

    // Create role assignments
    const { setUserRoles } = await import('@/app/lib/user-roles');
    await setUserRoles(user.id, rolesToAssign, username);

    let assignedWarehouses: Array<{
      id: string;
      name: string;
      code: string | null;
      location: string | null;
    }> = [];

    // Handle warehouse assignments if user has warehouse role
    if (rolesToAssign.includes(OrderUserRole.WAREHOUSE)) {
      const warehouseIdArray = Array.isArray(warehouseIds) ? warehouseIds : [];
      await syncWarehouseAssignments(user.id, warehouseIdArray);
      assignedWarehouses = await prisma.warehouse.findMany({
        where: { id: { in: warehouseIdArray } },
        select: {
          id: true,
          name: true,
          code: true,
          location: true,
        },
      });
    }

    log.info('Order user created', { userId: user.id, username, roles: rolesToAssign });

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
        warehouses: assignedWarehouses,
      },
    });
  } catch (error) {
    log.error('Error creating order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء المستخدم' },
      { status: 500 }
    );
  }
}
