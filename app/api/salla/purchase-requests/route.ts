import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  createPurchaseRequest,
  getManufacturerUserId,
  listManufacturerLinkedProductStats,
  listPurchaseRequests,
  type PurchaseRequestRecord,
  type PurchaseRequestStatus,
} from '@/app/lib/salla-purchase-requests';

export const runtime = 'nodejs';

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalDate(value: unknown, label: string): Date | undefined {
  const text = cleanString(value);
  if (!text) {
    return undefined;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} غير صحيح`);
  }
  return date;
}

function serializeRequest(request: PurchaseRequestRecord) {
  return request;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const allowedStatus: PurchaseRequestStatus | undefined =
    statusParam === 'requested' || statusParam === 'on_the_way' || statusParam === 'purchased'
      ? statusParam
      : undefined;

  const manufacturerUserId = await getManufacturerUserId((session.user as any)?.id);
  const [requests, manufacturerProducts] = await Promise.all([
    listPurchaseRequests({ status: allowedStatus }),
    manufacturerUserId ? listManufacturerLinkedProductStats(manufacturerUserId) : Promise.resolve(null),
  ]);

  return NextResponse.json({ success: true, requests, manufacturerProducts });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول لإرسال الطلب' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new Error('تنسيق البيانات غير صالح');
    }

    const productId = Number.parseInt(body.productId, 10);
    const quantity = Number.parseInt(body.quantity, 10);
    const productName = cleanString(body.productName) || '';
    const status: Extract<PurchaseRequestStatus, 'requested' | 'on_the_way'> =
      body.status === 'on_the_way' ? 'on_the_way' : 'requested';
    const expectedArrivalAt = parseOptionalDate(body.expectedArrivalAt, 'تاريخ الوصول المتوقع');

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('رقم المنتج غير صحيح');
    }
    if (!productName) {
      throw new Error('اسم المنتج مطلوب');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('الكمية يجب أن تكون أكبر من صفر');
    }
    if (status === 'on_the_way' && !expectedArrivalAt) {
      throw new Error('تاريخ الوصول المتوقع مطلوب لمنتجات قيد الشراء');
    }

    const rawVariantOptions = Array.isArray(body.variantOptions)
      ? body.variantOptions
          .map((option: unknown) => (typeof option === 'string' ? option.trim() : null))
          .filter((option: string | null): option is string => Boolean(option))
      : undefined;

    const record = await createPurchaseRequest({
      productId,
      productName,
      productSku: cleanString(body.productSku),
      productImageUrl:
        typeof body.productImageUrl === 'string' && body.productImageUrl.trim().length > 0
          ? body.productImageUrl.trim()
          : undefined,
      variantId: cleanString(body.variantId),
      variantName: cleanString(body.variantName),
      variantSku: cleanString(body.variantSku),
      variantBarcode: cleanString(body.variantBarcode),
      variantOptions: rawVariantOptions && rawVariantOptions.length > 0 ? rawVariantOptions : undefined,
      merchantId: cleanString(body.merchantId),
      quantity,
      status,
      expectedArrivalAt,
      notes: cleanString(body.notes),
      requestedBy: (session.user as any)?.name || session.user?.email || 'مستخدم',
      requestedByUser: (session.user as any)?.id || session.user?.email || null,
    });

    return NextResponse.json({ success: true, request: serializeRequest(record) });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'تعذر إنشاء الطلب',
      },
      { status: 400 }
    );
  }
}
