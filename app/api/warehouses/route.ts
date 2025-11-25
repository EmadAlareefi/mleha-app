import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى هذه البيانات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isWarehouseSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(
        {
          error:
            'جدول المستودعات غير متوفر بعد. يرجى تشغيل `prisma migrate deploy` لتفعيل ميزة المستودعات.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }

    const includeAll =
      request.nextUrl.searchParams.get('all') === 'true' ||
      request.nextUrl.searchParams.get('includeInactive') === 'true';

    const warehouses = await prisma.warehouse.findMany({
      where: includeAll ? undefined : { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        location: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      warehouses,
    });
  } catch (error) {
    if (isWarehouseSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            'جدول المستودعات غير متوفر بعد. يرجى تشغيل `prisma migrate deploy` لتفعيل ميزة المستودعات.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }
    log.error('Failed to load warehouses list', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل قائمة المستودعات' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isWarehouseSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(
        {
          error:
            'جدول المستودعات غير متوفر بعد. يرجى تشغيل `prisma migrate deploy` لتفعيل ميزة المستودعات.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const {
      name,
      code,
      location,
      description,
      isActive = true,
    }: {
      name?: string;
      code?: string | null;
      location?: string | null;
      description?: string | null;
      isActive?: boolean;
    } = body || {};

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'اسم المستودع مطلوب' },
        { status: 400 }
      );
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        name: name.trim(),
        code: code?.trim() || null,
        location: location?.trim() || null,
        description: description?.trim() || null,
        isActive: Boolean(isActive),
      },
    });

    log.info('Warehouse created', { warehouseId: warehouse.id, code: warehouse.code });

    return NextResponse.json({
      success: true,
      warehouse,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'رمز المستودع مستخدم بالفعل' },
        { status: 400 }
      );
    }
    if (isWarehouseSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            'جدول المستودعات غير متوفر بعد. يرجى تشغيل `prisma migrate deploy` لتفعيل ميزة المستودعات.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }
    log.error('Failed to create warehouse', { error });
    return NextResponse.json(
      { error: 'تعذر إنشاء المستودع' },
      { status: 500 }
    );
  }
}
