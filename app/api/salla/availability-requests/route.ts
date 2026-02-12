import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  createAvailabilityRequest,
  listAvailabilityRequests,
} from '@/app/lib/salla-availability-requests';

export const runtime = 'nodejs';

function parseProductIds(searchParams: URLSearchParams): number[] {
  const ids = new Set<number>();
  const pushValue = (value: string | null) => {
    if (!value) return;
    value
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((num) => Number.isFinite(num) && num > 0)
      .forEach((num) => ids.add(num));
  };

  pushValue(searchParams.get('productIds'));
  searchParams.getAll('productId').forEach(pushValue);
  return Array.from(ids);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const productIds = parseProductIds(searchParams);
  const statusParam = searchParams.get('status');
  const status =
    statusParam === 'pending' || statusParam === 'notified' || statusParam === 'cancelled'
      ? statusParam
      : undefined;

  const requests = await listAvailabilityRequests({
    productIds: productIds.length > 0 ? productIds : undefined,
    status,
  });

  return NextResponse.json({ success: true, requests });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new Error('تنسيق البيانات غير صالح');
    }

    const productId = Number.parseInt(body.productId, 10);
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';
    const phoneRaw = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '';

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('رقم المنتج غير صحيح');
    }

    if (!productName) {
      throw new Error('اسم المنتج مطلوب');
    }

    const phone = phoneRaw.replace(/\s+/g, '');
    if (!phone) {
      throw new Error('رقم الجوال مطلوب');
    }

    const requestRecord = await createAvailabilityRequest({
      productId,
      productName,
      productSku: typeof body.productSku === 'string' ? body.productSku : undefined,
      productImageUrl:
        typeof body.productImageUrl === 'string' && body.productImageUrl.length > 0
          ? body.productImageUrl
          : undefined,
      merchantId: typeof body.merchantId === 'string' ? body.merchantId : undefined,
      variationId:
        typeof body.variationId === 'string' || typeof body.variationId === 'number'
          ? body.variationId
          : undefined,
      variationName:
        typeof body.variationName === 'string' && body.variationName.trim().length > 0
          ? body.variationName.trim()
          : undefined,
      requestedSize:
        typeof body.requestedSize === 'string' && body.requestedSize.trim().length > 0
          ? body.requestedSize.trim()
          : undefined,
      customerFirstName:
        typeof body.customerFirstName === 'string' && body.customerFirstName.trim().length > 0
          ? body.customerFirstName.trim()
          : undefined,
      customerLastName:
        typeof body.customerLastName === 'string' && body.customerLastName.trim().length > 0
          ? body.customerLastName.trim()
          : undefined,
      customerEmail:
        typeof body.customerEmail === 'string' && body.customerEmail.trim().length > 0
          ? body.customerEmail.trim()
          : undefined,
      customerPhone: phone,
      notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : undefined,
      requestedBy: (session.user as any)?.name || session.user?.email || 'مستخدم',
      requestedByUser: (session.user as any)?.id || session.user?.email || null,
    });

    return NextResponse.json({ success: true, request: requestRecord });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'تعذر حفظ الطلب',
      },
      { status: 400 }
    );
  }
}
