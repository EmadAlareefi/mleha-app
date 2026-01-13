import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

type IncomingAdjustment = {
  identifer_type?: string;
  identifer?: string;
  quantity?: number;
  mode?: string;
  branch?: string;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول لتنفيذ هذا الطلب' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object' || !Array.isArray((body as any).products)) {
      return NextResponse.json(
        { error: 'يجب إرسال قائمة المنتجات المطلوب تعديل كمياتها' },
        { status: 400 }
      );
    }

    const requestedMerchant =
      typeof (body as any).merchantId === 'string' ? (body as any).merchantId : undefined;
    const resolved = await resolveSallaMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const allowedModes = new Set(['increment', 'decrement']);
    const sanitizedProducts = ((body as any).products as IncomingAdjustment[])
      .map((item) => {
        const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
        const mode = typeof item.mode === 'string' ? item.mode.toLowerCase() : undefined;
        const identifer =
          typeof item.identifer === 'string'
            ? item.identifer
            : typeof item.identifer === 'number'
              ? item.identifer.toString()
              : undefined;
        const identiferType =
          typeof item.identifer_type === 'string' ? item.identifer_type : 'variant_id';

        if (!identifer || !Number.isFinite(quantity) || quantity <= 0 || !mode || !allowedModes.has(mode)) {
          return null;
        }

        const payload: Record<string, string | number> = {
          identifer_type: identiferType,
          identifer,
          quantity,
          mode,
        };

        if (item.branch) {
          payload.branch = item.branch;
        }

        return payload;
      })
      .filter((item): item is Record<string, string | number> => item !== null);

    if (sanitizedProducts.length === 0) {
      return NextResponse.json(
        { error: 'يجب تحديد متغيرات صالحة مع كميات أكبر من صفر.' },
        { status: 400 }
      );
    }

    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      message?: string;
      data?: unknown;
    }>(resolved.merchantId, '/products/quantities/bulk', {
      method: 'POST',
      body: JSON.stringify({ products: sanitizedProducts }),
    });

    if (!response) {
      throw new Error('تعذر التواصل مع واجهة سلة لتحديث الكميات');
    }

    if (!response.success) {
      const message =
        typeof response.message === 'string' && response.message.trim().length > 0
          ? response.message
          : 'تعذر تحديث كميات المنتجات';
      throw new Error(message);
    }

    return NextResponse.json({
      success: true,
      data: response.data ?? null,
      merchantId: resolved.merchantId,
    });
  } catch (error) {
    log.error('Failed to update Salla product quantities', { error });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'حدث خطأ أثناء تحديث الكميات من سلة',
      },
      { status: 500 }
    );
  }
}
