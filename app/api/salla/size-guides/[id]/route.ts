import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  optionalSizeGuideText,
  parseSizeGuideSku,
  sizeGuideAudit,
  SIZE_GUIDE_SERVICE_KEY,
  validateSizeGuideDocument,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

async function authorize() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY) ? session : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function productId(value: unknown): string | null {
  const parsed = optionalSizeGuideText(value, 32);
  if (parsed && !/^\d+$/.test(parsed)) throw new Error('رقم منتج سلة غير صالح');
  return parsed;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!(await authorize())) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;
  const guide = await prisma.sallaSizeGuide.findUnique({ where: { id } });
  return guide
    ? NextResponse.json({ success: true, guide })
    : NextResponse.json({ error: 'دليل المقاسات غير موجود' }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await authorize();
  if (!session?.user) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error('بيانات التحديث غير صالحة');
    const input = body as Record<string, unknown>;
    const data: Prisma.SallaSizeGuideUpdateInput = {};
    let canPublish: boolean | undefined;

    if ('sku' in input) Object.assign(data, parseSizeGuideSku(input.sku));
    if ('productId' in input) data.productId = productId(input.productId);
    if ('productName' in input) data.productName = optionalSizeGuideText(input.productName, 250);
    if ('productImageUrl' in input) data.productImageUrl = optionalSizeGuideText(input.productImageUrl, 500);
    if ('data' in input) {
      const validated = validateSizeGuideDocument(input.data);
      data.draftData = json(validated.data);
      data.validationIssues = json(validated.issues);
      data.hasIssues = validated.issues.length > 0;
      canPublish = validated.canPublish;
    }

    const audit = sizeGuideAudit(session.user);
    data.updatedById = audit.id;
    data.updatedByName = audit.name;
    data.updatedByUsername = audit.username;
    const guide = await prisma.sallaSizeGuide.update({ where: { id }, data });
    return NextResponse.json({ success: true, guide, canPublish });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر تحديث دليل المقاسات' },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!(await authorize())) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  const { id } = await context.params;
  try {
    await prisma.sallaSizeGuide.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'تعذر حذف الدليل أو أنه غير موجود' }, { status: 404 });
  }
}
