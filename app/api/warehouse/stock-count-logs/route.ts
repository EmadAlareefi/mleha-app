import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const ALLOWED_SERVICES: ServiceKey[] = [
  'warehouse',
  'warehouse-locations',
  'order-prep',
  'search-update-stock',
];

function stockCountLogTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !hasServiceAccess(session, ALLOWED_SERVICES)) {
    return NextResponse.json({ error: 'ليس لديك صلاحية لعرض سجل الجرد' }, { status: 403 });
  }

  try {
    const search = request.nextUrl.searchParams.get('q')?.trim() || '';
    const productId = request.nextUrl.searchParams.get('productId')?.trim() || '';
    const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
    const take = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 50;

    const where: Prisma.WarehouseStockCountLogWhereInput = {};
    if (productId) where.productId = productId;
    if (search) {
      where.OR = [
        { productName: { contains: search, mode: 'insensitive' } },
        { productSku: { contains: search, mode: 'insensitive' } },
        { variantName: { contains: search, mode: 'insensitive' } },
        { variantSku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { createdByName: { contains: search, mode: 'insensitive' } },
        { createdByUsername: { contains: search, mode: 'insensitive' } },
      ];
    }

    const logs = await prisma.warehouseStockCountLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });

    return NextResponse.json({ success: true, logs });
  } catch (error) {
    if (stockCountLogTableMissing(error)) {
      return NextResponse.json(
        {
          error: 'يرجى تشغيل prisma migrate deploy لإنشاء جدول سجل الجرد.',
          missingStockCountLogTable: true,
        },
        { status: 503 }
      );
    }
    log.error('Failed to load warehouse stock count logs', { error });
    return NextResponse.json({ error: 'تعذر تحميل سجل الجرد' }, { status: 500 });
  }
}
