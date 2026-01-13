import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  createQuantityRequest,
  listQuantityRequests,
} from '@/app/lib/salla-product-requests';

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
    const requestedFrom = typeof body.requestedFrom === 'string' ? body.requestedFrom.trim() : '';
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('رقم المنتج غير صحيح');
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new Error('الكمية المطلوبة يجب أن تكون أكبر من صفر');
    }
    if (!requestedFrom) {
      throw new Error('يرجى تحديد الشخص المطلوب منه');
    }
    if (!productName) {
      throw new Error('اسم المنتج مطلوب');
    }

    const requestedFor =
      typeof body.requestedFor === 'string' && body.requestedFor.trim().length > 0
        ? body.requestedFor
        : undefined;

    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    const merchantId = typeof body.merchantId === 'string' ? body.merchantId : undefined;

    const requestRecord = await createQuantityRequest({
      productId,
      productName,
      productSku: typeof body.productSku === 'string' ? body.productSku : undefined,
      merchantId,
      requestedAmount,
      requestedFrom,
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
