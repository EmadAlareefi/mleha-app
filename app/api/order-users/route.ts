import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';
import {
  sanitizeServiceKeys,
  getRolesFromServiceKeys,
  ServiceKey,
} from '@/app/lib/service-definitions';
import {
  setUserServiceKeys,
  derivePrimaryRole,
} from '@/app/lib/user-services';
import { hasServiceAccess } from '@/app/lib/service-access';

export const runtime = 'nodejs';

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

type DateParseResult = Date | null | 'invalid';

function parseDateInput(value: unknown): DateParseResult {
  if (!value) {
    return null;
  }

  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) {
    return 'invalid';
  }

  return parsed;
}

type SalaryParseResult = Prisma.Decimal | null | 'invalid';

function parseSalaryInput(value: unknown): SalaryParseResult {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  try {
    return new Prisma.Decimal(value as any);
  } catch (error) {
    return 'invalid';
  }
}

/**
 * GET /api/order-users
 * Get all order users
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
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
      employmentStartDate: true,
      employmentEndDate: true,
      salaryAmount: true,
      salaryCurrency: true,
      role: true,
      orderType: true,
      specificStatus: true,
      isActive: true,
      autoAssign: true,
      maxOrders: true,
      createdAt: true,
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
      servicePermissions: {
        select: {
          serviceKey: true,
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
        const { warehouseAssignments, assignments, servicePermissions, ...rest } = user;

        const resolvedServiceKeys = (servicePermissions || []).map(
          (permission: any) => permission.serviceKey as ServiceKey
        );
        const derivedRoles = getRolesFromServiceKeys(resolvedServiceKeys);

        return {
          ...rest,
          roles: derivedRoles,
          serviceKeys: resolvedServiceKeys,
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
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
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
      autoAssign,
      warehouseIds = [],
      serviceKeys: serviceKeysInput,
      employmentStartDate,
      employmentEndDate,
      salaryAmount,
      salaryCurrency,
    } = body;

    // Validation
    if (!username || !password || !name) {
      return NextResponse.json(
        { error: 'اسم المستخدم، كلمة المرور، والاسم مطلوبة' },
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

    const serviceKeys = sanitizeServiceKeys(serviceKeysInput);

    if (serviceKeys.length === 0) {
      return NextResponse.json(
        { error: 'يجب اختيار رابط واحد على الأقل للمستخدم' },
        { status: 400 }
      );
    }

    const serviceRoles = getRolesFromServiceKeys(serviceKeys);
    const hasOrdersRole = serviceRoles.includes('orders');
    const hasWarehouseRole = serviceRoles.includes('warehouse');
    const primaryRole = derivePrimaryRole(serviceKeys);
    const shouldAutoAssign = hasOrdersRole ? Boolean(autoAssign) : false;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    if (hasWarehouseRole) {
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

    const parsedStartDate = parseDateInput(employmentStartDate);
    if (parsedStartDate === 'invalid') {
      return NextResponse.json(
        { error: 'صيغة تاريخ بداية العمل غير صالحة' },
        { status: 400 }
      );
    }

    const parsedEndDate = parseDateInput(employmentEndDate);
    if (parsedEndDate === 'invalid') {
      return NextResponse.json(
        { error: 'صيغة تاريخ نهاية العمل غير صالحة' },
        { status: 400 }
      );
    }

    if (parsedStartDate && parsedEndDate && parsedEndDate < parsedStartDate) {
      return NextResponse.json(
        { error: 'لا يمكن أن يكون تاريخ نهاية العمل أقدم من تاريخ البداية' },
        { status: 400 }
      );
    }

    const parsedSalaryAmount = parseSalaryInput(salaryAmount);
    if (parsedSalaryAmount === 'invalid') {
      return NextResponse.json(
        { error: 'صيغة الراتب غير صالحة' },
        { status: 400 }
      );
    }

    const normalizedSalaryCurrency =
      typeof salaryCurrency === 'string' && salaryCurrency.trim()
        ? salaryCurrency.trim()
        : null;

    // Create user
    const user = await prisma.orderUser.create({
      data: {
        username,
        password: hashedPassword,
        name,
        email,
        phone,
        employmentStartDate: parsedStartDate,
        employmentEndDate: parsedEndDate,
        salaryAmount: parsedSalaryAmount,
        salaryCurrency: normalizedSalaryCurrency,
        role: primaryRole,
        orderType: 'all',
        specificStatus: null,
        autoAssign: shouldAutoAssign,
        maxOrders: 0,
      },
    });

    await setUserServiceKeys(user.id, serviceKeys);

    let assignedWarehouses: Array<{
      id: string;
      name: string;
      code: string | null;
      location: string | null;
    }> = [];

    // Handle warehouse assignments if user has warehouse role
    if (hasWarehouseRole) {
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

    log.info('Order user created', { userId: user.id, username, serviceKeys });

    const derivedRoles = getRolesFromServiceKeys(serviceKeys);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        employmentStartDate: user.employmentStartDate,
        employmentEndDate: user.employmentEndDate,
        salaryAmount: user.salaryAmount ? user.salaryAmount.toString() : null,
        salaryCurrency: user.salaryCurrency,
        roles: derivedRoles,
        isActive: user.isActive,
        autoAssign: user.autoAssign,
        serviceKeys,
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
