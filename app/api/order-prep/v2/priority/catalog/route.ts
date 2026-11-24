import { NextResponse, after } from 'next/server';
import { log } from '@/app/lib/logger';
import { isPriorityCatalogRebuilding, readPriorityCatalog, rebuildPriorityCatalog } from '@/app/lib/order-prep/priority-catalog';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Products (id, name, SKU) for the «specific products» picker. */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const catalog = await readPriorityCatalog({ fresh: true });
    return NextResponse.json({
      success: true,
      at: catalog?.at ?? null,
      products: (catalog?.products ?? []).map((product) => ({ id: product.i, name: product.n, sku: product.s })),
    });
  } catch (error) {
    log.error('Prep priority catalog read failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل المنتجات' }, { status: 500 });
  }
}

/** Re-pulls products and their categories from Salla in the background (about a minute). */
export async function POST() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  if (await isPriorityCatalogRebuilding()) {
    return NextResponse.json({ success: true, message: 'التحديث من سلة جارٍ بالفعل' });
  }
  after(() => rebuildPriorityCatalog());
  log.info('Prep priority catalog refresh requested', { by: auth.actor.name });
  return NextResponse.json({ success: true, message: 'بدأ تحديث التصنيفات والمنتجات من سلة (حوالي دقيقة)' });
}
