import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  buildAvailabilityTemplateArgs,
  listAvailabilityRequestsByIds,
  updateAvailabilityRequestStatus,
  type AvailabilityRequestRecord,
} from '@/app/lib/salla-availability-requests';
import { sendWhatsAppButtonTemplate } from '@/app/lib/zoko';

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

  const templateId =
    typeof body?.templateId === 'string' && body.templateId.trim().length > 0
      ? body.templateId.trim()
      : '';
  if (!templateId) {
    return NextResponse.json(
      { success: false, error: 'معرف قالب واتساب مطلوب' },
      { status: 400 }
    );
  }

  const templateLanguage =
    typeof body?.templateLanguage === 'string' && body.templateLanguage.trim().length > 0
      ? body.templateLanguage.trim()
      : undefined;

  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0 ? body.message : ' ';

  const requests = await listAvailabilityRequestsByIds(requestIds);
  const actorName = (session.user as any)?.name || session.user?.email || 'عضو فريق سلة';

  const results: BulkResult[] = [];
  const updatedRequests: AvailabilityRequestRecord[] = [];

  for (const requestRecord of requests) {
    try {
      await sendWhatsAppButtonTemplate({
        to: requestRecord.customerPhone,
        templateId,
        lang: templateLanguage,
        templateArgs: buildAvailabilityTemplateArgs(requestRecord),
        message,
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
