import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { OrderUserRole } from '@prisma/client';

export const runtime = 'nodejs';

const ROLE_MAP: Record<string, OrderUserRole> = {
  orders: OrderUserRole.ORDERS,
  store_manager: OrderUserRole.STORE_MANAGER,
  warehouse: OrderUserRole.WAREHOUSE,
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

/**
 * GET /api/order-users
 * Get all order users
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى هذه الصفحة' },
      { status: 403 }
    );
  }

  try {
    const users = await prisma.orderUser.findMany({
      select: {
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
        _count: {
          select: {
            assignments: {
              where: {
                status: {
                  in: ['assigned', 'preparing'],
                },
              },
            },
          },
        },
        warehouseAssignments: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      users: users.map((user) => {
        const { warehouseAssignments, ...rest } = user;
        return {
          ...rest,
          role: user.role.toLowerCase(),
          warehouses: serializeWarehouses(warehouseAssignments),
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

    if (prismaRole === OrderUserRole.WAREHOUSE && (!Array.isArray(warehouseIds) || warehouseIds.length === 0)) {
      return NextResponse.json(
        { error: 'يجب ربط مستخدم المستودع بمستودع واحد على الأقل' },
        { status: 400 }
      );
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
        maxOrders: prismaRole === OrderUserRole.ORDERS ? maxOrders || 50 : 0,
      },
    });

    let assignedWarehouses: Array<{
      id: string;
      name: string;
      code: string | null;
      location: string | null;
    }> = [];

    if (prismaRole === OrderUserRole.WAREHOUSE) {
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

    log.info('Order user created', { userId: user.id, username });

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
