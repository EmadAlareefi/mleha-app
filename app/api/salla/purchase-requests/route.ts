import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  createPurchaseRequest,
  listPurchaseRequests,
  type PurchaseRequestStatus,
} from '@/app/lib/salla-purchase-requests';

export const runtime = 'nodejs';

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

  const requests = await listPurchaseRequests({ status: allowedStatus });

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
    const quantity = Number.parseInt(body.quantity, 10);
    const productName = typeof body.productName === 'string' ? body.productName.trim() : '';

    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error('رقم المنتج غير صحيح');
    }
    if (!productName) {
      throw new Error('اسم المنتج مطلوب');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('الكمية يجب أن تكون أكبر من صفر');
    }

    const record = await createPurchaseRequest({
      productId,
      productName,
      productSku: typeof body.productSku === 'string' ? body.productSku : undefined,
      productImageUrl:
        typeof body.productImageUrl === 'string' && body.productImageUrl.trim().length > 0
          ? body.productImageUrl
          : undefined,
      merchantId: typeof body.merchantId === 'string' ? body.merchantId : undefined,
      quantity,
      notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : undefined,
      requestedBy: (session.user as any)?.name || session.user?.email || 'مستخدم',
      requestedByUser: (session.user as any)?.id || session.user?.email || null,
    });

    return NextResponse.json({ success: true, request: record });
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
