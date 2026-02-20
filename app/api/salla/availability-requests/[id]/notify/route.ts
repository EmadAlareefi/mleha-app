import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  buildAvailabilityTemplateArgs,
  getAvailabilityRequestById,
  updateAvailabilityRequestStatus,
} from '@/app/lib/salla-availability-requests';
import { sendWhatsAppButtonTemplate } from '@/app/lib/zoko';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const { id: requestId } = await params;
  if (!requestId) {
    return NextResponse.json({ success: false, error: 'معرف الطلب غير صالح' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const markOnly = body?.markOnly === true;
  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0 ? body.message : ' ';
  const templateId =
    typeof body?.templateId === 'string' && body.templateId.trim().length > 0
      ? body.templateId.trim()
      : 'notify_available';
  const templateLanguage =
    typeof body?.templateLanguage === 'string' && body.templateLanguage.trim().length > 0
      ? body.templateLanguage.trim()
      : undefined;

  try {
    const requestRecord = await getAvailabilityRequestById(requestId);
    if (!requestRecord) {
      return NextResponse.json(
        { success: false, error: 'طلب الإشعار غير موجود' },
        { status: 404 }
      );
    }

    if (!markOnly) {
      await sendWhatsAppButtonTemplate({
        to: requestRecord.customerPhone,
        templateId,
        lang: templateLanguage,
        templateArgs: buildAvailabilityTemplateArgs(requestRecord),
        message,
      });
    }

    const updated = await updateAvailabilityRequestStatus({
      id: requestRecord.id,
      status: 'notified',
      actorName: (session.user as any)?.name || session.user?.email || 'عضو فريق سلة',
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'تعذر إرسال الرسالة' },
      { status: 500 }
    );
  }
}
