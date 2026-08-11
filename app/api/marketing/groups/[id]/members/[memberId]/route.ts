import { NextResponse } from 'next/server';
import { authorizeMarketing, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; memberId: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  const { id, memberId } = await context.params;
  try {
    const result = await prisma.marketingCustomer.updateMany({
      where: { id: memberId, groupId: id, isActive: true },
      data: { isActive: false },
    });
    if (!result.count) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر إزالة العميل من المجموعة');
  }
}
