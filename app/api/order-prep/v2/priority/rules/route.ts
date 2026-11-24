import { Prisma } from '@prisma/client';
import { NextResponse, after } from 'next/server';
import { log } from '@/app/lib/logger';
import {
  CATALOG_STALE_MS,
  isPriorityCatalogRebuilding,
  readPriorityCatalog,
  rebuildPriorityCatalog,
} from '@/app/lib/order-prep/priority-catalog';
import {
  getPriorityConfig,
  loadResolveSources,
  resolvePriority,
  ruleState,
  sanitizePriorityConfig,
  savePriorityConfig,
} from '@/app/lib/order-prep/priority-rules';
import { MERCHANT_ID, previewQueue } from '@/app/lib/order-prep/queue';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { getPrepSettings, sanitizePrepSettingsPatch, updatePrepSettings } from '@/app/lib/order-prep/settings';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A catalog rebuild runs after the response and takes about a minute.
export const maxDuration = 300;

async function preview(rawConfig: unknown) {
  const config = sanitizePriorityConfig(rawConfig);
  const nowMs = Date.now();
  const resolved = resolvePriority(config, await loadResolveSources(config.rules, nowMs), nowMs);
  const result = await previewQueue(resolved);
  return {
    ...result,
    emptyRules: resolved.empty,
    /** live / off / expired / outside_window, per rule, right now (Riyadh time). */
    ruleStates: Object.fromEntries(config.rules.map((rule) => [rule.id, ruleState(rule, nowMs)])),
  };
}

/** Busiest values of a column on recent orders, for the pickers. */
async function recentValues(column: 'fulfillmentCompany' | 'customerCity' | 'paymentMethod', limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT ${Prisma.raw(`"${column}"`)} AS "value"
    FROM "SallaOrder"
    WHERE "merchantId" = ${MERCHANT_ID} AND ${Prisma.raw(`"${column}"`)} IS NOT NULL AND ${Prisma.raw(`"${column}"`)} <> ''
      AND "placedAt" > now() - interval '60 days'
    GROUP BY 1 ORDER BY count(*) DESC LIMIT ${limit}`;
  return rows.map((row) => row.value);
}

/** Priority tab of the warehouse dashboard: rules, campaign mode, pickers' data, live preview. */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const [config, settings, catalog, rebuilding, companies, cities, paymentMethods] = await Promise.all([
      getPriorityConfig({ fresh: true }),
      getPrepSettings({ fresh: true }),
      readPriorityCatalog({ fresh: true }),
      isPriorityCatalogRebuilding(),
      recentValues('fulfillmentCompany', 30),
      // Profile cities share the shipping address's spelling; good enough as suggestions.
      recentValues('customerCity', 60),
      recentValues('paymentMethod', 20),
    ]);
    const stale = !catalog || Date.now() - catalog.at > CATALOG_STALE_MS;
    if (stale && !rebuilding) after(() => rebuildPriorityCatalog());
    return NextResponse.json({
      success: true,
      config,
      campaign: { priorityMode: settings.priorityMode, promoAgingHours: settings.promoAgingHours },
      catalog: {
        at: catalog?.at ?? null,
        rebuilding: rebuilding || stale,
        categories: catalog?.categories ?? [],
      },
      companies,
      cities,
      paymentMethods,
      preview: await preview(config),
    });
  } catch (error) {
    log.error('Prep priority rules load failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الأولويات' }, { status: 500 });
  }
}

/**
 * { action: 'preview', config } → the queue under a draft, nothing saved.
 * { action: 'save', config, baseUpdatedAt, campaign? } → saves the rules (and campaign mode).
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    if (body.action === 'preview') {
      return NextResponse.json({ success: true, preview: await preview(body.config) });
    }
    if (body.action !== 'save') return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });

    const baseUpdatedAt = typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
    const result = await savePriorityConfig(body.config, auth.actor, baseUpdatedAt);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          config: result.config,
          error: `عدّل ${result.config.updatedByName ?? 'مشرف آخر'} الأولويات قبل قليل. حمّلنا نسخته — راجعها ثم احفظ من جديد.`,
        },
        { status: 409 },
      );
    }
    const campaign = body.campaign && typeof body.campaign === 'object' ? sanitizePrepSettingsPatch(body.campaign as Record<string, unknown>) : {};
    const patch = { priorityMode: campaign.priorityMode, promoAgingHours: campaign.promoAgingHours };
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const settings = Object.keys(cleanPatch).length ? await updatePrepSettings(cleanPatch) : await getPrepSettings({ fresh: true });
    log.info('Prep priority rules saved', {
      by: auth.actor.name,
      rules: result.config.rules.length,
      sort: result.config.sort,
      maxWaitHours: result.config.maxWaitHours,
      priorityMode: settings.priorityMode,
    });
    return NextResponse.json({
      success: true,
      message: 'حُفظت الأولويات — تسري على الطلبات التالية لكل مجهِّز',
      config: result.config,
      campaign: { priorityMode: settings.priorityMode, promoAgingHours: settings.promoAgingHours },
      preview: await preview(result.config),
    });
  } catch (error) {
    log.error('Prep priority rules action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  }
}
