import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  InvoicesAndRefundInvoicesError,
  refreshSallaInvoicesAndOrders,
  listInvoicesAndRefundInvoicesData,
  syncInvoicesAndRefundInvoicesItem,
} from '@/app/lib/invoices-and-refund-invoices';

export const dynamic = 'force-dynamic';

function ensureAccess(session: Awaited<ReturnType<typeof getServerSession>>) {
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['invoices-and-refund-invoices', 'invoice-refunds', 'order-reports'])) {
    return NextResponse.json({ error: 'لا تملك صلاحية للوصول' }, { status: 403 });
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const accessResponse = ensureAccess(session);
  if (accessResponse) {
    return accessResponse;
  }

  try {
    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate')?.trim() || undefined;
    const endDate = url.searchParams.get('endDate')?.trim() || undefined;
    const data = await listInvoicesAndRefundInvoicesData({
      startDate,
      endDate,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof InvoicesAndRefundInvoicesError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Failed to load invoices and refund invoices data', error);
    return NextResponse.json({ error: 'فشل في تحميل بيانات الفواتير والمرتجعات' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const accessResponse = ensureAccess(session);
  if (accessResponse) {
    return accessResponse;
  }

  try {
    const body = await request.json();
    const action = typeof body?.action === 'string' ? body.action.trim() : '';

    if (action === 'refresh-salla') {
      const summary = await refreshSallaInvoicesAndOrders({
        startDate:
          typeof body?.startDate === 'string' && body.startDate.trim()
            ? body.startDate.trim()
            : undefined,
        endDate:
          typeof body?.endDate === 'string' && body.endDate.trim()
            ? body.endDate.trim()
            : undefined,
      });

      return NextResponse.json({
        success: true,
        action: 'refresh-salla',
        summary,
      });
    }

    const queueType =
      body?.queueType === 'order'
        ? 'order'
        : body?.queueType === 'refund'
          ? 'refund'
          : null;

    if (!queueType) {
      return NextResponse.json({ error: 'نوع العملية غير صالح' }, { status: 400 });
    }

    const result =
      queueType === 'refund'
        ? await syncInvoicesAndRefundInvoicesItem({
            queueType,
            orderRecordId:
              typeof body?.orderRecordId === 'string' && body.orderRecordId.trim()
                ? body.orderRecordId.trim()
                : undefined,
            orderId:
              typeof body?.orderId === 'string' && body.orderId.trim()
                ? body.orderId.trim()
                : undefined,
            orderNumber:
              typeof body?.orderNumber === 'string' && body.orderNumber.trim()
                ? body.orderNumber.trim()
                : undefined,
            invoiceRecordId:
              typeof body?.invoiceRecordId === 'string' && body.invoiceRecordId.trim()
                ? body.invoiceRecordId.trim()
                : undefined,
          })
        : await syncInvoicesAndRefundInvoicesItem({
            queueType,
            id: typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : undefined,
            orderId:
              typeof body?.orderId === 'string' && body.orderId.trim()
                ? body.orderId.trim()
                : undefined,
            orderNumber:
              typeof body?.orderNumber === 'string' && body.orderNumber.trim()
                ? body.orderNumber.trim()
                : undefined,
          });

    return NextResponse.json({
      success: true,
      queueType: result.queueType,
      alreadyRecorded: result.alreadyRecorded,
      erpInvoiceId: result.erpInvoiceId,
      message: result.message,
      ...(result.queueType === 'refund'
        ? {
            orderId: result.orderId,
            orderNumber: result.orderNumber,
            invoiceId: result.invoiceId,
            invoiceNumber: result.invoiceNumber,
          }
        : {
            orderId: result.orderId,
            orderNumber: result.orderNumber,
          }),
    });
  } catch (error) {
    if (error instanceof InvoicesAndRefundInvoicesError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Failed to sync ERP queue item', error);
    return NextResponse.json({ error: 'فشل في تنفيذ عملية ERP' }, { status: 500 });
  }
}
