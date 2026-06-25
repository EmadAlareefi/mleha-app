import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';

export const runtime = 'nodejs';

function hasProductSupplierAccess(session: any | null) {
  return hasServiceAccess(session, ['salla-products']);
}

function productSupplierTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

async function isProductSupplierSchemaReady() {
  try {
    await prisma.sallaProductSupplier.count();
    return true;
  } catch (error) {
    if (productSupplierTableMissing(error)) {
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

function parseProductIds(searchParams: URLSearchParams): string[] {
  const direct = searchParams.getAll('productId');
  const combined = searchParams.get('productIds');
  const ids = new Set<string>();

  const pushValue = (value: string | null) => {
    if (!value) return;
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => ids.add(part));
  };

  direct.forEach(pushValue);
  pushValue(combined);

  return Array.from(ids);
}

const SCHEMA_NOT_READY = {
  error: 'يرجى تشغيل `prisma db push` لإنشاء جدول موردي المنتجات.',
  missingProductSupplierTable: true,
};

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasProductSupplierAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى موردي المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const { searchParams } = request.nextUrl;
    const productIds = parseProductIds(searchParams);

    const rows = await prisma.sallaProductSupplier.findMany({
      where: productIds.length > 0 ? { productId: { in: productIds } } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: productIds.length > 0 ? undefined : 500,
      include: { supplier: { select: { id: true, name: true } } },
    });

    const productSuppliers = rows.map((row) => ({
      ...row,
      supplierName: row.supplier?.name ?? null,
    }));

    return NextResponse.json({ success: true, productSuppliers });
  } catch (error) {
    if (productSupplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    log.error('Failed to load product suppliers', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل موردي المنتجات' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasProductSupplierAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتحديث موردي المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const body = await request.json();
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const supplierId = typeof body?.supplierId === 'string' ? body.supplierId.trim() : '';
    const sku = typeof body?.sku === 'string' ? body.sku.trim() : undefined;
    const productName = typeof body?.productName === 'string' ? body.productName.trim() : undefined;
    const merchantId = typeof body?.merchantId === 'string' ? body.merchantId.trim() : undefined;
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : undefined;

    if (!productId) {
      return NextResponse.json({ error: 'معرّف المنتج مطلوب' }, { status: 400 });
    }

    if (!supplierId) {
      return NextResponse.json({ error: 'المورّد مطلوب' }, { status: 400 });
    }

    const supplierExists = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplierExists) {
      return NextResponse.json({ error: 'المورّد المحدد غير موجود' }, { status: 400 });
    }

    const actor = userIdentifier(session);

    const existingRecord = await prisma.sallaProductSupplier.findUnique({
      where: { productId },
    });

    const updateData: Prisma.SallaProductSupplierUpdateInput = {
      supplier: { connect: { id: supplierId } },
      updatedBy: actor,
    };

    if (sku !== undefined) {
      updateData.sku = sku || null;
    }
    if (productName !== undefined) {
      updateData.productName = productName || null;
    }
    if (merchantId !== undefined) {
      updateData.merchantId = merchantId || null;
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
    }

    const productSupplier = await prisma.sallaProductSupplier.upsert({
      where: { productId },
      create: {
        productId,
        supplier: { connect: { id: supplierId } },
        sku: sku || null,
        productName: productName || null,
        merchantId: merchantId || null,
        notes: notes || null,
        createdBy: actor,
        updatedBy: actor,
      },
      update: updateData,
      include: { supplier: { select: { id: true, name: true } } },
    });

    log.info('Product supplier saved', {
      productId,
      supplierId,
      actor,
      action: existingRecord ? 'update' : 'create',
    });

    return NextResponse.json({
      success: true,
      action: existingRecord ? 'updated' : 'created',
      productSupplier,
    });
  } catch (error) {
    if (productSupplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    log.error('Failed to save product supplier', { error });
    return NextResponse.json(
      { error: 'تعذر حفظ مورّد المنتج' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || (!hasProductSupplierAccess(session) && !isAdmin(session))) {
    return NextResponse.json(
      { error: 'غير مصرح لك بحذف موردي المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductSupplierSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }

    const body = await request.json();
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    if (!productId) {
      return NextResponse.json({ error: 'معرّف المنتج مطلوب للحذف' }, { status: 400 });
    }

    await prisma.sallaProductSupplier.delete({
      where: { productId },
    });

    log.info('Product supplier deleted', { productId, actor: userIdentifier(session) });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'لم يتم العثور على السجل المطلوب' }, { status: 404 });
    }
    if (productSupplierTableMissing(error)) {
      return NextResponse.json(SCHEMA_NOT_READY, { status: 503 });
    }
    log.error('Failed to delete product supplier', { error });
    return NextResponse.json(
      { error: 'تعذر حذف مورّد المنتج' },
      { status: 500 }
    );
  }
}
