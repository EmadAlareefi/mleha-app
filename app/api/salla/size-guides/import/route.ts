import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { reconcileSizeGuideRows } from '@/app/lib/salla-size-guide-products';
import { loadSallaSizeGuideProduct } from '@/app/lib/salla-size-guide-server';
import {
  parseSizeGuideImport,
  sizeGuideAudit,
  sizeGuideSkuKey,
  validateSizeGuideDocument,
  SIZE_GUIDE_IMPORT_MAX_BYTES,
  SIZE_GUIDE_SERVICE_KEY,
  type ImportedSizeGuide,
  type SizeGuideIssue,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const MAX_IMPORT_GUIDES = 100;
const SALLA_CONCURRENCY = 5;

type PreparedGuide = ImportedSizeGuide & {
  productName: string | null;
  productImageUrl: string | null;
  sallaBlocked: boolean;
};

async function prepareGuides(merchantId: string, guides: ImportedSizeGuide[]): Promise<PreparedGuide[]> {
  const prepared = new Array<PreparedGuide>(guides.length);
  let index = 0;

  async function worker() {
    while (index < guides.length) {
      const currentIndex = index++;
      const guide = guides[currentIndex];
      try {
        const product = await loadSallaSizeGuideProduct(merchantId, { productId: guide.productId });
        const issues = [...guide.issues];
        if (sizeGuideSkuKey(product.sku) !== guide.skuKey) {
          issues.unshift({
            severity: 'error',
            code: 'salla_sku_mismatch',
            message: `SKU الملف (${guide.sku}) لا يطابق SKU منتج سلة (${product.sku})`,
            field: 'SKU',
          });
        }
        const labels = product.sizeOption.values.map((value) => value.label);
        const reconciled = reconcileSizeGuideRows(guide.data.rows, labels);
        if (reconciled.added.length || reconciled.removed.length) {
          issues.unshift({
            severity: 'error',
            code: 'salla_size_mismatch',
            message: [
              reconciled.added.length ? `مقاسات ناقصة: ${reconciled.added.join('، ')}` : '',
              reconciled.removed.length ? `مقاسات زائدة: ${reconciled.removed.map((row) => row.size).join('، ')}` : '',
            ].filter(Boolean).join('؛ '),
            field: 'Size',
          });
        }
        const sallaBlocked = issues.some((issue) =>
          issue.code.startsWith('salla_') || issue.code === 'product_id_collision' || issue.code === 'sku_collision'
        );
        const validated = validateSizeGuideDocument({
          ...guide.data,
          sallaSizeOptionId: product.sizeOption.id,
          rows: reconciled.rows,
        });
        const validationIssues = issues.filter((issue) => issue.code.startsWith('salla_'));
        prepared[currentIndex] = {
          ...guide,
          sku: product.sku,
          skuKey: sizeGuideSkuKey(product.sku),
          productName: product.name,
          productImageUrl: product.imageUrl,
          data: validated.data,
          issues: [...validationIssues, ...validated.issues],
          canPublish: !sallaBlocked && validated.canPublish,
          sallaBlocked,
        };
      } catch (error) {
        const issue: SizeGuideIssue = {
          severity: 'error',
          code: 'salla_product_error',
          message: error instanceof Error ? error.message : 'تعذر التحقق من منتج سلة',
          field: 'SKU',
        };
        prepared[currentIndex] = {
          ...guide,
          productImageUrl: null,
          issues: [issue, ...guide.issues],
          canPublish: false,
          sallaBlocked: true,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SALLA_CONCURRENCY, guides.length) }, () => worker()));

  const usedProductIds = new Map<string, number>();
  prepared.forEach((guide, guideIndex) => {
    const previous = usedProductIds.get(guide.productId);
    if (previous == null) {
      usedProductIds.set(guide.productId, guideIndex);
      return;
    }
    const issue: SizeGuideIssue = {
      severity: 'error',
      code: 'salla_product_duplicate',
      message: 'رقم منتج سلة مكرر لأكثر من SKU داخل الملف',
      field: 'SKU',
    };
    [previous, guideIndex].forEach((target) => {
      prepared[target].issues = [issue, ...prepared[target].issues];
      prepared[target].canPublish = false;
      prepared[target].sallaBlocked = true;
    });
  });
  return prepared;
}

function issuePreview(guides: PreparedGuide[]) {
  return guides.filter((guide) => guide.issues.length > 0).map((guide) => ({
    sku: guide.sku,
    canPublish: guide.canPublish,
    rows: guide.data.rows.length,
    sallaBlocked: guide.sallaBlocked,
    issues: guide.issues,
  }));
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasServiceAccess(session, SIZE_GUIDE_SERVICE_KEY)) {
    return NextResponse.json({ error: 'غير مصرح لك باستيراد أدلة المقاسات' }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('اختر ملف XLSX أو CSV');
    if (file.size > SIZE_GUIDE_IMPORT_MAX_BYTES) throw new Error('حجم الملف يتجاوز 5 ميجابايت');
    if (!/\.(?:xlsx?|csv)$/i.test(file.name)) throw new Error('صيغة الملف يجب أن تكون XLSX أو CSV');

    const result = parseSizeGuideImport(Buffer.from(await file.arrayBuffer()), file.name);
    if (result.guides.length > MAX_IMPORT_GUIDES) {
      throw new Error(`الحد الأعلى للاستيراد هو ${MAX_IMPORT_GUIDES} منتج في الملف الواحد`);
    }
    const mode = String(form.get('mode') || 'preview');
    const publishValid = String(form.get('publishValid') || '') === 'true';
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) throw new Error(merchant.error);
    const prepared = await prepareGuides(merchant.merchantId, result.guides);
    const existingLinks = await prisma.sallaSizeGuide.findMany({
      where: {
        OR: [
          { productId: { in: prepared.map((guide) => guide.productId) } },
          { skuKey: { in: prepared.map((guide) => guide.skuKey) } },
        ],
      },
      select: { productId: true, skuKey: true },
    });
    prepared.forEach((guide) => {
      const conflict = existingLinks.some((existing) =>
        (existing.productId === guide.productId && existing.skuKey !== guide.skuKey) ||
        (existing.skuKey === guide.skuKey && Boolean(existing.productId) && existing.productId !== guide.productId)
      );
      if (!conflict) return;
      guide.issues = [{
        severity: 'error',
        code: 'salla_existing_link_conflict',
        message: 'المنتج أو SKU مرتبط مسبقاً بدليل آخر',
        field: 'SKU',
      }, ...guide.issues];
      guide.canPublish = false;
      guide.sallaBlocked = true;
    });
    const importable = prepared.filter((guide) => !guide.sallaBlocked);
    const publishable = importable.filter((guide) => guide.canPublish).length;
    const summary = {
      ...result.summary,
      guides: prepared.length,
      importable: importable.length,
      sallaBlocked: prepared.length - importable.length,
      publishable,
      blocked: prepared.length - publishable,
      warnings: prepared.reduce(
        (total, guide) => total + guide.issues.filter((issue) => issue.severity === 'warning').length,
        0
      ),
    };

    if (mode !== 'commit') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        sheetName: result.sheetName,
        summary,
        skippedRows: result.skippedRows,
        issueGuides: issuePreview(prepared),
      });
    }

    const audit = sizeGuideAudit(session.user);
    const importedAt = new Date();
    const committable = importable;
    const operations = committable.map((guide) => {
      const common = {
        sku: guide.sku,
        productId: guide.productId,
        productName: guide.productName,
        productImageUrl: guide.productImageUrl,
        draftData: json(guide.data),
        validationIssues: json(guide.issues),
        hasIssues: guide.issues.length > 0,
        sourceFileName: file.name.slice(0, 250),
        lastImportedAt: importedAt,
        updatedById: audit.id,
        updatedByName: audit.name,
        updatedByUsername: audit.username,
      };
      const publish = publishValid && guide.canPublish
        ? {
            publishedData: json(guide.data),
            publishedAt: importedAt,
            publishedById: audit.id,
            publishedByName: audit.name,
            publishedByUsername: audit.username,
          }
        : {};

      return prisma.sallaSizeGuide.upsert({
        where: { skuKey: guide.skuKey },
        create: {
          ...common,
          ...publish,
          skuKey: guide.skuKey,
          createdById: audit.id,
          createdByName: audit.name,
          createdByUsername: audit.username,
        },
        update: { ...common, ...publish },
      });
    });

    await prisma.$transaction(operations);
    return NextResponse.json({
      success: true,
      mode: 'commit',
      imported: committable.length,
      published: publishValid ? committable.filter((guide) => guide.canPublish).length : 0,
      summary: { ...summary, imported: committable.length },
      skippedRows: result.skippedRows,
      issueGuides: issuePreview(prepared),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر استيراد ملف المقاسات' },
      { status: 400 }
    );
  }
}
