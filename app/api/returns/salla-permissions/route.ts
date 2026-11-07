import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getMerchantScopes, hasScope, TRANSACTIONS_SCOPE } from '@/app/lib/salla-transactions';
import { requireReturnsStaff } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';

const REQUIRED = [
  { scope: TRANSACTIONS_SCOPE, label: 'استرجاع المبالغ (المعاملات)' },
  { scope: 'products.read_write', label: 'إرجاع القطع للمخزون' },
  { scope: 'marketing.read_write', label: 'إنشاء كوبونات الاستبدال' },
  { scope: 'orders.read_write', label: 'تحديث حالة الطلب' },
];

/** GET /api/returns/salla-permissions — which processing scopes the Salla token lacks. */
export async function GET() {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const merchants = await prisma.sallaAuth.findMany({ select: { merchantId: true } });
  const result = await Promise.all(
    merchants.map(async ({ merchantId }) => {
      const scopes = await getMerchantScopes(merchantId);
      return {
        merchantId,
        known: scopes !== null,
        missing: scopes === null ? [] : REQUIRED.filter((r) => !hasScope(scopes, r.scope)),
      };
    }),
  );
  return NextResponse.json({ success: true, merchants: result });
}
