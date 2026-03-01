import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  buildAvailabilityNotificationMessage,
  listAvailabilityRequestsByIds,
  updateAvailabilityRequestStatus,
  type AvailabilityRequestRecord,
} from '@/app/lib/salla-availability-requests';
import { sendMsegatSms } from '@/app/lib/msegat';

export const runtime = 'nodejs';

type BulkResult = {
  id: string;
  success: boolean;
  error?: string;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const requestIds: string[] = Array.isArray(body?.requestIds)
    ? body.requestIds
        .map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id ?? '')))
        .filter((id: string) => id.length > 0)
    : [];

  if (requestIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'يرجى اختيار طلب واحد على الأقل' },
      { status: 400 }
    );
  }

  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0
      ? body.message.trim()
      : null;

  const requests = await listAvailabilityRequestsByIds(requestIds);
  const actorName = (session.user as any)?.name || session.user?.email || 'عضو فريق سلة';

  const results: BulkResult[] = [];
  const updatedRequests: AvailabilityRequestRecord[] = [];

  for (const requestRecord of requests) {
    try {
      const smsBody = message || buildAvailabilityNotificationMessage(requestRecord);
      await sendMsegatSms({
        to: requestRecord.customerPhone,
        body: smsBody,
      });
      const updated = await updateAvailabilityRequestStatus({
        id: requestRecord.id,
        status: 'notified',
        actorName,
      });
      updatedRequests.push(updated);
      results.push({ id: requestRecord.id, success: true });
    } catch (error) {
      results.push({
        id: requestRecord.id,
        success: false,
        error: error instanceof Error ? error.message : 'تعذر إرسال الرسالة',
      });
    }
  }

  const foundIds = new Set(requests.map((request) => request.id));
  requestIds.forEach((id: string) => {
    if (!foundIds.has(id)) {
      results.push({ id, success: false, error: 'طلب الإشعار غير موجود' });
    }
  });

  const sentCount = results.filter((entry) => entry.success).length;
  const failedCount = results.length - sentCount;

  return NextResponse.json({
    success: sentCount > 0,
    sentCount,
    failedCount,
    results,
    updatedRequests,
    error: sentCount === 0 ? 'تعذر إرسال الرسائل المحددة' : undefined,
  });
}
