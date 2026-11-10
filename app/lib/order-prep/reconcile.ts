import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { MERCHANT_ID } from './queue';
import { fetchLiveOrder, refreshMirrorFromLive } from './salla-live';
import { NEW_ORDER_STATUS_ID } from './sync-rules';

/**
 * Keeps the local mirror honest for the prep queue, on a fixed small budget of
 * Salla calls (never on a packer's path):
 * - recent (every 10 min): the newest "طلب جديد" orders in Salla that the
 *   mirror is missing (a lost order.created webhook) are fetched and stored.
 * - full (nightly): every "طلب جديد" page; also re-checks mirror rows that say
 *   "طلب جديد" but that Salla no longer lists.
 * Each claimed order is also checked live before packing (verify.ts).
 */

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';
const PER_PAGE = 30; // Salla's documented maximum for List Orders

type ListPage = { ids: string[]; totalPages: number | null } | { error: string; status?: number };

async function fetchNewOrdersPage(token: string, page: number, sort: 'created_at-asc' | 'created_at-desc'): Promise<ListPage> {
  const url = `${SALLA_API_BASE}/orders?status=${NEW_ORDER_STATUS_ID}&per_page=${PER_PAGE}&page=${page}&sort_by=${sort}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!response.ok) return { error: `salla_${response.status}`, status: response.status };
    const body = await response.json();
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    const pagination = body?.pagination ?? {};
    const totalPages =
      typeof pagination.totalPages === 'number'
        ? pagination.totalPages
        : typeof pagination.total_pages === 'number'
          ? pagination.total_pages
          : typeof pagination.total === 'number' && typeof pagination.perPage === 'number' && pagination.perPage > 0
            ? Math.ceil(pagination.total / pagination.perPage)
            : null;
    return { ids: rows.map((row) => String(row?.id ?? '')).filter(Boolean), totalPages };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

async function refreshOrders(orderIds: string[], cap: number) {
  let refreshed = 0;
  for (const orderId of orderIds.slice(0, cap)) {
    const live = await fetchLiveOrder(MERCHANT_ID, orderId, { withItems: true, timeoutMs: 12_000 });
    if (live.kind === 'rate_limited') break;
    if (live.kind !== 'ok') continue;
    await refreshMirrorFromLive(MERCHANT_ID, live.detail);
    refreshed += 1;
  }
  return refreshed;
}

export async function reconcileNewOrders(mode: 'recent' | 'full') {
  const token = await getSallaAccessToken(MERCHANT_ID);
  if (!token) return { ok: false, error: 'missing_salla_token' };

  const maxPages = mode === 'recent' ? 2 : 120;
  const sort = mode === 'recent' ? 'created_at-desc' : 'created_at-asc';
  const liveIds = new Set<string>();
  let pages = 0;
  let complete = true;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchNewOrdersPage(token, page, sort);
    if ('error' in result) {
      log.warn('Order prep reconcile could not read Salla orders', { page, error: result.error });
      complete = false;
      break;
    }
    pages += 1;
    result.ids.forEach((id) => liveIds.add(id));
    if (result.ids.length < PER_PAGE || (result.totalPages !== null && page >= result.totalPages)) break;
    if (page === maxPages) complete = mode === 'recent';
  }

  const known = await prisma.sallaOrder.findMany({
    where: { merchantId: MERCHANT_ID, orderId: { in: [...liveIds] } },
    select: { orderId: true },
  });
  const knownIds = new Set(known.map((row) => row.orderId));
  const missing = [...liveIds].filter((id) => !knownIds.has(id));
  const added = await refreshOrders(missing, mode === 'recent' ? 10 : 100);

  let corrected = 0;
  if (mode === 'full' && complete) {
    // Mirror says "طلب جديد" but Salla's full list doesn't have it: re-read it.
    const stale = await prisma.sallaOrder.findMany({
      where: { merchantId: MERCHANT_ID, statusCustomId: NEW_ORDER_STATUS_ID, orderId: { notIn: [...liveIds] } },
      select: { orderId: true },
      take: 200,
    });
    corrected = await refreshOrders(
      stale.map((row) => row.orderId),
      100,
    );
  }

  const summary = { ok: true, mode, pages, liveNewOrders: liveIds.size, missing: missing.length, added, corrected };
  if (missing.length > 0 || corrected > 0) log.info('Order prep reconcile fixed the mirror', summary);
  return summary;
}
