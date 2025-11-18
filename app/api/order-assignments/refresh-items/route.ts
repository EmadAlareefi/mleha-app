import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/order-assignments/refresh-items
 * Refresh order items for an existing assignment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentId } = body;

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

    // Get Salla access token
    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(MERCHANT_ID);

    if (!accessToken) {
      log.error('No valid Salla access token');
      return NextResponse.json(
        { error: 'فشل الاتصال بسلة' },
        { status: 500 }
      );
    }

    const baseUrl = 'https://api.salla.dev/admin/v2';

    // Fetch order details
    const detailUrl = `${baseUrl}/orders/${assignment.orderId}`;
    const detailResponse = await fetch(detailUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!detailResponse.ok) {
      return NextResponse.json(
        { error: 'فشل جلب بيانات الطلب من سلة' },
        { status: 500 }
      );
    }

    const detailData = await detailResponse.json();
    const orderDetail = detailData.data;

    // Fetch order items using query parameter
    const itemsUrl = `${baseUrl}/orders/items?order_id=${assignment.orderId}`;
    const itemsResponse = await fetch(itemsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!itemsResponse.ok) {
      const errorText = await itemsResponse.text();
      log.error('Failed to fetch order items', {
        orderId: assignment.orderId,
        status: itemsResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'فشل جلب منتجات الطلب من سلة', details: errorText },
        { status: 500 }
      );
    }

    const itemsData = await itemsResponse.json();

    // Log the raw response for debugging
    log.info('Raw items response', {
      orderId: assignment.orderId,
      itemsData: JSON.stringify(itemsData),
    });

    orderDetail.items = itemsData.data || [];

    log.info('Refreshed order items', {
      orderId: assignment.orderId,
      itemsCount: orderDetail.items.length,
      hasItems: !!orderDetail.items,
      itemsType: typeof orderDetail.items,
      isArray: Array.isArray(orderDetail.items),
    });

    // Update assignment with new order data
    const updatedAssignment = await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        orderData: orderDetail as any,
      },
    });

    return NextResponse.json({
      success: true,
      itemsCount: orderDetail.items.length,
      assignment: updatedAssignment,
      debug: {
        rawResponse: itemsData,
        itemsData: orderDetail.items,
        firstItem: orderDetail.items?.[0],
      },
    });

  } catch (error) {
    log.error('Error refreshing order items', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث منتجات الطلب' },
      { status: 500 }
    );
  }
}
