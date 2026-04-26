import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  InvoiceRefundError,
  listInvoiceRefundWorkbookRows,
  refundInvoiceWorkbookRow,
} from '@/app/lib/invoice-refunds';

export const dynamic = 'force-dynamic';

function ensureAccess(session: Awaited<ReturnType<typeof getServerSession>>) {
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, 'invoice-refunds')) {
    return NextResponse.json({ error: 'لا تملك صلاحية للوصول' }, { status: 403 });
  }

  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const accessResponse = ensureAccess(session);
  if (accessResponse) {
    return accessResponse;
  }

  try {
    const data = await listInvoiceRefundWorkbookRows();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof InvoiceRefundError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Failed to load invoice refunds workbook', error);
    return NextResponse.json({ error: 'فشل في تحميل ملف المرتجعات' }, { status: 500 });
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
    const rowNumber = Number(body?.rowNumber);
    const sheetName =
      typeof body?.sheetName === 'string' && body.sheetName.trim()
        ? body.sheetName.trim()
        : undefined;

    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      return NextResponse.json({ error: 'رقم الصف غير صالح' }, { status: 400 });
    }

    const result = await refundInvoiceWorkbookRow({
      rowNumber,
      sheetName,
    });

    return NextResponse.json({
      success: true,
      alreadyRecorded: result.alreadyRecorded,
      erpInvoiceId: result.erpInvoiceId,
      updatedRowNumbers: result.updatedRowNumbers,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof InvoiceRefundError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Failed to create ERP refund invoice', error);
    return NextResponse.json({ error: 'فشل في إنشاء مرتجع ERP' }, { status: 500 });
  }
}
