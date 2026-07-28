import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  isAvailabilityRequestStatus,
  updateAvailabilityRequestStatus,
} from '@/app/lib/salla-availability-requests';

export const runtime = 'nodejs';

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const resolvedParams = await params;
  const requestId = resolvedParams?.id;
  if (!requestId) {
    return NextResponse.json({ success: false, error: 'معرف الطلب غير صالح' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status;

  if (!isAvailabilityRequestStatus(status)) {
    return NextResponse.json(
      { success: false, error: 'حالة الطلب غير صحيحة' },
      { status: 400 }
    );
  }

  try {
    const actorName =
      (session.user as any)?.name || session.user?.email || 'عضو فريق سلة';
    const requestRecord = await updateAvailabilityRequestStatus({
      id: requestId,
      status,
      actorName,
    });
    return NextResponse.json({ success: true, request: requestRecord });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json(
        { success: false, error: 'طلب الإشعار غير موجود' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'تعذر تحديث حالة الطلب',
      },
      { status: 500 }
    );
  }
}
