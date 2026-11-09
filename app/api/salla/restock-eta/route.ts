import { getServerSession } from 'next-auth';
import { after, NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import {
  addDays,
  dateColumnToIso,
  daysBetween,
  isIsoDate,
  isoToDateColumn,
  riyadhToday,
  RESTOCK_ETA_MAX_DAYS,
  RESTOCK_ETA_SERVICE_KEY,
} from '@/app/lib/restock-eta';
import {
  CATALOG_STALE_MS,
  isCatalogRebuilding,
  readCatalogSnapshot,
  rebuildCatalogSnapshot,
} from '@/app/lib/restock-eta-catalog';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
// A catalog rebuild runs after the response via after(); Salla needs ~1 min.
export const maxDuration = 300;

async function authorize() {
  const session = await getServerSession(authOptions);
  return { session, allowed: hasServiceAccess(session, RESTOCK_ETA_SERVICE_KEY) };
}

const FORBIDDEN = { error: 'غير مصرح لك بإدارة مواعيد التوفر' };

async function loadEtas(): Promise<Record<string, string>> {
  const rows = await prisma.sallaProductRestockEta.findMany({
    select: { productId: true, expectedAt: true },
  });
  const etas: Record<string, string> = {};
  for (const row of rows) etas[row.productId] = dateColumnToIso(row.expectedAt);
  return etas;
}

/**
 * GET              → { products, etas, today, catalogAt, rebuilding }
 * GET ?etas=1      → { etas, today } (cheap; no catalog)
 * GET ?refresh=1   → also start a catalog rebuild now
 *
 * Never waits on Salla. A missing or stale catalog is rebuilt after the
 * response is sent; the client polls while `rebuilding` is true.
 */
export async function GET(request: NextRequest) {
  const { allowed } = await authorize();
  if (!allowed) return NextResponse.json(FORBIDDEN, { status: 403 });

  const params = request.nextUrl.searchParams;
  const today = riyadhToday();
  const headers = { 'Cache-Control': 'private, no-store' };

  try {
    if (params.get('etas') === '1') {
      return NextResponse.json({ success: true, etas: await loadEtas(), today }, { headers });
    }

    const [snapshot, etas, lockHeld] = await Promise.all([
      readCatalogSnapshot(),
      loadEtas(),
      isCatalogRebuilding(),
    ]);

    const wantsRebuild =
      params.get('refresh') === '1' || !snapshot || Date.now() - snapshot.at > CATALOG_STALE_MS;
    if (wantsRebuild && !lockHeld) after(rebuildCatalogSnapshot);

    return NextResponse.json(
      {
        success: true,
        products: snapshot?.products ?? [],
        catalogAt: snapshot?.at ?? null,
        rebuilding: lockHeld || wantsRebuild,
        etas,
        today,
      },
      { headers }
    );
  } catch (error) {
    log.error('Failed to load restock ETA page data', { error });
    return NextResponse.json({ error: 'تعذر تحميل البيانات' }, { status: 500 });
  }
}

type SaveItem = { productId: string; productName?: string; productSku?: string };

function parseItems(value: unknown): SaveItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('اختر منتجاً واحداً على الأقل');
  if (value.length > 500) throw new Error('يمكن تحديث 500 منتج كحد أقصى في المرة الواحدة');
  const seen = new Set<string>();
  const items: SaveItem[] = [];
  for (const raw of value) {
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const productId = String(record.productId ?? '').trim();
    if (!/^\d{1,32}$/.test(productId)) throw new Error('رقم منتج غير صالح');
    if (seen.has(productId)) continue;
    seen.add(productId);
    items.push({
      productId,
      productName: typeof record.productName === 'string' ? record.productName.slice(0, 250) : undefined,
      productSku: typeof record.productSku === 'string' ? record.productSku.slice(0, 120) : undefined,
    });
  }
  return items;
}

/**
 * POST { items: [{ productId, productName?, productSku? }], expectedDate: 'YYYY-MM-DD' | null }
 * A null date clears the ETA for every listed product.
 */
export async function POST(request: NextRequest) {
  const { session, allowed } = await authorize();
  if (!allowed) return NextResponse.json(FORBIDDEN, { status: 403 });

  let items: SaveItem[];
  let expectedDate: string | null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    items = parseItems(body.items);
    if (body.expectedDate === null) {
      expectedDate = null;
    } else if (isIsoDate(body.expectedDate)) {
      expectedDate = body.expectedDate;
      const today = riyadhToday();
      const days = daysBetween(today, expectedDate);
      if (days < 1) throw new Error('اختر تاريخاً بعد اليوم');
      if (days > RESTOCK_ETA_MAX_DAYS) {
        throw new Error(`أقصى مدة ${RESTOCK_ETA_MAX_DAYS} يوماً (حتى ${addDays(today, RESTOCK_ETA_MAX_DAYS)})`);
      }
    } else {
      throw new Error('تاريخ غير صالح');
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'طلب غير صالح' },
      { status: 400 }
    );
  }

  const productIds = items.map((item) => item.productId);
  try {
    if (expectedDate === null) {
      await prisma.sallaProductRestockEta.deleteMany({ where: { productId: { in: productIds } } });
    } else {
      const user = (session?.user || {}) as Record<string, unknown>;
      const updatedById = typeof user.id === 'string' ? user.id : null;
      const updatedByName =
        typeof user.name === 'string' ? user.name : typeof user.username === 'string' ? user.username : null;
      const expectedAt = isoToDateColumn(expectedDate);
      await prisma.$transaction(
        items.map((item) =>
          prisma.sallaProductRestockEta.upsert({
            where: { productId: item.productId },
            create: {
              productId: item.productId,
              expectedAt,
              productName: item.productName,
              productSku: item.productSku,
              updatedById,
              updatedByName,
            },
            update: {
              expectedAt,
              ...(item.productName ? { productName: item.productName } : {}),
              ...(item.productSku ? { productSku: item.productSku } : {}),
              updatedById,
              updatedByName,
            },
          })
        )
      );
    }
    return NextResponse.json({ success: true, productIds, expectedDate });
  } catch (error) {
    log.error('Failed to save restock ETA', { error, count: productIds.length });
    return NextResponse.json({ error: 'تعذر حفظ موعد التوفر' }, { status: 500 });
  }
}
