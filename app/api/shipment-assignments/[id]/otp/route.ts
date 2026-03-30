import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  DELIVERY_OTP_EXPIRY_MINUTES,
  generateDeliveryOtp,
  hashDeliveryOtp,
  maskPhoneNumber,
} from '@/app/lib/delivery-otp';
import { sendMsegatSms } from '@/app/lib/msegat';

const MIN_SECONDS_BETWEEN_OTPS = 60;

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id } = await params;
    const user = session.user as any;

    const assignment = await prisma.shipmentAssignment.findUnique({
      where: { id },
      include: {
        shipment: true,
        deliveryAgent: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'لم يتم العثور على التعيين المطلوب' },
        { status: 404 }
      );
    }

    const isDeliveryAgent = user.roles?.includes('delivery_agent');
    const isWarehouseAdmin = user.roles?.includes('warehouse') || user.role === 'admin';

    if (isDeliveryAgent && assignment.deliveryAgentId !== user.id) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لإرسال رمز لهذه الشحنة' },
        { status: 403 }
      );
    }

    if (!isDeliveryAgent && !isWarehouseAdmin) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لإرسال رموز التحقق' },
        { status: 403 }
      );
    }

    const customerPhone = assignment.shipment.customerPhone?.trim();
    if (!customerPhone) {
      return NextResponse.json(
        { error: 'لا يوجد رقم هاتف للعميل، يرجى التواصل مع الإدارة' },
        { status: 400 }
      );
    }

    const now = new Date();
    if (
      assignment.deliveryOtpRequestedAt &&
      now.getTime() - assignment.deliveryOtpRequestedAt.getTime() < MIN_SECONDS_BETWEEN_OTPS * 1000
    ) {
      const waitSeconds = Math.ceil(
        (MIN_SECONDS_BETWEEN_OTPS * 1000 -
          (now.getTime() - assignment.deliveryOtpRequestedAt.getTime())) /
          1000
      );
      return NextResponse.json(
        {
          error: `تم إرسال رمز قبل قليل، يرجى الانتظار ${waitSeconds} ثانية قبل إعادة المحاولة`,
        },
        { status: 429 }
      );
    }

    const otp = generateDeliveryOtp();
    const expiresAt = new Date(now.getTime() + DELIVERY_OTP_EXPIRY_MINUTES * 60 * 1000);
    const otpHash = hashDeliveryOtp(otp);

    const previousState = {
      deliveryOtpCodeHash: assignment.deliveryOtpCodeHash,
      deliveryOtpRequestedAt: assignment.deliveryOtpRequestedAt,
      deliveryOtpExpiresAt: assignment.deliveryOtpExpiresAt,
      deliveryOtpVerifiedAt: assignment.deliveryOtpVerifiedAt,
      deliveryOtpAttemptCount: assignment.deliveryOtpAttemptCount,
    };

    await prisma.shipmentAssignment.update({
      where: { id },
      data: {
        deliveryOtpCodeHash: otpHash,
        deliveryOtpRequestedAt: now,
        deliveryOtpExpiresAt: expiresAt,
        deliveryOtpVerifiedAt: null,
        deliveryOtpAttemptCount: 0,
      },
    });

    const orderLabel = assignment.shipment.orderNumber
      ? `رقم الطلب ${assignment.shipment.orderNumber}`
      : assignment.shipment.trackingNumber
        ? `الشحنة ${assignment.shipment.trackingNumber}`
        : 'طلبكم';

    const smsBody = `رمز التحقق لتسليم ${orderLabel} هو ${otp}. يرجى مشاركة الرمز مع مندوب مليحة لإتمام التسليم.`;

    try {
      await sendMsegatSms({
        to: customerPhone,
        body: smsBody,
      });
    } catch (smsError) {
      await prisma.shipmentAssignment.update({
        where: { id },
        data: {
          deliveryOtpCodeHash: previousState.deliveryOtpCodeHash,
          deliveryOtpRequestedAt: previousState.deliveryOtpRequestedAt,
          deliveryOtpExpiresAt: previousState.deliveryOtpExpiresAt,
          deliveryOtpVerifiedAt: previousState.deliveryOtpVerifiedAt,
          deliveryOtpAttemptCount: previousState.deliveryOtpAttemptCount,
        },
      });

      log.error('Failed to send OTP via Msegat', {
        assignmentId: id,
        error: smsError instanceof Error ? smsError.message : smsError,
      });

      return NextResponse.json(
        {
          error:
            smsError instanceof Error
              ? smsError.message
              : 'تعذر إرسال الرسالة، يرجى المحاولة لاحقاً',
        },
        { status: 502 }
      );
    }

    log.info('Sent delivery OTP', {
      assignmentId: id,
      deliveryAgentId: assignment.deliveryAgentId,
    });

    return NextResponse.json({
      success: true,
      requestedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maskedPhone: maskPhoneNumber(customerPhone),
      durationMinutes: DELIVERY_OTP_EXPIRY_MINUTES,
    });
  } catch (error) {
    log.error('Unexpected error while sending delivery OTP', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إرسال رمز التحقق' },
      { status: 500 }
    );
  }
}
