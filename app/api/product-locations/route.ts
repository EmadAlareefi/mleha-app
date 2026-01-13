import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';

export const runtime = 'nodejs';

function hasWarehouseLocationAccess(session: any | null) {
  return hasServiceAccess(session, ['warehouse']);
}

function productLocationTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

async function isProductLocationSchemaReady() {
  try {
    await prisma.sallaProductLocation.count();
    return true;
  } catch (error) {
    if (productLocationTableMissing(error)) {
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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasWarehouseLocationAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى مواقع المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductLocationSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }

    const search = request.nextUrl.searchParams.get('q')?.trim();
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') || '150', 10);
    const take = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 500)
      : 150;

    const where = search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' as const } },
            { productName: { contains: search, mode: 'insensitive' as const } },
            { location: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const productLocations = await prisma.sallaProductLocation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
    });

    return NextResponse.json({ success: true, productLocations });
  } catch (error) {
    if (productLocationTableMissing(error)) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }

    log.error('Failed to load product locations', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل مواقع المنتجات' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasWarehouseLocationAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتحديث مواقع المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductLocationSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const skuInput = typeof body?.sku === 'string' ? body.sku.trim() : '';
    const locationInput = typeof body?.location === 'string' ? body.location.trim() : '';
    const productName = typeof body?.productName === 'string' ? body.productName.trim() : undefined;
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : undefined;
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : undefined;

    if (!skuInput) {
      return NextResponse.json({ error: 'رمز SKU مطلوب' }, { status: 400 });
    }

    if (!locationInput) {
      return NextResponse.json({ error: 'موقع التخزين مطلوب' }, { status: 400 });
    }

    const sku = skuInput.toUpperCase();
    const location = locationInput.toUpperCase();
    const actor = userIdentifier(session);

    const existingRecord = await prisma.sallaProductLocation.findUnique({
      where: { sku },
    });

    const updateData: Prisma.SallaProductLocationUpdateInput = {
      location,
      updatedBy: actor,
    };

    if (productName !== undefined) {
      updateData.productName = productName || null;
    }
    if (productId !== undefined) {
      updateData.productId = productId || null;
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
    }

    const productLocation = await prisma.sallaProductLocation.upsert({
      where: { sku },
      create: {
        sku,
        location,
        productName: productName || null,
        productId: productId || null,
        notes: notes || null,
        createdBy: actor,
        updatedBy: actor,
      },
      update: updateData,
    });

    log.info('Warehouse location saved', { sku, location, actor, action: existingRecord ? 'update' : 'create' });

    return NextResponse.json({
      success: true,
      action: existingRecord ? 'updated' : 'created',
      productLocation,
    });
  } catch (error) {
    if (productLocationTableMissing(error)) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }

    log.error('Failed to save product location', { error });
    return NextResponse.json(
      { error: 'تعذر حفظ موقع المنتج' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !isAdmin(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بحذف مواقع المنتجات' },
      { status: 403 }
    );
  }

  try {
    const schemaReady = await isProductLocationSchemaReady();
    if (!schemaReady) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const skuInput = typeof body?.sku === 'string' ? body.sku.trim() : '';
    if (!skuInput) {
      return NextResponse.json({ error: 'رمز SKU مطلوب للحذف' }, { status: 400 });
    }

    const sku = skuInput.toUpperCase();
    await prisma.sallaProductLocation.delete({
      where: { sku },
    });

    log.info('Warehouse location deleted', { sku, actor: userIdentifier(session) });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'لم يتم العثور على السجل المطلوب' }, { status: 404 });
    }
    if (productLocationTableMissing(error)) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل `prisma migrate deploy` لإنشاء جدول مواقع المنتجات.',
          missingProductLocationTable: true,
        },
        { status: 503 }
      );
    }
    log.error('Failed to delete product location', { error });
    return NextResponse.json(
      { error: 'تعذر حذف موقع المنتج' },
      { status: 500 }
    );
  }
}
