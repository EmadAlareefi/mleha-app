import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gift,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';

import { authOptions } from '@/app/lib/auth';
import {
  checkStorefrontBlocker,
  getPromoMonitorSnapshot,
  type PromoMonitorOrder,
  type StorefrontBlockerHealth,
} from '@/app/lib/promo-limit-monitor';
import { AutoRefresh } from '@/components/AutoRefresh';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const HOUR_MS = 60 * 60_000;
const LIVE_WINDOW_MS = 15 * 60_000;
const STALE_ORDERS_MS = 30 * 60_000;
const WINDOWS = [
  ['all', 'منذ بداية العرض'],
  ['24', 'آخر 24 ساعة'],
  ['6', 'آخر 6 ساعات'],
  ['1', 'آخر ساعة'],
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

const timeFormat = new Intl.DateTimeFormat('ar-SA', {
  timeZone: 'Asia/Riyadh',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat('ar-SA', {
  timeZone: 'Asia/Riyadh',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const hourFormat = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', hour: 'numeric' });

function formatAgo(date: Date | null, now: number): string {
  if (!date) return '—';
  const minutes = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes.toLocaleString('ar-SA')} د`;
  const hours = Math.floor(minutes / 60);
  return `قبل ${hours.toLocaleString('ar-SA')} س`;
}

const n = (value: number) => value.toLocaleString('ar-SA');

function reasonLabel(order: PromoMonitorOrder): string {
  if (order.reason === 'prior_order') {
    return order.firstOrderRef ? `حصل على العرض في طلب سابق #${order.firstOrderRef}` : 'حصل على العرض في طلب سابق';
  }
  if (order.reason === 'in_order') return `${n(order.promoUnits)} قطع عرض في نفس الطلب`;
  return '';
}

function BlockerStatus({ health }: { health: StorefrontBlockerHealth }) {
  const ok = health.state === 'ok';
  const unknown = health.state === 'unreachable';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-4',
        ok ? 'border-emerald-200 bg-emerald-50/60' : unknown ? 'border-amber-200 bg-amber-50/60' : 'border-rose-300 bg-rose-50'
      )}
    >
      <div className="min-w-0">
        <p className="font-medium">حاجز المتجر (mleha.com)</p>
        <p className={cn('mt-1 text-xs', ok ? 'text-emerald-700' : unknown ? 'text-amber-800' : 'text-rose-700')}>
          {health.detail}
        </p>
      </div>
      {ok ? (
        <ShieldCheck className="size-6 shrink-0 text-emerald-600" />
      ) : unknown ? (
        <AlertTriangle className="size-6 shrink-0 text-amber-600" />
      ) : (
        <ShieldAlert className="size-6 shrink-0 text-rose-600" />
      )}
    </div>
  );
}

export default async function PromoMonitorPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  const user = session.user as { role?: string; roles?: string[] };
  if (user.role !== 'admin' && !user.roles?.includes('admin')) redirect('/');

  const params = await searchParams;
  const requestedWindow = param(params.window) || 'all';
  const windowKey = WINDOWS.some(([value]) => value === requestedWindow) ? requestedWindow : 'all';
  const query = param(params.query).trim().slice(0, 60);

  const [snapshot, health] = await Promise.all([
    getPromoMonitorSnapshot(MERCHANT_ID),
    checkStorefrontBlocker(),
  ]);

  const now = Date.now();
  const windowStart = windowKey === 'all' ? 0 : now - Number(windowKey) * HOUR_MS;
  const inWindow = snapshot.orders.filter((order) => (order.placedAt?.getTime() ?? 0) >= windowStart);
  const active = inWindow.filter((order) => !order.cancelled);
  const violations = active.filter((order) => order.violation);
  const liveViolations = snapshot.orders.filter(
    (order) => order.violation && !order.cancelled && (order.placedAt?.getTime() ?? 0) >= now - LIVE_WINDOW_MS
  );
  const customersOver = new Set(violations.map((order) => order.customerKey)).size;
  const extraUnits = violations.reduce((sum, order) => sum + order.extraUnits, 0);
  const resolved = inWindow.filter((order) => order.cancelled).length;
  const lastOrderAt = snapshot.lastOrderAt ? new Date(snapshot.lastOrderAt) : null;
  const ordersStale = !lastOrderAt || now - lastOrderAt.getTime() > STALE_ORDERS_MS;
  const lastViolation = snapshot.orders
    .filter((order) => order.violation && !order.cancelled)
    .reduce<Date | null>((latest, order) => (order.placedAt && (!latest || order.placedAt > latest) ? order.placedAt : latest), null);

  const needle = query.toLowerCase();
  const matches = (order: PromoMonitorOrder) =>
    !needle ||
    [order.referenceId, order.orderId, order.customerName, order.customerMobile, order.customerEmail]
      .some((value) => value && value.toLowerCase().includes(needle));
  const violationRows = violations
    .filter(matches)
    .sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0))
    .slice(0, 300);
  const feed = [...snapshot.orders]
    .filter(matches)
    .sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0))
    .slice(0, 30);

  // Hourly buckets for the last 12 hours.
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const start = currentHour - (11 - index) * HOUR_MS;
    const orders = snapshot.orders.filter((order) => {
      const time = order.placedAt?.getTime() ?? 0;
      return !order.cancelled && time >= start && time < start + HOUR_MS;
    });
    return { start, ok: orders.filter((o) => !o.violation).length, over: orders.filter((o) => o.violation).length };
  });
  const bucketMax = Math.max(1, ...buckets.map((bucket) => bucket.ok + bucket.over));

  const kpis = [
    { label: 'طلبات فيها منتجات العرض', value: n(active.length), Icon: Gift, tone: 'text-slate-700' },
    {
      label: 'طلبات تجاوزت الحد',
      value: n(violations.length),
      Icon: XCircle,
      tone: violations.length ? 'text-rose-700' : 'text-emerald-700',
    },
    { label: 'عملاء تجاوزوا الحد', value: n(customersOver), Icon: Users, tone: customersOver ? 'text-rose-700' : 'text-emerald-700' },
    {
      label: 'قطع زائدة (ريال استرجاع)',
      value: n(extraUnits),
      Icon: AlertTriangle,
      tone: extraUnits ? 'text-amber-700' : 'text-emerald-700',
    },
    {
      label: 'تجاوزات آخر 15 دقيقة',
      value: n(liveViolations.length),
      Icon: Activity,
      tone: liveViolations.length ? 'text-rose-700' : 'text-emerald-700',
    },
  ];

  return (
    <AppPageShell
      title="مراقبة عرض الريال"
      subtitle={`قطعة واحدة لكل عميل · منذ ${dateTimeFormat.format(new Date(snapshot.startsAt))} · يتحدث كل 20 ثانية`}
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <AutoRefresh interval={20_000} />

      {!snapshot.enabled && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertDescription>حد عرض الريال متوقف حالياً (PROMO_LIMIT_CATEGORY_IDS=off).</AlertDescription>
        </Alert>
      )}

      {(health.state === 'missing' || health.state === 'broken') && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertDescription>
            <strong>الحاجز متوقف في المتجر الآن.</strong> {health.detail}. العملاء يستطيعون شراء أكثر من قطعة حتى يتم
            إصلاح ملف JS المخصص في إعدادات الثيم في سلة.
          </AlertDescription>
        </Alert>
      )}

      {liveViolations.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {n(liveViolations.length)} طلب تجاوز الحد خلال آخر 15 دقيقة — آخرها #
            {liveViolations.sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0))[0].referenceId}.
            تحقق من حاجز المتجر.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(({ label, value, Icon, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className={cn('mt-2 text-3xl font-bold', tone)}>{value}</p>
              </div>
              <Icon className={cn('size-8', tone)} />
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="relative flex size-3">
              <span
                className={cn(
                  'absolute inline-flex size-full animate-ping rounded-full opacity-50',
                  health.state === 'ok' && !liveViolations.length ? 'bg-emerald-400' : 'bg-rose-400'
                )}
              />
              <span
                className={cn(
                  'relative inline-flex size-3 rounded-full',
                  health.state === 'ok' && !liveViolations.length ? 'bg-emerald-500' : 'bg-rose-500'
                )}
              />
            </span>
            حالة الحماية
          </CardTitle>
          <CardDescription>آخر فحص {timeFormat.format(new Date(health.checkedAt))}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BlockerStatus health={health} />
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border p-4',
              ordersStale ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'
            )}
          >
            <div>
              <p className="font-medium">وصول الطلبات من سلة</p>
              <p className={cn('mt-1 text-xs', ordersStale ? 'text-amber-800' : 'text-emerald-700')}>
                آخر طلب {formatAgo(lastOrderAt, now)}
              </p>
            </div>
            <Clock3 className={cn('size-6 shrink-0', ordersStale ? 'text-amber-600' : 'text-emerald-600')} />
          </div>
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg border p-4',
              snapshot.ordersWithoutItems ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'
            )}
          >
            <div>
              <p className="font-medium">تغطية المنتجات</p>
              <p className={cn('mt-1 text-xs', snapshot.ordersWithoutItems ? 'text-amber-800' : 'text-emerald-700')}>
                {snapshot.ordersWithoutItems
                  ? `${n(snapshot.ordersWithoutItems)} من ${n(snapshot.totalOrdersSinceStart)} طلب بدون منتجات محفوظة بعد`
                  : `كل الطلبات (${n(snapshot.totalOrdersSinceStart)}) محفوظة بمنتجاتها`}
              </p>
            </div>
            {snapshot.ordersWithoutItems ? (
              <AlertTriangle className="size-6 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">منتجات العرض</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n(snapshot.promoProductCount)} منتج · آخر تجاوز {formatAgo(lastViolation, now)}
                {resolved ? ` · ${n(resolved)} طلب ملغي` : ''}
              </p>
            </div>
            <Gift className="size-6 shrink-0 text-slate-500" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>آخر 12 ساعة</CardTitle>
          <CardDescription>طلبات العرض في كل ساعة — الأحمر تجاوز الحد</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-1.5" dir="ltr">
            {buckets.map((bucket) => {
              const total = bucket.ok + bucket.over;
              return (
                <div key={bucket.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] text-muted-foreground">{total ? n(total) : ''}</span>
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                    style={{ height: `${(total / bucketMax) * 100}%` }}
                    title={`${n(bucket.ok)} ضمن الحد · ${n(bucket.over)} تجاوز`}
                  >
                    <div className="bg-emerald-500" style={{ flexGrow: bucket.ok }} />
                    <div className="bg-rose-500" style={{ flexGrow: bucket.over }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{hourFormat.format(new Date(bucket.start))}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <form
        className="grid gap-3 rounded-2xl border bg-white/75 p-3 shadow-sm md:grid-cols-[minmax(220px,1fr)_180px_auto_auto]"
        method="get"
      >
        <div className="relative">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="query" defaultValue={query} className="pr-9" placeholder="رقم الطلب، اسم العميل أو الجوال" />
        </div>
        <select name="window" defaultValue={windowKey} className="h-9 rounded-md border bg-background px-3 text-sm">
          {WINDOWS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit">تطبيق</Button>
        <Button asChild variant="outline">
          <Link href="/promo-monitor" prefetch={false}>
            <RefreshCcw className="size-4" />
            تحديث
          </Link>
        </Button>
      </form>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>طلبات تجاوزت الحد</CardTitle>
              <CardDescription>
                يبقى للعميل قطعة واحدة من أول طلب فيه منتج من العرض؛ الباقي يحذف ويسترجع مبلغه. الطلبات الملغاة لا تظهر هنا.
              </CardDescription>
            </div>
            <Badge variant="outline">{n(violationRows.length)} طلب</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {violationRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-emerald-700">لا توجد طلبات تتجاوز الحد في هذه الفترة.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الوقت</TableHead>
                    <TableHead className="text-right">الطلب</TableHead>
                    <TableHead className="text-right">العميل</TableHead>
                    <TableHead className="text-right">قطع العرض</TableHead>
                    <TableHead className="text-right">الزائد</TableHead>
                    <TableHead className="text-right">السبب</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violationRows.map((order) => (
                    <TableRow key={order.orderId}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {order.placedAt ? dateTimeFormat.format(order.placedAt) : '—'}
                      </TableCell>
                      <TableCell className="font-medium" dir="ltr">
                        #{order.referenceId || order.orderId}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{order.customerName || '—'}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {order.customerMobile || ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{n(order.promoUnits)}</span>
                        <div className="max-w-64 truncate text-xs text-muted-foreground" title={order.items.map((i) => `${i.name} ×${i.quantity}`).join('\n')}>
                          {order.items.map((i) => i.sku || i.name).join('، ')}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-rose-700">{n(order.extraUnits)}</TableCell>
                      <TableCell className="text-xs">{reasonLabel(order)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {order.statusName || order.statusSlug || '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>آخر طلبات العرض</CardTitle>
          <CardDescription>آخر 30 طلب فيها منتج من العرض، مباشرة</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {feed.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">لا توجد طلبات بعد.</p>}
          {feed.map((order) => (
            <div
              key={order.orderId}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
                order.cancelled
                  ? 'border-slate-200 bg-slate-50 text-muted-foreground'
                  : order.violation
                    ? 'border-rose-200 bg-rose-50/70'
                    : 'border-emerald-100 bg-emerald-50/40'
              )}
            >
              <div className="flex items-center gap-3">
                {order.cancelled ? (
                  <XCircle className="size-4 text-slate-400" />
                ) : order.violation ? (
                  <AlertTriangle className="size-4 text-rose-600" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                )}
                <span className="font-medium" dir="ltr">
                  #{order.referenceId || order.orderId}
                </span>
                <span>{order.customerName || '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span>{n(order.promoUnits)} قطعة</span>
                {order.violation && <span className="text-rose-700">{reasonLabel(order)}</span>}
                {order.cancelled && <span>ملغي</span>}
                <span className="text-muted-foreground">{formatAgo(order.placedAt, now)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </AppPageShell>
  );
}
