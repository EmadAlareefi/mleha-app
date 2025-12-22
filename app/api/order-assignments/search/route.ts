import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const roles = user.roles || [user.role];

    // Check if user is admin or warehouse
    const isAuthorized = roles.includes('admin') || roles.includes('warehouse');
    if (!isAuthorized) {
      return NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('orderNumber');

    if (!orderNumber) {
      return NextResponse.json({ error: 'رقم الطلب مطلوب' }, { status: 400 });
    }

    // Search for the order assignment
    const assignment = await prisma.orderAssignment.findFirst({
      where: {
        orderNumber: orderNumber,
      },
      orderBy: {
        assignedAt: 'desc', // Get the most recent assignment
      },
    });

    if (!assignment) {
      return NextResponse.json({
        success: false,
        error: 'لم يتم العثور على الطلب'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      assignment: {
        id: assignment.id,
        orderId: assignment.orderId,
        orderNumber: assignment.orderNumber,
        orderData: assignment.orderData,
        status: assignment.status,
        sallaStatus: assignment.sallaStatus,
        assignedUserId: assignment.assignedUserId,
        assignedUserName: assignment.assignedUserName,
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        completedAt: assignment.completedAt,
        notes: assignment.notes,
      },
    });
  } catch (error) {
    console.error('Error searching for order:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الطلب' },
      { status: 500 }
    );
  }
}
