import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/returns/list
 * Get all return requests with filtering and search
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const type = searchParams.get('type'); // 'return' | 'exchange' | null (all)
    const status = searchParams.get('status'); // status filter
    const search = searchParams.get('search'); // search by order number, customer name, tracking number
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (type && (type === 'return' || type === 'exchange')) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (search && search.trim()) {
      where.OR = [
        { orderNumber: { contains: search.trim(), mode: 'insensitive' } },
        { customerName: { contains: search.trim(), mode: 'insensitive' } },
        { customerEmail: { contains: search.trim(), mode: 'insensitive' } },
        { customerPhone: { contains: search.trim(), mode: 'insensitive' } },
        { smsaTrackingNumber: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    // Get total count
    const total = await prisma.returnRequest.count({ where });

    // Get paginated results
    const returnRequests = await prisma.returnRequest.findMany({
      where,
      include: {
        items: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    });

    return NextResponse.json({
      success: true,
      data: returnRequests,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    log.error('Error fetching return requests', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب طلبات الإرجاع' },
      { status: 500 }
    );
  }
}
