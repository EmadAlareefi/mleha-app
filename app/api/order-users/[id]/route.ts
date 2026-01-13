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
 * PUT /api/order-users/[id]
 * Update an order user
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
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
      isActive,
      autoAssign,
      password,
      warehouseIds = [],
      serviceKeys: serviceKeysInput,
      employmentStartDate,
      employmentEndDate,
      salaryAmount,
      salaryCurrency,
    } = body;

    const userRecord = await prisma.orderUser.findUnique({
      where: { id },
      select: {
        username: true,
      },
    });

    if (!userRecord) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Check if username is being changed and validate uniqueness
    if (username && username !== userRecord.username) {
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

    const currentServicePermissions = await prisma.userServicePermission.findMany({
      where: { userId: id },
      select: { serviceKey: true },
    });

    const rawServiceKeys = Array.isArray(serviceKeysInput) ? serviceKeysInput : undefined;
    let serviceKeys = sanitizeServiceKeys(rawServiceKeys);

    if (!rawServiceKeys || rawServiceKeys.length === 0) {
      serviceKeys = currentServicePermissions.map(
        (permission) => permission.serviceKey as ServiceKey
      );
    }

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

    const warehousesAvailable = await isWarehouseSchemaReady();
    if (hasWarehouseRole && !warehousesAvailable) {
      return NextResponse.json(
        {
          error:
            'لا يمكن تحديث مستخدم المستودع قبل تطبيق مخطط المستودعات. يرجى تشغيل `prisma migrate deploy` أولاً.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
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

    const updateData: any = {
      name,
      email,
      phone,
      isActive,
      employmentStartDate: parsedStartDate,
      employmentEndDate: parsedEndDate,
      salaryAmount: parsedSalaryAmount,
      salaryCurrency: normalizedSalaryCurrency,
      orderType: 'all',
      specificStatus: null,
      autoAssign: shouldAutoAssign,
      maxOrders: 0,
    };

    // Add username to update data if provided
    if (username) {
      updateData.username = username;
    }

    // Only update password if provided
    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updateArgs: any = {
      where: { id },
      data: {
        ...updateData,
        role: primaryRole,
      },
    };

    if (warehousesAvailable) {
      updateArgs.include = {
        warehouseAssignments: {
          include: { warehouse: true },
        },
      };
    }

    const user = await prisma.orderUser.update(updateArgs);

    await setUserServiceKeys(user.id, serviceKeys);

    let warehouses = warehousesAvailable && (user as any).warehouseAssignments
      ? serializeWarehouses((user as any).warehouseAssignments)
      : [];

    // Check if user has warehouse role from roles array
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
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
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
