import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { verifyShippingInfoLink } from '@/app/lib/shipping-info/links';
import { submitShippingInfo } from '@/app/lib/shipping-info/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST { exp, sig, firstName, middleName, lastName, district, street,
 * buildingNumber, postalCode, addressLine2 }. Public: the signed link the
 * customer got on WhatsApp is the only credential.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ merchantId: string; orderId: string }> },
) {
  const { merchantId, orderId } = await context.params;
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400 });
  }

  const valid = verifyShippingInfoLink({
    merchantId,
    orderId,
    expiresAt: Number(body.exp),
    signature: typeof body.sig === 'string' ? body.sig : '',
  });
  if (!valid) return NextResponse.json({ ok: false, code: 'expired' }, { status: 403 });

  try {
    const result = await submitShippingInfo(merchantId, orderId, body);
    if (!result.ok) {
      const status = result.code === 'invalid' ? 422 : result.code === 'not_found' ? 404 : 409;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    log.error('Shipping info: submit failed', { orderId, error: error instanceof Error ? error.message : error });
    return NextResponse.json({ ok: false, code: 'error' }, { status: 500 });
  }
}
