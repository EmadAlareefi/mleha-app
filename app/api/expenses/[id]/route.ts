import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

// GET /api/expenses/[id] - Get a single expense
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى المصروفات' },
        { status: 401 }
      );
    }

    if (!hasServiceAccess(session, 'expenses')) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض المصروفات' },
        { status: 403 }
      );
    }

    const expense = await prisma.expense.findUnique({
      where: { id },
    });

    if (!expense) {
      return NextResponse.json(
        { error: 'المصروف غير موجود' },
        { status: 404 }
      );
    }

    return NextResponse.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    return NextResponse.json(
      { error: 'فشل في جلب المصروف' },
      { status: 500 }
    );
  }
}

// PATCH /api/expenses/[id] - Update an expense
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لتحديث المصروف' },
        { status: 401 }
      );
    }

    if (!hasServiceAccess(session, 'expenses')) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لتحديث المصروفات' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      amount,
      currency,
      category,
      expenseDate,
      attachments,
      notes,
      status,
    } = body;

    // Check if expense exists
    const existingExpense = await prisma.expense.findUnique({
      where: { id },
    });

    if (!existingExpense) {
      return NextResponse.json(
        { error: 'المصروف غير موجود' },
        { status: 404 }
      );
    }

    // Validate amount if provided
    if (amount !== undefined && amount <= 0) {
      return NextResponse.json(
        { error: 'المبلغ يجب أن يكون أكبر من صفر' },
        { status: 400 }
      );
    }

    // Update expense
    const updatedData: any = {};
    if (title !== undefined) updatedData.title = title;
    if (description !== undefined) updatedData.description = description;
    if (amount !== undefined) updatedData.amount = amount;
    if (currency !== undefined) updatedData.currency = currency;
    if (category !== undefined) updatedData.category = category;
    if (expenseDate !== undefined)
      updatedData.expenseDate = new Date(expenseDate);
    if (attachments !== undefined) updatedData.attachments = attachments;
    if (notes !== undefined) updatedData.notes = notes;
    if (status !== undefined) {
      updatedData.status = status;
      if (status === 'approved' || status === 'rejected') {
        updatedData.approvedBy =
          (session.user as any)?.username ||
          (session.user as any)?.name ||
          (session.user as any)?.id;
        updatedData.approvedAt = new Date();
      }
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: updatedData,
    });

    return NextResponse.json(expense);
  } catch (error) {
    console.error('Error updating expense:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث المصروف' },
      { status: 500 }
    );
  }
}

// DELETE /api/expenses/[id] - Delete an expense
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لحذف المصروف' },
        { status: 401 }
      );
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const hasPermission = roles.includes('admin');

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لحذف المصروفات' },
        { status: 403 }
      );
    }

    // Check if expense exists
    const expense = await prisma.expense.findUnique({
      where: { id },
    });

    if (!expense) {
      return NextResponse.json(
        { error: 'المصروف غير موجود' },
        { status: 404 }
      );
    }

    // Delete expense
    await prisma.expense.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'تم حذف المصروف بنجاح' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return NextResponse.json(
      { error: 'فشل في حذف المصروف' },
      { status: 500 }
    );
  }
}
