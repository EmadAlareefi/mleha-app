import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  parseSizeGuideImport,
  sizeGuideAudit,
  SIZE_GUIDE_IMPORT_MAX_BYTES,
  SIZE_GUIDE_SERVICE_KEY,
} from '@/app/lib/salla-size-guides';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function issuePreview(result: ReturnType<typeof parseSizeGuideImport>) {
  return result.guides
    .filter((guide) => guide.issues.length > 0)
    .map((guide) => ({
      sku: guide.sku,
      canPublish: guide.canPublish,
      rows: guide.data.rows.length,
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
    const mode = String(form.get('mode') || 'preview');
    const publishValid = String(form.get('publishValid') || '') === 'true';

    if (mode !== 'commit') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        sheetName: result.sheetName,
        summary: result.summary,
        skippedRows: result.skippedRows,
        issueGuides: issuePreview(result),
      });
    }

    const audit = sizeGuideAudit(session.user);
    const importedAt = new Date();
    const operations = result.guides.map((guide) => {
      const common = {
        sku: guide.sku,
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
      imported: result.guides.length,
      published: publishValid ? result.summary.publishable : 0,
      summary: result.summary,
      skippedRows: result.skippedRows,
      issueGuides: issuePreview(result),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر استيراد ملف المقاسات' },
      { status: 400 }
    );
  }
}
