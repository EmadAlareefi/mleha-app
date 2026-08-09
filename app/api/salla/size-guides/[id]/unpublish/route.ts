import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { SIZE_GUIDE_SERVICE_KEY } from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بإلغاء النشر' }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const guide = await prisma.sallaSizeGuide.update({
      where: { id },
      data: {
        publishedData: { unset: true },
        publishedAt: null,
        publishedById: null,
        publishedByName: null,
        publishedByUsername: null,
      },
    });
    return NextResponse.json({ success: true, guide });
  } catch {
    return NextResponse.json({ error: 'تعذر إلغاء النشر أو أن الدليل غير موجود' }, { status: 404 });
  }
}
