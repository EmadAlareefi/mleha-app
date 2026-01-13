import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { fulfillQuantityRequest } from '@/app/lib/salla-product-requests';

export const runtime = 'nodejs';

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول لتحديث الطلب' }, { status: 401 });
  }

  const { id } = context.params;
  if (!id) {
    return NextResponse.json({ error: 'رقم الطلب غير معروف' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new Error('تنسيق البيانات غير صالح');
    }
    const providedAmount = Number.parseInt(body.providedAmount, 10);
    const providedBy = typeof body.providedBy === 'string' ? body.providedBy.trim() : '';

    if (!Number.isFinite(providedAmount) || providedAmount <= 0) {
      throw new Error('الكمية الموفرة يجب أن تكون أكبر من صفر');
    }
    if (!providedBy) {
      throw new Error('يرجى إدخال اسم الشخص الذي وفر الكمية');
    }

    const updated = await fulfillQuantityRequest({
      id,
      providedAmount,
      providedBy,
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'تعذر تحديث الطلب' },
      { status: 400 }
    );
  }
}
