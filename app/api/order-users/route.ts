import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

/**
 * GET /api/order-users
 * Get all order users
 */
export async function GET(request: NextRequest) {
  try {
    const users = await prisma.orderUser.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        orderType: true,
        specificStatus: true,
        isActive: true,
        autoAssign: true,
        maxOrders: true,
        createdAt: true,
        _count: {
          select: {
            assignments: {
              where: {
                status: {
                  in: ['assigned', 'preparing'],
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    log.error('Error fetching order users', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب المستخدمين' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/order-users
 * Create a new order user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      username,
      password,
      name,
      email,
      phone,
      orderType,
      specificStatus,
      autoAssign,
      maxOrders,
    } = body;

    // Validation
    if (!username || !password || !name || !orderType) {
      return NextResponse.json(
        { error: 'اسم المستخدم، كلمة المرور، الاسم، ونوع الطلب مطلوبة' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUser = await prisma.orderUser.findUnique({
      where: { username },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'اسم المستخدم موجود بالفعل' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.orderUser.create({
      data: {
        username,
        password: hashedPassword,
        name,
        email,
        phone,
        orderType,
        specificStatus: orderType === 'specific_status' ? specificStatus : null,
        autoAssign: autoAssign !== false,
        maxOrders: maxOrders || 50,
      },
    });

    log.info('Order user created', { userId: user.id, username });

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
    log.error('Error creating order user', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء المستخدم' },
      { status: 500 }
    );
  }
}
