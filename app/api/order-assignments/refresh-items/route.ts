import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

/**
 * POST /api/order-assignments/refresh-items
 * Refresh order items for an existing assignment
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (!hasServiceAccess(session, ['order-shipping', 'order-prep'])) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { assignmentId } = body as { assignmentId?: string };

    if (!assignmentId) {
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
        { status: 400 }
      );
    }

    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'الطلب غير موجود' },
        { status: 404 }
      );
    }

    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(assignment.merchantId);

    if (!accessToken) {
      log.error('No valid Salla access token');
      return NextResponse.json(
        { error: 'فشل الاتصال بسلة' },
        { status: 500 }
      );
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    const orderId = encodeURIComponent(assignment.orderId);

    // Detail and items are independent; fetch them together.
    const [detailResponse, itemsResponse] = await Promise.all([
      fetch(`${SALLA_API_BASE}/orders/${orderId}`, { headers }),
      fetch(`${SALLA_API_BASE}/orders/items?order_id=${orderId}`, { headers }),
    ]);

    if (!detailResponse.ok) {
      return NextResponse.json(
        { error: 'فشل جلب بيانات الطلب من سلة' },
        { status: 500 }
      );
    }

    if (!itemsResponse.ok) {
      const errorText = await itemsResponse.text();
      log.error('Failed to fetch order items', {
        orderId: assignment.orderId,
        status: itemsResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'فشل جلب منتجات الطلب من سلة' },
        { status: 500 }
      );
    }

    const detailData = await detailResponse.json();
    const itemsData = await itemsResponse.json();
    const orderDetail = (detailData?.data ?? {}) as Record<string, any>;

    const existing =
      assignment.orderData && typeof assignment.orderData === 'object' && !Array.isArray(assignment.orderData)
        ? (assignment.orderData as Record<string, any>)
        : {};

    // Only replace the items when Salla actually returned some; an empty list
    // would otherwise wipe valid line items. Keep fields stored alongside the
    // Salla payload (e.g. prep statuses) by merging instead of overwriting.
    const freshItems = Array.isArray(itemsData?.data) && itemsData.data.length > 0
      ? itemsData.data
      : orderDetail.items ?? existing.items ?? [];
    const nextOrderData = { ...existing, ...orderDetail, items: freshItems };

    log.info('Refreshed order items', {
      orderId: assignment.orderId,
      itemsCount: Array.isArray(freshItems) ? freshItems.length : 0,
    });

    const updatedAssignment = await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        orderData: nextOrderData as any,
      },
    });

    return NextResponse.json({
      success: true,
      itemsCount: Array.isArray(freshItems) ? freshItems.length : 0,
      assignment: updatedAssignment,
    });

  } catch (error) {
    log.error('Error refreshing order items', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث منتجات الطلب' },
      { status: 500 }
    );
  }
}
