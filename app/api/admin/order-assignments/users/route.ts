import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/admin/order-assignments/users
 * Get list of users with order role for assignment
 */
export async function GET(request: NextRequest) {
  try {
    // Fetch all OrderUsers (users with order role)
    const orderUsers = await prisma.orderUser.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        autoAssign: true,
        maxOrders: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Format response
    const formattedUsers = orderUsers.map(user => ({
      id: user.id,
      username: user.username,
      name: user.name,
      autoAssign: user.autoAssign || false,
      maxOrders: user.maxOrders || 50,
    }));

    return NextResponse.json({
      success: true,
      users: formattedUsers,
      count: formattedUsers.length,
    });

  } catch (error) {
    log.error('Error fetching order users', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب المستخدمين' },
      { status: 500 }
    );
  }
}
