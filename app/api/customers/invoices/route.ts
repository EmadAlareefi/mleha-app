import { NextRequest, NextResponse } from 'next/server';
import { getInvoicesByCustomerPhone } from '@/app/lib/salla-api';
import { normalizeKSA } from '@/app/lib/phone';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/customers/invoices?phone=+966501234567[&merchantId=XXX]
 *
 * Looks up a customer's Salla invoices by phone number. Finds the customer's
 * orders by phone, then fetches the invoices for each order (live from Salla).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const merchantId =
      searchParams.get('merchantId') || process.env.SALLA_DEFAULT_MERCHANT_ID;

    if (!merchantId) {
      return NextResponse.json(
        { error: 'معرف التاجر مطلوب' },
        { status: 400 }
      );
    }

    if (!phone) {
      return NextResponse.json(
        { error: 'رقم الجوال مطلوب' },
        { status: 400 }
      );
    }

    const normalized = normalizeKSA(phone) || phone;

    log.info('Looking up invoices by customer phone', { merchantId, phone: normalized });

    const invoices = await getInvoicesByCustomerPhone(merchantId, phone);

    if (invoices.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على فواتير لهذا العميل' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      phone: normalized,
      count: invoices.length,
      invoices,
    });
  } catch (error) {
    log.error('Error in customer invoices lookup', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء البحث عن الفواتير' },
      { status: 500 }
    );
  }
}
