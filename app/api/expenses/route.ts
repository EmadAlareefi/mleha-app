import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

// GET /api/expenses - Get all expenses with optional filtering
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى المصروفات' },
        { status: 401 }
      );
    }

    if (!hasServiceAccess(session, ['expenses'])) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض المصروفات' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) {
        where.expenseDate.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: {
          expenseDate: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.expense.count({ where }),
    ]);

    // Get summary statistics
    const summary = await prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: {
        amount: true,
      },
      _count: true,
    });

    return NextResponse.json({
      expenses,
      total,
      summary,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json(
      { error: 'فشل في جلب المصروفات' },
      { status: 500 }
    );
  }
}

// POST /api/expenses - Create a new expense
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لإضافة مصروف' },
        { status: 401 }
      );
    }

    if (!hasServiceAccess(session, ['expenses'])) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لإضافة مصروفات' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      merchantId,
      title,
      description,
      amount,
      currency,
      category,
      expenseDate,
      attachments,
      notes,
    } = body;

    // Validate required fields
    if (!title || !amount || !category) {
      return NextResponse.json(
        { error: 'العنوان والمبلغ والفئة مطلوبة' },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'المبلغ يجب أن يكون أكبر من صفر' },
        { status: 400 }
      );
    }

    // Create expense
    const expense = await prisma.expense.create({
      data: {
        merchantId: merchantId || 'default',
        title,
        description,
        amount,
        currency: currency || 'SAR',
        category,
        expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
        attachments,
        notes,
        createdBy:
          (session.user as any)?.username ||
          (session.user as any)?.name ||
          (session.user as any)?.id,
        status: 'pending',
      },
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    console.error('Error creating expense:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء المصروف' },
      { status: 500 }
    );
  }
}
