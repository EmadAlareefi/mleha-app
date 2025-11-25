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

async function ensureSchemaReady() {
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const ready = await ensureSchemaReady();
    if (!ready) {
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
    const { name, code, location, description, isActive } = body || {};

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'اسم المستودع مطلوب' },
        { status: 400 }
      );
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        name: name.trim(),
        code: code?.trim() || null,
        location: location?.trim() || null,
        description: description?.trim() || null,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
    });

    log.info('Warehouse updated', { warehouseId: warehouse.id });

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
    log.error('Failed to update warehouse', { error, warehouseId: id });
    return NextResponse.json(
      { error: 'تعذر تحديث المستودع' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const ready = await ensureSchemaReady();
    if (!ready) {
      return NextResponse.json(
        {
          error:
            'جدول المستودعات غير متوفر بعد. يرجى تشغيل `prisma migrate deploy` لتفعيل ميزة المستودعات.',
          missingWarehousesTable: true,
        },
        { status: 503 }
      );
    }

    await prisma.warehouse.delete({
      where: { id },
    });

    log.info('Warehouse deleted', { warehouseId: id });

    return NextResponse.json({
      success: true,
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
    log.error('Failed to delete warehouse', { error, warehouseId: id });
    return NextResponse.json(
      { error: 'تعذر حذف المستودع' },
      { status: 500 }
    );
  }
}
