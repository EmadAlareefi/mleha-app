import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { printCommercialInvoiceIfInternational } from '@/app/lib/international-printing';
import { hasServiceAccess } from '@/app/lib/service-access';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'غير مصرح لك' }, { status: 401 });
    }

    const user = session.user as any;

    if (!hasServiceAccess(session, 'order-invoice-search')) {
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية طباعة الفواتير' }, { status: 403 });
    }

    const body = await request.json();
    const {
      orderId,
      orderNumber,
      merchantId,
      forceInternational,
      shippingCountry,
      allowDomestic = true,
    } = body || {};

    if (!orderId && !orderNumber) {
      return NextResponse.json(
        { success: false, error: 'رقم الطلب أو الرقم المرجعي مطلوب لطباعة الفاتورة' },
        { status: 400 }
      );
    }

    const result = await printCommercialInvoiceIfInternational({
      orderId,
      orderNumber,
      merchantId,
      triggeredBy: user.username || user.id,
      source: 'admin-invoice-search',
      forceInternational: Boolean(forceInternational),
      fallbackCountry: shippingCountry,
      allowDomestic,
    });

    if (!result.isInternational) {
      return NextResponse.json(
        {
          success: false,
          error: result.message || 'الطلب محلي ولا يحتاج إلى فاتورة تجارية',
          country: result.country,
        },
        { status: 400 }
      );
    }

    if (!result.printed) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'فشل إرسال الفاتورة للطابعة',
          country: result.country,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message || 'تم إرسال الفاتورة التجارية للطابعة',
      data: {
        jobId: result.jobId ?? null,
        country: result.country,
      },
    });
  } catch (error) {
    console.error('Failed to print invoice via PrintNode:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء إرسال الفاتورة للطابعة' },
      { status: 500 }
    );
  }
}
