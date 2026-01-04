import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const ORDER_PREP_LOCATION_ROLES = new Set(['admin', 'warehouse', 'orders']);

function userHasLocationAccess(session: any | null) {
  if (!session?.user) return false;
  const primaryRole = (session.user as any)?.role as string | undefined;
  const roles =
    ((session.user as any)?.roles as string[]) || (primaryRole ? [primaryRole] : []);
  return roles.some((role) => ORDER_PREP_LOCATION_ROLES.has(role));
}

function normalizeSku(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  return trimmed ? trimmed.toUpperCase() : '';
}

function productLocationTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !userHasLocationAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بعرض مواقع المنتجات' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const skuInputs: unknown[] = Array.isArray(body?.skus) ? body.skus : [];
    const normalizedSkus = Array.from(
      new Set(
        skuInputs
          .map((sku: unknown) => normalizeSku(sku))
          .filter((sku): sku is string => Boolean(sku))
      )
    );

    if (normalizedSkus.length === 0) {
      return NextResponse.json({ success: true, locations: [] });
    }

    if (normalizedSkus.length > 50) {
      return NextResponse.json(
        { error: 'عدد رموز SKU يتجاوز الحد المسموح (50)' },
        { status: 400 }
      );
    }

    const locations = await prisma.sallaProductLocation.findMany({
      where: { sku: { in: normalizedSkus } },
    });

    return NextResponse.json({ success: true, locations });
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

    log.error('Failed to load order prep product locations', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل مواقع المنتجات' },
      { status: 500 }
    );
  }
}
