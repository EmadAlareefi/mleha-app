import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  createQuantityRequest,
  listQuantityRequests,
} from '@/app/lib/salla-product-requests';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

function parseProductIds(searchParams: URLSearchParams): number[] {
  const direct = searchParams.getAll('productId');
  const combined = searchParams.get('productIds');
  const ids = new Set<number>();

  const pushValue = (value: string | null) => {
    if (!value) return;
    value
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((num) => Number.isFinite(num) && num > 0)
      .forEach((num) => ids.add(num));
  };

  direct.forEach(pushValue);
  pushValue(combined);

  return Array.from(ids);
}

function sanitizeProductOptions(value: unknown): Prisma.InputJsonValue | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value
    .map((option) => {
      if (!option || typeof option !== 'object') {
        return null;
      }
      const record = option as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) {
        return null;
      }

      const id =
        typeof record.id === 'number' || typeof record.id === 'string'
          ? record.id
          : undefined;
      const sku = typeof record.sku === 'string' && record.sku.trim().length > 0
        ? record.sku.trim()
        : null;
      const barcode =
        typeof record.barcode === 'string' && record.barcode.trim().length > 0
          ? record.barcode.trim()
          : null;
      const availableQuantity =
        typeof record.availableQuantity === 'number' && Number.isFinite(record.availableQuantity)
          ? record.availableQuantity
          : null;

      return {
        id: id ?? null,
        name,
        sku,
        barcode,
        availableQuantity,
      };
    })
    .filter((option): option is {
      id: string | number | null;
      name: string;
      sku: string | null;
      barcode: string | null;
      availableQuantity: number | null;
    } => option !== null)
    .slice(0, 100);

  return options.length > 0 ? options : undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const productIds = parseProductIds(searchParams);
  const statusParam = searchParams.get('status');
  const allowedStatus = statusParam === 'pending' || statusParam === 'completed' ? statusParam : undefined;

  const requests = await listQuantityRequests({
    productIds: productIds.length > 0 ? productIds : undefined,
    status: allowedStatus,
  });

  return NextResponse.json({ success: true, requests });
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
    const requestedAmount = Number.parseInt(body.requestedAmount, 10);
    const requestedFromInput = typeof body.requestedFrom === 'string' ? body.requestedFrom.trim() : '';
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('رقم المنتج غير صحيح');
    }
    const hasRequestedAmount = Number.isFinite(requestedAmount) && requestedAmount > 0;
    const requestedFor =
      typeof body.requestedFor === 'string' && body.requestedFor.trim().length > 0
        ? body.requestedFor
        : undefined;

    const requestedRefundAmountRaw = body.requestedRefundAmount;
    const requestedRefundAmount =
      requestedRefundAmountRaw !== undefined && requestedRefundAmountRaw !== null && requestedRefundAmountRaw !== ''
        ? Number.parseInt(requestedRefundAmountRaw, 10)
        : undefined;
    const hasRequestedRefund =
      requestedRefundAmount !== undefined &&
      Number.isFinite(requestedRefundAmount) &&
      requestedRefundAmount > 0;

    if (!productName) {
      throw new Error('اسم المنتج مطلوب');
    }
    if (!hasRequestedAmount && !hasRequestedRefund) {
      throw new Error('يرجى إدخال كمية للشراء أو كمية مرتجع واحدة على الأقل');
    }
    if (
      requestedRefundAmount !== undefined &&
      (!Number.isFinite(requestedRefundAmount) || requestedRefundAmount <= 0)
    ) {
      throw new Error('كمية المرتجع يجب أن تكون أكبر من صفر');
    }

    const normalizedRequestedAmount = hasRequestedAmount ? requestedAmount : 0;
    const requestedFrom = requestedFromInput || 'غير محدد';

    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    const merchantId = typeof body.merchantId === 'string' ? body.merchantId : undefined;
    const productOptions = sanitizeProductOptions(body.productOptions);

    const requestRecord = await createQuantityRequest({
      productId,
      productName,
      productSku: typeof body.productSku === 'string' ? body.productSku : undefined,
      productImageUrl:
        typeof body.productImageUrl === 'string' && body.productImageUrl.trim().length > 0
          ? body.productImageUrl
          : undefined,
      merchantId,
      requestedAmount: normalizedRequestedAmount,
      requestedRefundAmount: hasRequestedRefund ? requestedRefundAmount : undefined,
      requestedFrom,
      productOptions,
      requestedBy: (session.user as any)?.name || session.user?.email || 'مستخدم',
      requestedByUser: (session.user as any)?.id || session.user?.email || null,
      requestedFor,
      notes,
    });

    return NextResponse.json({ success: true, request: requestRecord });
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
