import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';
import { serializeAssignment, attachProductLocations } from '@/app/lib/order-prep-service';
import { log } from '@/app/lib/logger';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['order-prep'])) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  const user = session.user as any;
  const { assignmentId } = await context.params;

  try {
    const assignment = await prisma.orderPrepAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment || assignment.userId !== user.id) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب أو لا تملك إذن تحديثه' },
        { status: 404 },
      );
    }

    const accessToken = await getSallaAccessToken(MERCHANT_ID);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'تعذر الاتصال بسلة' },
        { status: 502 },
      );
    }

    const detailResponse = await fetchSallaWithRetry(
      `${SALLA_API_BASE}/orders/${encodeURIComponent(assignment.orderId)}`,
      accessToken,
    );

    if (!detailResponse.ok) {
      const errorText = await detailResponse.text().catch(() => '');
      log.warn('Failed to refresh order detail from Salla', {
        orderId: assignment.orderId,
        status: detailResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'تعذر جلب تفاصيل الطلب من سلة' },
        { status: 502 },
      );
    }

    const detailData = await detailResponse.json();
    const detail = detailData?.data ?? {};

    try {
      const itemsResponse = await fetchSallaWithRetry(
        `${SALLA_API_BASE}/orders/items?order_id=${encodeURIComponent(assignment.orderId)}`,
        accessToken,
      );

      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json();
        detail.items = Array.isArray(itemsData?.data) ? itemsData.data : detail.items;
      } else {
        const errorText = await itemsResponse.text().catch(() => '');
        log.warn('Failed to refresh order items from Salla', {
          orderId: assignment.orderId,
          status: itemsResponse.status,
          error: errorText,
        });
      }
    } catch (itemsError) {
      log.warn('Error fetching order items during refresh', {
        orderId: assignment.orderId,
        error: itemsError instanceof Error ? itemsError.message : itemsError,
      });
    }

    await attachProductLocations(detail);

    const updatedAssignment = await prisma.orderPrepAssignment.update({
      where: { id: assignment.id },
      data: {
        orderData: detail as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      success: true,
      assignment: serializeAssignment(updatedAssignment),
    });
  } catch (error) {
    log.error('Failed to refresh order prep items', {
      assignmentId,
      userId: user.id,
      error,
    });
    return NextResponse.json(
      { error: 'تعذر تحديث بيانات الطلب من سلة' },
      { status: 500 },
    );
  }
}
