import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';

type SallaQuantityResponse = {
  status: number;
  success: boolean;
  message?: string;
  data?: unknown;
};

export type IncrementSallaStockResult =
  | { ok: true; merchantId: string }
  | { ok: false; error: string };

// Bumps a Salla product/variant's live stock quantity. Shared by the warehouse
// bulk-quantity tool and delivery-note acceptance (dress production -> sellable stock).
export async function incrementSallaStock(
  identiferType: 'product_id' | 'variant_id',
  identifer: string | number,
  quantity: number,
  options?: { merchantId?: string | null; branch?: string }
): Promise<IncrementSallaStockResult> {
  if (!identifer || !Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'بيانات غير صالحة لتحديث كمية سلة' };
  }

  const resolved = await resolveSallaMerchantId(options?.merchantId ?? undefined);
  if (!resolved.merchantId) {
    return { ok: false, error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' };
  }

  const payload: Record<string, string | number> = {
    identifer_type: identiferType,
    identifer: typeof identifer === 'number' ? identifer.toString() : identifer,
    quantity,
    mode: 'increment',
  };
  if (options?.branch) {
    payload.branch = options.branch;
  }

  const response = await sallaMakeRequest<SallaQuantityResponse>(
    resolved.merchantId,
    '/products/quantities/bulk',
    {
      method: 'POST',
      body: JSON.stringify({ products: [payload] }),
    }
  );

  if (!response) {
    return { ok: false, error: 'تعذر التواصل مع واجهة سلة لتحديث الكمية' };
  }
  if (!response.success) {
    return {
      ok: false,
      error:
        typeof response.message === 'string' && response.message.trim().length > 0
          ? response.message
          : 'تعذر تحديث كمية المنتج في سلة',
    };
  }

  return { ok: true, merchantId: resolved.merchantId };
}
