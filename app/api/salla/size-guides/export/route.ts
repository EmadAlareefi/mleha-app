import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { serializeSizeGuidesCsv, SIZE_GUIDE_SERVICE_KEY } from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بتصدير أدلة المقاسات' }, { status: 403 });
  }

  const guides = await prisma.sallaSizeGuide.findMany({ orderBy: [{ updatedAt: 'desc' }] });
  const csv = serializeSizeGuidesCsv(guides);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="size-guides.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
