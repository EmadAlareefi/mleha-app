import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  sizeGuideAudit,
  SIZE_GUIDE_SERVICE_KEY,
  validateSizeGuideDocument,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بنشر أدلة المقاسات' }, { status: 403 });
  }
  const { id } = await context.params;
  const existing = await prisma.sallaSizeGuide.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });

  try {
    const validated = validateSizeGuideDocument(existing.draftData);
    if (!validated.canPublish) {
      return NextResponse.json(
        { error: 'صحح أخطاء الدليل قبل النشر', issues: validated.issues },
        { status: 400 }
      );
    }
    const audit = sizeGuideAudit(session.user);
    const guide = await prisma.sallaSizeGuide.update({
      where: { id },
      data: {
        draftData: validated.data as unknown as Prisma.InputJsonValue,
        publishedData: validated.data as unknown as Prisma.InputJsonValue,
        validationIssues: validated.issues as unknown as Prisma.InputJsonValue,
        hasIssues: validated.issues.length > 0,
        publishedAt: new Date(),
        publishedById: audit.id,
        publishedByName: audit.name,
        publishedByUsername: audit.username,
      },
    });
    return NextResponse.json({ success: true, guide });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر نشر دليل المقاسات' },
      { status: 400 }
    );
  }
}
