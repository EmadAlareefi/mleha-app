import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { assignOldestOrderToUser } from '@/app/lib/order-prep-service';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['order-prep'])) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  const user = session.user as any;

  const orderUser = await prisma.orderUser.findUnique({
    where: { id: user.id },
    select: { id: true, name: true },
  });

  if (!orderUser) {
    return NextResponse.json(
      { error: 'هذا الحساب غير مضاف ضمن مستخدمي التحضير. الرجاء إنشاء مستخدم تحضير أولاً.' },
      { status: 403 }
    );
  }

  try {
    const assignment = await assignOldestOrderToUser({
      id: orderUser.id,
      name: orderUser.name || user.name,
    });
    if (!assignment) {
      return NextResponse.json(
        { error: 'لا توجد طلبات جديدة متاحة حالياً' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, assignment });
  } catch (error) {
    log.error('Failed to auto assign Salla order', { userId: user.id, error });
    return NextResponse.json({ error: 'تعذر الحصول على طلب جديد' }, { status: 500 });
  }
}
