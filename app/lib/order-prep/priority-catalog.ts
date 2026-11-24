import { listAllSallaProducts } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Product catalog snapshot for the prep-priority rules: every product with its
 * categories, so a «category» rule can be turned into product ids the queue
 * can match against SallaOrderItem.productId. Order payloads carry no
 * categories, and pulling the catalog from Salla takes about a minute, so the
 * queue reads this snapshot (one Settings row) and it is rebuilt in the
 * background.
 */

export type CatalogCategory = { id: string; name: string; parentId: string | null; products: number };
/** Compact product row: short keys keep the Settings row small. */
export type CatalogProduct = { i: string; n: string; s: string; c: string[] };
export type PriorityCatalog = { at: number; categories: CatalogCategory[]; products: CatalogProduct[] };

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const SNAPSHOT_KEY = 'order_prep:priority_catalog';
const LOCK_KEY = 'order_prep:priority_catalog_lock';
/** Older than this, the priority page asks for a background rebuild. */
export const CATALOG_STALE_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 4 * 60 * 1000;
const MEMORY_TTL_MS = 60_000;

let memory: { at: number; value: PriorityCatalog | null } | null = null;

export async function readPriorityCatalog(options: { fresh?: boolean } = {}): Promise<PriorityCatalog | null> {
  if (!options.fresh && memory && Date.now() - memory.at < MEMORY_TTL_MS) return memory.value;
  const row = await prisma.settings.findUnique({ where: { key: SNAPSHOT_KEY }, select: { value: true } });
  let value: PriorityCatalog | null = null;
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as PriorityCatalog;
      if (typeof parsed?.at === 'number' && Array.isArray(parsed.products) && Array.isArray(parsed.categories)) value = parsed;
    } catch {
      value = null;
    }
  }
  memory = { at: Date.now(), value };
  return value;
}

/** Category ids plus every sub-category under them. */
export function withDescendants(categoryIds: string[], categories: CatalogCategory[]): Set<string> {
  const result = new Set(categoryIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId && result.has(category.parentId) && !result.has(category.id)) {
        result.add(category.id);
        grew = true;
      }
    }
  }
  return result;
}

/** Product ids listed in any of the categories (or their sub-categories). */
export function productIdsForCategories(categoryIds: string[], catalog: PriorityCatalog | null): string[] {
  if (!catalog || categoryIds.length === 0) return [];
  const wanted = withDescendants(categoryIds, catalog.categories);
  return catalog.products.filter((product) => product.c.some((id) => wanted.has(id))).map((product) => product.i);
}

export function buildCatalog(products: Awaited<ReturnType<typeof listAllSallaProducts>>['products'], at = Date.now()): PriorityCatalog {
  const categories = new Map<string, CatalogCategory>();
  const rows: CatalogProduct[] = [];
  for (const product of products) {
    if (product.status === 'deleted') continue;
    const ids: string[] = [];
    for (const category of product.categories ?? []) {
      ids.push(category.id);
      const known = categories.get(category.id);
      if (known) known.products += 1;
      else categories.set(category.id, { id: category.id, name: category.name, parentId: category.parentId, products: 1 });
    }
    rows.push({ i: String(product.id), n: product.name || '', s: product.sku || '', c: ids });
  }
  return {
    at,
    categories: [...categories.values()].sort((a, b) => b.products - a.products),
    products: rows,
  };
}

export async function isPriorityCatalogRebuilding(): Promise<boolean> {
  const lock = await prisma.settings.findUnique({ where: { key: LOCK_KEY }, select: { value: true } });
  return !!lock && Date.now() - Number(lock.value) < LOCK_TTL_MS;
}

/** Takes the rebuild lock atomically: only one conditional update (or the create) wins. */
async function acquireLock(): Promise<boolean> {
  const now = Date.now();
  const taken = await prisma.settings.updateMany({
    where: { key: LOCK_KEY, value: { lt: String(now - LOCK_TTL_MS).padStart(13, '0') } },
    data: { value: String(now) },
  });
  if (taken.count === 1) return true;
  try {
    await prisma.settings.create({ data: { key: LOCK_KEY, value: String(now), description: 'Prep priority catalog rebuild lock' } });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock() {
  await prisma.settings.update({ where: { key: LOCK_KEY }, data: { value: '0' } }).catch(() => undefined);
}

/** Rebuilds the snapshot from Salla unless another rebuild is already running. */
export async function rebuildPriorityCatalog(): Promise<void> {
  if (!(await acquireLock())) return;
  const startedAt = Date.now();
  try {
    const { products, complete } = await listAllSallaProducts(MERCHANT_ID);
    const catalog = buildCatalog(products);
    // Never replace a full snapshot with a partial one from a flaky Salla run.
    const previous = complete ? null : await readPriorityCatalog({ fresh: true });
    if (previous && previous.products.length > catalog.products.length) {
      log.warn('Prep priority catalog rebuild was incomplete; keeping previous snapshot', {
        fetched: catalog.products.length,
        previous: previous.products.length,
      });
      return;
    }
    const value = JSON.stringify(catalog);
    await prisma.settings.upsert({
      where: { key: SNAPSHOT_KEY },
      create: { key: SNAPSHOT_KEY, value, description: 'Order prep priority rules: product categories snapshot' },
      update: { value },
    });
    memory = null;
    log.info('Prep priority catalog rebuilt', {
      products: catalog.products.length,
      categories: catalog.categories.length,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    log.error('Prep priority catalog rebuild failed', { error: error instanceof Error ? error.message : error });
  } finally {
    await releaseLock();
  }
}
