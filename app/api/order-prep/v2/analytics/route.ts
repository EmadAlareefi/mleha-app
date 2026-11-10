import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { drill } from '@/app/lib/analytics/engine';
import { getOrderItemsDetail } from '@/app/lib/analytics/order-items';
import { resolvePeriod } from '@/app/lib/analytics/period';
import type { DrillFilter } from '@/app/lib/analytics/types';
import { PREP_METRICS, getPrepAnalytics, getPrepFacts } from '@/app/lib/order-prep/analytics';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { SHIPPING_METRICS, getShippingAnalytics, getShippingFacts } from '@/app/lib/shipping/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Board analytics (prep and shipping boards).
 *   ?kind=prep|shipping&view=summary&preset=today|yesterday|7d|custom&from&to
 *   …&view=orders&metric&subset&bucket&person&sort&offset — the orders behind a number
 *   ?view=items&orderId — one order's items
 */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const url = new URL(request.url);
    const param = (name: string) => url.searchParams.get(name)?.trim() || null;
    const view = param('view') ?? 'summary';

    if (view === 'items') {
      const orderId = param('orderId');
      if (!orderId) return NextResponse.json({ success: false, error: 'رقم الطلب مطلوب' }, { status: 400 });
      const detail = await getOrderItemsDetail(orderId);
      return NextResponse.json({ success: Boolean(detail), detail, error: detail ? undefined : 'الطلب غير موجود' });
    }

    const kind = param('kind') === 'shipping' ? 'shipping' : 'prep';
    const period = resolvePeriod({ preset: param('preset'), from: param('from'), to: param('to') });

    if (view === 'orders') {
      const filter: DrillFilter = {
        metric: param('metric') ?? (kind === 'prep' ? 'pack' : 'gap'),
        subset: param('subset') ?? undefined,
        bucket: param('bucket') ?? undefined,
        person: param('person') ?? undefined,
      };
      const facts = kind === 'prep' ? await getPrepFacts(period) : await getShippingFacts(period);
      const result = drill(facts, kind === 'prep' ? PREP_METRICS : SHIPPING_METRICS, filter, {
        sort: param('sort') === 'time' ? 'time' : 'duration',
        offset: Number.parseInt(param('offset') ?? '0', 10) || 0,
      });
      return NextResponse.json({ success: true, result });
    }

    const summary = kind === 'prep' ? await getPrepAnalytics(period) : await getShippingAnalytics(period);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    log.error('Board analytics failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل التحليلات' }, { status: 500 });
  }
}
