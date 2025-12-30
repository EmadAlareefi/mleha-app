import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

const hasPriorityAccess = (sessionUser: any): boolean => {
  if (!sessionUser) return false;
  const roles: string[] = sessionUser.roles || (sessionUser.role ? [sessionUser.role] : []);
  return roles.includes('admin') || roles.includes('store_manager');
};

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || !hasPriorityAccess(session.user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'معرف السجل مطلوب' }, { status: 400 });
    }

    const record = await prisma.highPriorityOrder.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: 'السجل غير موجود' }, { status: 404 });
    }

    await prisma.highPriorityOrder.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Failed to remove high priority flag', { error });
    return NextResponse.json({ error: 'فشل إزالة الأهمية القصوى للطلب' }, { status: 500 });
  }
}
