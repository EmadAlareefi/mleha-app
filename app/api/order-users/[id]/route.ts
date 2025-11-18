import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

/**
 * PUT /api/order-users/[id]
 * Update an order user
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      orderType,
      specificStatus,
      isActive,
      autoAssign,
      maxOrders,
      password,
    } = body;

    const updateData: any = {
      name,
      email,
      phone,
      orderType,
      specificStatus: orderType === 'specific_status' ? specificStatus : null,
      isActive,
      autoAssign,
      maxOrders,
    };

    // Only update password if provided
    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.orderUser.update({
      where: { id: params.id },
      data: updateData,
    });

    log.info('Order user updated', { userId: user.id, username: user.username });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        orderType: user.orderType,
        specificStatus: user.specificStatus,
        isActive: user.isActive,
        autoAssign: user.autoAssign,
        maxOrders: user.maxOrders,
      },
    });
  } catch (error) {
    log.error('Error updating order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث المستخدم' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/order-users/[id]
 * Delete an order user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.orderUser.delete({
      where: { id: params.id },
    });

    log.info('Order user deleted', { userId: params.id });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    log.error('Error deleting order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء حذف المستخدم' },
      { status: 500 }
    );
  }
}
