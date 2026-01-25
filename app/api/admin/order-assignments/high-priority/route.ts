import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const DEFAULT_REASON = 'تم تحديده من لوحة إدارة التحضير';

const sanitizeString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const ensureAdmin = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { status: 401 as const, response: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) };
  }
  const roles = (session.user as any)?.roles || [];
  const role = (session.user as any)?.role;
  const isAdmin = roles.includes('admin') || role === 'admin';
  if (!isAdmin) {
    return {
      status: 403 as const,
      response: NextResponse.json({ error: 'لا تملك صلاحية الوصول' }, { status: 403 }),
    };
  }
  return { status: 200 as const, session };
};

export async function POST(request: NextRequest) {
  const check = await ensureAdmin();
  if (check.status !== 200) {
    return check.response;
  }

  try {
    const body = await request.json().catch(() => null);
    const orderId = sanitizeString(body?.orderId);
    const orderNumber = sanitizeString(body?.orderNumber);
    const customerName = sanitizeString(body?.customerName);
    const reason = sanitizeString(body?.reason) || DEFAULT_REASON;
    const notes = sanitizeString(body?.notes);

    if (!orderId) {
      return NextResponse.json({ error: 'يجب تمرير رقم الطلب' }, { status: 400 });
    }

    const user = check.session?.user as any;
    const actorName = user?.name || user?.username || null;

    const record = await prisma.highPriorityOrder.upsert({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId,
        },
      },
      update: {
        orderNumber: orderNumber || orderId,
        customerName: customerName || null,
        reason,
        notes: notes || null,
        createdById: user?.id || null,
        createdByName: actorName,
        createdByUsername: user?.username || null,
      },
      create: {
        merchantId: MERCHANT_ID,
        orderId,
        orderNumber: orderNumber || orderId,
        customerName: customerName || null,
        reason,
        notes: notes || null,
        createdById: user?.id || null,
        createdByName: actorName,
        createdByUsername: user?.username || null,
      },
    });

    return NextResponse.json({
      success: true,
      priority: {
        ...record,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    log.error('Failed to flag priority order from admin dashboard', { error });
    return NextResponse.json(
      { error: 'تعذر حفظ تمييز الطلب كأولوية' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const check = await ensureAdmin();
  if (check.status !== 200) {
    return check.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const idParam = sanitizeString(searchParams.get('id'));
    const orderIdParam = sanitizeString(searchParams.get('orderId'));

    if (!idParam && !orderIdParam) {
      return NextResponse.json(
        { error: 'يجب تمرير معرف الطلب أو رقم الطلب لإزالته من الأولوية' },
        { status: 400 },
      );
    }

    const where = idParam
      ? { id: idParam }
      : {
          merchantId_orderId: {
            merchantId: MERCHANT_ID,
            orderId: orderIdParam,
          },
        };

    try {
      await prisma.highPriorityOrder.delete({ where });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return NextResponse.json(
          { error: 'الطلب غير موجود في قائمة الأولوية' },
          { status: 404 },
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Failed to remove priority flag from admin dashboard', { error });
    return NextResponse.json(
      { error: 'تعذر إزالة الطلب من قائمة الأولوية' },
      { status: 500 },
    );
  }
}
