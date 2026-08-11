import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import {
  loadSallaSizeGuideProduct,
  validateDocumentAgainstSallaProduct,
} from '@/app/lib/salla-size-guide-server';
import {
  parseSizeGuideDocument,
  sizeGuideAudit,
  SIZE_GUIDE_SERVICE_KEY,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
const MAX_IDS = 100;
const CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك بنشر أدلة المقاسات' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? Array.from(new Set<string>(body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0))).slice(0, MAX_IDS)
    : [];
  if (!ids.length) return NextResponse.json({ error: 'حدد دليلاً واحداً على الأقل' }, { status: 400 });

  const merchant = await resolveSallaMerchantId();
  if (!merchant.merchantId) return NextResponse.json({ error: merchant.error }, { status: 503 });
  const guides = await prisma.sallaSizeGuide.findMany({ where: { id: { in: ids } } });
  const audit = sizeGuideAudit(session.user);
  const published: string[] = [];
  const skipped: Array<{ id: string; sku: string; message: string }> = [];
  let index = 0;

  async function worker() {
    while (index < guides.length) {
      const guide = guides[index++];
      try {
        if (!guide.productId) throw new Error('الدليل غير مربوط بمنتج سلة');
        const document = parseSizeGuideDocument(guide.draftData);
        const product = await loadSallaSizeGuideProduct(merchant.merchantId!, {
          productId: guide.productId,
          optionId: document.sallaSizeOptionId,
        });
        const validated = validateDocumentAgainstSallaProduct(document, product);
        if (!validated.canPublish) throw new Error('صحح أخطاء الدليل قبل النشر');
        await prisma.sallaSizeGuide.update({
          where: { id: guide.id },
          data: {
            productName: product.name,
            productImageUrl: product.imageUrl,
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
        published.push(guide.id);
      } catch (error) {
        skipped.push({
          id: guide.id,
          sku: guide.sku,
          message: error instanceof Error ? error.message : 'تعذر النشر',
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, guides.length) }, () => worker()));
  ids.filter((id) => !guides.some((guide) => guide.id === id)).forEach((id) => {
    skipped.push({ id, sku: '', message: 'الدليل غير موجود' });
  });

  return NextResponse.json({ success: true, published, skipped });
}
