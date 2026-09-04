import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import { maybeNotifyReturnLabelCreated } from '@/app/lib/returns/return-label-notification';
import { requestSallaReturnPolicy } from '@/app/lib/returns/salla-return-policy';
import { syncReturnShipment } from '@/app/lib/returns/return-shipment-sync';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const ACTIONS = ['sync', 'reissue', 'resend'] as const;
type LabelAction = (typeof ACTIONS)[number];

const REQUEST_FIELDS = {
  id: true,
  merchantId: true,
  orderId: true,
  orderNumber: true,
  createdAt: true,
  smsaTrackingNumber: true,
  returnLabelUrl: true,
  returnLabelNotificationSentAt: true,
} as const;

/** `/api/returns` is a public middleware prefix, so this route guards itself. */
async function authorizeReturnsManagement() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, 'returns-management') ? session : null;
}

/**
 * POST /api/returns/label-actions
 *
 * Manual counterparts to the label backfill cron:
 *  - `sync`    pull the return shipment from Salla now
 *  - `reissue` ask Salla for the waybill again (for requests it accepted but
 *              never fulfilled — the shipment sits at `creating` forever)
 *  - `resend`  re-send the WhatsApp even though it was already sent once
 */
export async function POST(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) {
    return NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const returnRequestId =
      typeof body?.returnRequestId === 'string' ? body.returnRequestId.trim() : '';
    const action = body?.action as LabelAction;

    if (!returnRequestId || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'معرف الطلب ونوع الإجراء مطلوبان' },
        { status: 400 }
      );
    }

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      select: REQUEST_FIELDS,
    });

    if (!returnRequest) {
      return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
    }

    if (action === 'reissue') {
      const policyResult = await requestSallaReturnPolicy(
        returnRequest.merchantId,
        returnRequest.orderId
      );

      if (!policyResult.success) {
        return NextResponse.json(
          { error: policyResult.error, details: policyResult.details },
          { status: 502 }
        );
      }

      log.info('Return waybill re-issued', {
        returnRequestId,
        orderNumber: returnRequest.orderNumber,
        operationId: policyResult.operationId,
        by: session.user?.name || session.user?.email,
      });

      // Salla fulfils this asynchronously, so the immediate sync usually reports
      // `pending`; the cron picks the waybill up when it appears.
      const sync = await syncReturnShipment(returnRequest, { source: 'returns-management-reissue' });

      return NextResponse.json({
        success: true,
        action,
        operationId: policyResult.operationId,
        operationStatus: policyResult.operationStatus,
        sync,
      });
    }

    if (action === 'resend') {
      if (!returnRequest.returnLabelUrl) {
        return NextResponse.json(
          { error: 'لا توجد بوليصة إرجاع لإرسالها. استخدم "تحديث من سلة" أو "إعادة إصدار البوليصة".' },
          { status: 400 }
        );
      }

      const notification = await maybeNotifyReturnLabelCreated({
        merchantId: returnRequest.merchantId,
        orderId: returnRequest.orderId,
        orderNumber: returnRequest.orderNumber,
        returnRequestId: returnRequest.id,
        labelUrl: returnRequest.returnLabelUrl,
        trackingNumber: returnRequest.smsaTrackingNumber,
        source: 'returns-management-resend',
        force: true,
      });

      log.info('Return label notification resent', {
        returnRequestId,
        orderNumber: returnRequest.orderNumber,
        status: notification.status,
        by: session.user?.name || session.user?.email,
      });

      return NextResponse.json({ success: true, action, notification });
    }

    const sync = await syncReturnShipment(returnRequest, { source: 'returns-management-sync' });
    return NextResponse.json({ success: true, action, sync });
  } catch (error) {
    log.error('Return label action failed', { error });
    return NextResponse.json({ error: 'حدث خطأ أثناء تنفيذ الإجراء' }, { status: 500 });
  }
}
