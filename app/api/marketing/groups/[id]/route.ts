import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body?.description === 'string' ? body.description.trim() : undefined;
    const isArchived = typeof body?.isArchived === 'boolean' ? body.isArchived : undefined;
    if (name !== undefined && (!name || name.length > 120)) {
      return NextResponse.json({ error: 'اسم المجموعة غير صالح' }, { status: 400 });
    }
    if (description !== undefined && description.length > 1000) {
      return NextResponse.json({ error: 'وصف المجموعة طويل جداً' }, { status: 400 });
    }
    const group = await prisma.marketingCustomerGroup.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(isArchived !== undefined ? { isArchived } : {}),
      },
    });
    return NextResponse.json({ success: true, group });
  } catch (error: any) {
    if (error?.code === 'P2025') return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 });
    return marketingErrorResponse(error, 'تعذر تحديث مجموعة العملاء');
  }
}
