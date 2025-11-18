import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { OrderUserRole } from '@prisma/client';

export const runtime = 'nodejs';

const ROLE_MAP: Record<string, OrderUserRole> = {
  orders: OrderUserRole.ORDERS,
  store_manager: OrderUserRole.STORE_MANAGER,
  warehouse: OrderUserRole.WAREHOUSE,
};

function normalizeRole(role?: string | null): OrderUserRole {
  if (!role) return OrderUserRole.ORDERS;
  const normalized = role.toLowerCase();
  if (!ROLE_MAP[normalized]) {
    throw new Error('دور المستخدم غير صالح');
  }
  return ROLE_MAP[normalized];
}

/**
 * PUT /api/order-users/[id]
 * Update an order user
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بتحديث المستخدمين' },
      { status: 403 }
    );
  }

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
      role: roleInput,
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

    if (roleInput) {
      try {
        updateData.role = normalizeRole(roleInput);
      } catch (roleError) {
        return NextResponse.json(
          { error: roleError instanceof Error ? roleError.message : 'دور المستخدم غير صالح' },
          { status: 400 }
        );
      }
    }

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
        role: user.role.toLowerCase(),
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
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== 'admin') {
    return NextResponse.json(
      { error: 'غير مصرح لك بحذف المستخدمين' },
      { status: 403 }
    );
  }

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
