import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { Prisma } from '@prisma/client';
import { EXPENSES_API_CREATOR, errorResponse, expenseApiKeyAuth } from '@/app/lib/expenses/auth';
import { parseDateRange, parseExternalExpense } from '@/app/lib/expenses/external-api';
import { ExpenseError } from '@/app/lib/expenses/domain';

const invalidKey = () => NextResponse.json({ error: 'مفتاح API غير صالح' }, { status: 401 });

// GET /api/expenses - Get all expenses with optional filtering
export async function GET(request: NextRequest) {
  try {
    const keyAuth = expenseApiKeyAuth(request);
    if (keyAuth === 'invalid') return invalidKey();
    const session = keyAuth === 'valid' ? null : await getServerSession(authOptions);
    if (keyAuth === 'none' && !session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى المصروفات' },
        { status: 401 }
      );
    }

    if (session && !hasServiceAccess(session, ['expenses'])) {
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
    const externalId = searchParams.get('externalId');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100') || 100, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0);

    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = status;
    }

    if (externalId) {
      where.externalId = externalId;
    }

    // from / to: YYYY-MM-DD (whole Riyadh day, inclusive) or a full ISO timestamp.
    const range = parseDateRange(searchParams.get('from'), searchParams.get('to'));
    if (range) {
      where.expenseDate = range;
    } else if (startDate || endDate) {
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
      by: ['category', 'currency'],
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
    if (error instanceof ExpenseError) return errorResponse(error);
    console.error('Error fetching expenses:', error);
    return NextResponse.json(
      { error: 'فشل في جلب المصروفات' },
      { status: 500 }
    );
  }
}

// POST /api/expenses - Create a new expense
export async function POST(request: NextRequest) {
  const keyAuth = expenseApiKeyAuth(request);
  if (keyAuth === 'invalid') return invalidKey();
  if (keyAuth === 'valid') return createFromApiKey(request);
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

// API-key integration: create only. Always pending, always createdBy "maleha";
// approval, edits and deletes stay behind the staff session on /api/expenses/[id].
async function createFromApiKey(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'الطلب يجب أن يكون JSON صالحاً' }, { status: 400 });
    }
    const data = parseExternalExpense(body);

    if (data.externalId) {
      const existing = await prisma.expense.findUnique({ where: { externalId: data.externalId }, select: { id: true } });
      if (existing) return duplicate(existing.id);
    }

    try {
      const expense = await prisma.expense.create({
        data: { ...data, source: 'api', status: 'pending', createdBy: EXPENSES_API_CREATOR },
      });
      return NextResponse.json(expense, { status: 201 });
    } catch (error) {
      // Two concurrent posts with the same externalId: the unique index decides.
      if (data.externalId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.expense.findUnique({ where: { externalId: data.externalId }, select: { id: true } });
        return duplicate(existing?.id);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function duplicate(id?: string) {
  return NextResponse.json({ error: 'مصروف بنفس externalId موجود مسبقاً', id }, { status: 409 });
}
