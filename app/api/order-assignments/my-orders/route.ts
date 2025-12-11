import { NextRequest, NextResponse} from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/order-assignments/my-orders
 * Get orders assigned to a specific user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // optional filter

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    const where: any = {
      userId,
    };

    if (status) {
      where.status = status;
    } else {
      // Default: show active assignments including shipped orders
      where.status = {
        in: ['assigned', 'preparing', 'shipped'],
      };
    }

    const assignments = await prisma.orderAssignment.findMany({
      where,
      orderBy: {
        assignedAt: 'asc', // Oldest first (FIFO)
      },
    });

    return NextResponse.json({
      success: true,
      assignments,
    });

  } catch (error) {
    log.error('Error fetching user orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات' },
      { status: 500 }
    );
  }
}
