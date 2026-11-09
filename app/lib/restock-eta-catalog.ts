import { listAllSallaProducts } from '@/app/lib/salla-api';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Slim Salla catalog snapshot for the restock-ETA page.
 *
 * Pulling the full catalog from Salla takes about a minute (≈1.4k products,
 * and Salla's paging returns overlapping pages, so several sort passes are
 * needed). The page therefore never waits on Salla: it reads this snapshot
 * from one Settings row, and the snapshot is rebuilt in the background.
 */

/** Compact product row: short keys keep the payload small on mobile. */
export type SlimProduct = {
  i: string; // id
  n: string; // name
  s: string; // sku
  m: string; // image url
  q: number | null; // available quantity
  o: boolean; // sold out
};

export type CatalogSnapshot = { at: number; products: SlimProduct[] };

const SNAPSHOT_KEY = 'restock-eta:catalog';
const LOCK_KEY = 'restock-eta:catalog-lock';
/** Snapshot older than this is served, then rebuilt in the background. */
export const CATALOG_STALE_MS = 15 * 60 * 1000;
/** A rebuild that started less than this long ago is assumed to still be running. */
const LOCK_TTL_MS = 4 * 60 * 1000;

export async function readCatalogSnapshot(): Promise<CatalogSnapshot | null> {
  const row = await prisma.settings.findUnique({
    where: { key: SNAPSHOT_KEY },
    select: { value: true },
  });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as CatalogSnapshot;
    return Array.isArray(parsed?.products) && typeof parsed.at === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export async function isCatalogRebuilding(): Promise<boolean> {
  const lock = await prisma.settings.findUnique({ where: { key: LOCK_KEY }, select: { value: true } });
  return !!lock && Date.now() - Number(lock.value) < LOCK_TTL_MS;
}

/**
 * Takes the rebuild lock atomically. Two instances asking at once cannot both
 * win: only one conditional update (or the create) succeeds.
 */
async function acquireLock(): Promise<boolean> {
  const now = Date.now();
  const taken = await prisma.settings.updateMany({
    where: { key: LOCK_KEY, value: { lt: String(now - LOCK_TTL_MS).padStart(13, '0') } },
    data: { value: String(now) },
  });
  if (taken.count === 1) return true;
  try {
    await prisma.settings.create({
      data: { key: LOCK_KEY, value: String(now), description: 'Restock-ETA catalog rebuild lock' },
    });
    return true;
  } catch {
    return false; // row exists and lock is held
  }
}

async function releaseLock() {
  await prisma.settings
    .update({ where: { key: LOCK_KEY }, data: { value: '0' } })
    .catch(() => undefined);
}

function slim(products: Awaited<ReturnType<typeof listAllSallaProducts>>['products']): SlimProduct[] {
  return products
    .filter((product) => product.status !== 'hidden' && product.status !== 'deleted')
    .map((product) => {
      const quantity = typeof product.availableQuantity === 'number' ? product.availableQuantity : null;
      return {
        i: String(product.id),
        n: product.name || '',
        s: product.sku || '',
        m: product.imageUrl || '',
        q: quantity,
        o: product.status === 'out' || (quantity !== null && quantity <= 0),
      };
    });
}

/** Rebuilds the snapshot from Salla unless another rebuild is already running. */
export async function rebuildCatalogSnapshot(): Promise<void> {
  if (!(await acquireLock())) return;
  const startedAt = Date.now();
  try {
    const resolved = await resolveSallaMerchantId(null);
    if (!resolved.merchantId) throw new Error(resolved.error || 'No Salla merchant');
    const { products, complete } = await listAllSallaProducts(resolved.merchantId);
    const snapshot: CatalogSnapshot = { at: Date.now(), products: slim(products) };
    // Never replace a full snapshot with a partial one from a flaky Salla run.
    const previous = complete ? null : await readCatalogSnapshot();
    if (previous && previous.products.length > snapshot.products.length) {
      log.warn('Restock-ETA catalog rebuild was incomplete; keeping previous snapshot', {
        fetched: snapshot.products.length,
        previous: previous.products.length,
      });
      return;
    }
    const value = JSON.stringify(snapshot);
    await prisma.settings.upsert({
      where: { key: SNAPSHOT_KEY },
      create: { key: SNAPSHOT_KEY, value, description: 'Restock-ETA page catalog snapshot' },
      update: { value },
    });
    log.info('Restock-ETA catalog rebuilt', {
      products: snapshot.products.length,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    log.error('Restock-ETA catalog rebuild failed', { error });
  } finally {
    await releaseLock();
  }
}
