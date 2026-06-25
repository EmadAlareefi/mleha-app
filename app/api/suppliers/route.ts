import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';

export const runtime = 'nodejs';

function hasSupplierAccess(session: any | null) {
  return hasServiceAccess(session, ['salla-products']);
}

function supplierTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

async function isSupplierSchemaReady() {
  try {
    await prisma.supplier.count();
    return true;
  } catch (error) {
    if (supplierTableMissing(error)) {
      return false;
    }
    throw error;
  }
}

function userIdentifier(session: any | null) {
  if (!session?.user) {
    return 'unknown-user';
  }
  const user = session.user as any;
  return user.username || user.name || user.email || user.id || 'unknown-user';
}

function isAdmin(session: any | null) {
  if (!session?.user) {
    return false;
  }
  const primaryRole = (session.user as any)?.role as string | undefined;
  if (primaryRole === 'admin') {
    return true;
  }
  const roles = ((session.user as any)?.roles as string[]) || [];
  return roles.includes('admin');
}

const SCHEMA_NOT_READY = {
  error: 'يرجى تشغيل `prisma db push` لإنشاء جدول الموردين.',
  missingSupplierTable: true,
};

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !hasSupplierAccess(session)) {
    return NextResponse.json({ error: 'غير مصرح لك بالوصول إلى الموردين' }, { status: 403 });
  }

  try {
    const schemaReady = await isSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const suppliers = await prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ success: true, suppliers });
  } catch (error) {
    if (supplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }
    log.error('Failed to load suppliers', { error });
    return NextResponse.json({ error: 'تعذر تحميل الموردين' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasSupplierAccess(session)) {
    return NextResponse.json({ error: 'غير مصرح لك بإضافة الموردين' }, { status: 403 });
  }

  try {
    const schemaReady = await isSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : undefined;

    if (!name) {
      return NextResponse.json({ error: 'اسم المورّد مطلوب' }, { status: 400 });
    }

    const actor = userIdentifier(session);

    // Create-or-return: case-insensitive match prevents near-duplicate names.
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      if (!existing.isActive) {
        const reactivated = await prisma.supplier.update({
          where: { id: existing.id },
          data: { isActive: true, updatedBy: actor },
        });
        return NextResponse.json({ success: true, action: 'reactivated', supplier: reactivated });
      }
      return NextResponse.json({ success: true, action: 'existing', supplier: existing });
    }

    const supplier = await prisma.supplier.create({
      data: {
        name,
        notes: notes || null,
        createdBy: actor,
        updatedBy: actor,
      },
    });

    log.info('Supplier created', { name, actor });
    return NextResponse.json({ success: true, action: 'created', supplier });
  } catch (error) {
    if (supplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }
    log.error('Failed to create supplier', { error });
    return NextResponse.json({ error: 'تعذر إضافة المورّد' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasSupplierAccess(session)) {
    return NextResponse.json({ error: 'غير مصرح لك بتعديل الموردين' }, { status: 403 });
  }

  try {
    const schemaReady = await isSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const body = await request.json();
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'معرّف المورّد مطلوب' }, { status: 400 });
    }

    const data: Prisma.SupplierUpdateInput = { updatedBy: userIdentifier(session) };
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'اسم المورّد مطلوب' }, { status: 400 });
      }
      data.name = name;
    }
    if (typeof body?.isActive === 'boolean') {
      data.isActive = body.isActive;
    }
    if (typeof body?.notes === 'string') {
      data.notes = body.notes.trim() || null;
    }

    const supplier = await prisma.supplier.update({ where: { id }, data });
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'يوجد مورّد بهذا الاسم بالفعل' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'لم يتم العثور على المورّد' }, { status: 404 });
    }
    if (supplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }
    log.error('Failed to update supplier', { error });
    return NextResponse.json({ error: 'تعذر تعديل المورّد' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || (!hasSupplierAccess(session) && !isAdmin(session))) {
    return NextResponse.json({ error: 'غير مصرح لك بحذف الموردين' }, { status: 403 });
  }

  try {
    const schemaReady = await isSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const body = await request.json();
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'معرّف المورّد مطلوب للحذف' }, { status: 400 });
    }

    const linkedCount = await prisma.sallaProductSupplier.count({ where: { supplierId: id } });
    if (linkedCount > 0) {
      // Don't break product links; deactivate instead so it drops out of the picker.
      const supplier = await prisma.supplier.update({
        where: { id },
        data: { isActive: false, updatedBy: userIdentifier(session) },
      });
      return NextResponse.json({ success: true, action: 'deactivated', linkedCount, supplier });
    }

    await prisma.supplier.delete({ where: { id } });
    log.info('Supplier deleted', { id, actor: userIdentifier(session) });
    return NextResponse.json({ success: true, action: 'deleted' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'لم يتم العثور على المورّد' }, { status: 404 });
    }
    if (supplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }
    log.error('Failed to delete supplier', { error });
    return NextResponse.json({ error: 'تعذر حذف المورّد' }, { status: 500 });
  }
}
