import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageCircle,
  RefreshCcw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { authOptions } from '@/app/lib/auth';
import { env } from '@/app/lib/env';
import { getCustomerJourneyTemplateHealth } from '@/app/lib/customer-journey-template-health';
import { AutoRefresh } from '@/components/AutoRefresh';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { prisma } from '@/lib/prisma';

import { JourneyLines, type CustomerJourneyLine } from './JourneyLines';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DAY_MS = 24 * 60 * 60_000;
const ISSUE_STATUSES = ['failed', 'retrying', 'waiting_for_data'] as const;
const ACTIVE_STATUSES = ['pending', 'processing', 'retrying', 'waiting_for_data', 'accepted'] as const;
const STATUS_FILTERS = [
  ['all', 'كل الحالات'],
  ['problems', 'تحتاج متابعة'],
  ['pending', 'بانتظار الإرسال'],
  ['accepted', 'مقبولة'],
  ['delivered', 'تم التسليم'],
  ['read', 'تمت القراءة'],
  ['failed', 'فشلت'],
  ['retrying', 'إعادة محاولة'],
  ['waiting_for_data', 'بانتظار بيانات'],
  ['cancelled', 'ملغاة'],
  ['superseded', 'تجاوزتها مرحلة أحدث'],
] as const;

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: 'بانتظار الإرسال', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  processing: { label: 'قيد المعالجة', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  waiting_for_data: { label: 'بانتظار بيانات', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  retrying: { label: 'إعادة محاولة', className: 'border-orange-200 bg-orange-50 text-orange-800' },
  accepted: { label: 'مقبولة من Zoko', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  delivered: { label: 'تم التسليم', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  read: { label: 'تمت القراءة', className: 'border-green-200 bg-green-50 text-green-800' },
  failed: { label: 'فشلت', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  cancelled: { label: 'ملغاة', className: 'border-slate-200 bg-slate-50 text-slate-600' },
  superseded: { label: 'تجاوزتها مرحلة أحدث', className: 'border-slate-200 bg-slate-50 text-slate-600' },
};

const STEP_LABELS: Record<string, string> = {
  order_received: 'استلام الطلب والفاتورة',
  shipped: 'الشحن والتتبع',
  product_rating: 'التسليم والتقييم',
  cancelled: 'إلغاء الطلب',
  refunded: 'الاسترداد',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  return `+${digits.slice(0, 3)} •••• ${digits.slice(-4)}`;
}

function messageProblem(row: {
  status: string;
  scheduledFor: Date;
  acceptedAt: Date | null;
  updatedAt: Date;
  attemptCount: number;
  lastError: string | null;
}): string | null {
  const now = Date.now();
  if (row.status === 'failed') return row.lastError || 'فشل الإرسال أو التسليم';
  if (row.status === 'retrying') return row.lastError || 'بانتظار إعادة المحاولة';
  if (row.status === 'waiting_for_data') return row.lastError || 'بيانات الرسالة غير مكتملة';
  if (row.status === 'processing' && now - row.updatedAt.getTime() > 10 * 60_000) {
    return 'المعالجة مستمرة لأكثر من 10 دقائق';
  }
  if (row.status === 'pending' && now - row.scheduledFor.getTime() > 10 * 60_000) {
    return 'تأخر الإرسال عن موعده بأكثر من 10 دقائق';
  }
  if (row.status === 'accepted' && row.acceptedAt && now - row.acceptedAt.getTime() > 30 * 60_000) {
    return 'مقبولة منذ أكثر من 30 دقيقة دون تأكيد تسليم';
  }
  if (row.attemptCount > 0) return `احتاجت الرسالة ${row.attemptCount} محاولة إضافية`;
  return null;
}

type JourneyRow = Awaited<ReturnType<typeof prisma.customerJourneyNotification.findMany>>[number];

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function journeyMilestoneStatus(
  row: JourneyRow | undefined
): CustomerJourneyLine['milestones'][number]['status'] {
  if (!row) return 'missing';
  if (messageProblem(row)) return 'problem';
  if (row.status === 'read') return 'read';
  if (row.status === 'delivered') return 'delivered';
  if (row.status === 'accepted' || row.status === 'processing') return 'active';
  if (row.status === 'cancelled' || row.status === 'superseded') return 'skipped';
  return 'pending';
}

function journeyTimestamp(row: JourneyRow | undefined): string | null {
  if (!row) return null;
  return (row.readAt || row.deliveredAt || row.acceptedAt || row.scheduledFor || row.createdAt).toISOString();
}

function buildJourneyLines(
  notificationRows: JourneyRow[],
  includedKeys: Set<string> | null
): CustomerJourneyLine[] {
  const groups = new Map<string, JourneyRow[]>();

  for (const row of notificationRows) {
    const key = `${row.merchantId}:${row.orderId}`;
    if (includedKeys && !includedKeys.has(key)) continue;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .map(([key, group]): CustomerJourneyLine => {
      const latestByStep = new Map<string, JourneyRow>();
      for (const row of group) {
        const existing = latestByStep.get(row.step);
        if (!existing || row.createdAt > existing.createdAt) latestByStep.set(row.step, row);
      }

      const latest = group.reduce((current, row) => row.updatedAt > current.updatedAt ? row : current);
      const dataRows = [latest, ...group];
      let customerName = '';
      let orderNumber = '';
      for (const row of dataRows) {
        const data = jsonRecord(row.data);
        customerName ||= stringValue(data.customerName);
        orderNumber ||= stringValue(data.orderNumber);
      }

      const steps = [
        ['order_received', 'استلام الطلب والفاتورة'],
        ['shipped', 'الشحن والتتبع'],
        ['product_rating', 'التسليم والتقييم'],
      ] as const;
      const milestones = steps.map(([step, label]) => {
        const row = latestByStep.get(step);
        const status = journeyMilestoneStatus(row);
        const meta = row ? STATUS_META[row.status] : null;
        return {
          step,
          label,
          status,
          statusLabel: meta?.label || 'لم تبدأ',
          at: journeyTimestamp(row),
          problem: row ? messageProblem(row) : null,
        };
      });
      const lastReachedIndex = milestones.reduce(
        (last, milestone, index) => milestone.status !== 'missing' && milestone.status !== 'skipped' ? index : last,
        -1
      );

      const exceptionSteps = [
        ['cancelled', 'إلغاء الطلب'],
        ['refunded', 'استرداد المبلغ'],
      ] as const;
      const exceptions = exceptionSteps.flatMap(([step, label]) => {
        const row = latestByStep.get(step);
        if (!row) return [];
        return [{
          step,
          label,
          statusLabel: STATUS_META[row.status]?.label || row.status,
          isProblem: Boolean(messageProblem(row)),
        }];
      });

      return {
        key,
        customerName: customerName || 'عميلتنا',
        orderNumber: orderNumber || latest.orderId,
        maskedPhone: maskPhone(latest.recipient),
        latestAt: latest.updatedAt.toISOString(),
        hasProblem: group.some((row) => Boolean(messageProblem(row))),
        progress: lastReachedIndex < 0 ? 0 : (lastReachedIndex / (steps.length - 1)) * 100,
        milestones,
        exceptions,
      };
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
    .slice(0, 100);
}

export default async function ZokoNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  const user = session.user as { role?: string; roles?: string[] };
  if (user.role !== 'admin' && !user.roles?.includes('admin')) redirect('/');

  const params = await searchParams;
  const query = param(params.query).trim().slice(0, 100);
  const requestedStatus = param(params.status) || 'all';
  const status = STATUS_FILTERS.some(([value]) => value === requestedStatus)
    ? requestedStatus
    : 'all';
  const requestedDays = Number(param(params.days) || '7');
  const days = [1, 7, 30, 90].includes(requestedDays) ? requestedDays : 7;
  const since = new Date(Date.now() - days * DAY_MS);
  const acceptedBefore = new Date(Date.now() - 30 * 60_000);
  const stalledBefore = new Date(Date.now() - 10 * 60_000);

  const journeyWhere: Prisma.CustomerJourneyNotificationWhereInput = { createdAt: { gte: since } };
  if (query) {
    journeyWhere.OR = [
      { orderId: { contains: query, mode: 'insensitive' } },
      { templateId: { contains: query, mode: 'insensitive' } },
      { providerMessageId: { contains: query, mode: 'insensitive' } },
      { recipient: { contains: query.replace(/\D/g, '') || query } },
    ];
  }
  const where: Prisma.CustomerJourneyNotificationWhereInput = { ...journeyWhere };
  if (status === 'problems') {
    const problemFilter: Prisma.CustomerJourneyNotificationWhereInput = {
      OR: [
        { status: { in: [...ISSUE_STATUSES] } },
        { status: 'accepted', acceptedAt: { lte: acceptedBefore } },
        { status: 'processing', updatedAt: { lte: stalledBefore } },
        { status: 'pending', scheduledFor: { lte: stalledBefore } },
        { attemptCount: { gt: 0 } },
      ],
    };
    where.AND = [problemFilter];
  } else if (status !== 'all') {
    where.status = status;
  }

  let rows: Awaited<ReturnType<typeof prisma.customerJourneyNotification.findMany>> = [];
  let journeyRows: Awaited<ReturnType<typeof prisma.customerJourneyNotification.findMany>> = [];
  let grouped: Array<{ status: string; _count: { _all: number } }> = [];
  let problemCount = 0;
  let databaseError: string | null = null;
  const templateHealthPromise = getCustomerJourneyTemplateHealth();

  try {
    [rows, journeyRows, grouped, problemCount] = await Promise.all([
      prisma.customerJourneyNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.customerJourneyNotification.findMany({
        where: journeyWhere,
        orderBy: { updatedAt: 'desc' },
        take: 1_000,
      }),
      prisma.customerJourneyNotification.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.customerJourneyNotification.count({
        where: {
          createdAt: { gte: since },
          OR: [
            { status: { in: [...ISSUE_STATUSES] } },
            { status: 'accepted', acceptedAt: { lte: acceptedBefore } },
            { status: 'processing', updatedAt: { lte: stalledBefore } },
            { status: 'pending', scheduledFor: { lte: stalledBefore } },
            { attemptCount: { gt: 0 } },
          ],
        },
      }),
    ]);
  } catch (error) {
    console.error('Failed to load customer journey notification monitor', error);
    databaseError = 'تعذر الاتصال بجدول سجل رسائل رحلة العميل.';
  }

  const templateHealth = await templateHealthPromise;
  const includedJourneyKeys = status === 'all'
    ? null
    : new Set(rows.map((row) => `${row.merchantId}:${row.orderId}`));
  const journeyLines = buildJourneyLines(journeyRows, includedJourneyKeys);
  const statusCounts = new Map(grouped.map((item) => [item.status, item._count._all]));
  const total = grouped.reduce((sum, item) => sum + item._count._all, 0);
  const delivered = (statusCounts.get('delivered') || 0) + (statusCounts.get('read') || 0);
  const active = ACTIVE_STATUSES.reduce((sum, key) => sum + (statusCounts.get(key) || 0), 0);
  const unhealthyTemplates = templateHealth.templates.filter((template) => template.status !== 'ok');
  const runtimeChecks = [
    {
      label: 'تشغيل رحلة العميل',
      ok: env.ZOKO_CUSTOMER_JOURNEY_ENABLED,
      detail: env.ZOKO_CUSTOMER_JOURNEY_ENABLED ? 'مفعلة' : 'متوقفة',
    },
    {
      label: 'توقيع رابط الفاتورة',
      ok: env.CUSTOMER_DOCUMENT_SIGNING_SECRET.length >= 32,
      detail: env.CUSTOMER_DOCUMENT_SIGNING_SECRET.length >= 32 ? 'مهيأ' : 'المفتاح مفقود أو قصير',
    },
    {
      label: 'الرابط العام للمستند',
      ok: Boolean(env.CUSTOMER_DOCUMENT_BASE_URL),
      detail: env.CUSTOMER_DOCUMENT_BASE_URL ? 'مهيأ' : 'غير مهيأ',
    },
    {
      label: 'حماية المعالج المجدول',
      ok: Boolean(process.env.CRON_SECRET),
      detail: process.env.CRON_SECRET ? 'مهيأة' : 'CRON_SECRET مفقود',
    },
  ];

  return (
    <AppPageShell
      title="مراقبة إشعارات واتساب"
      subtitle="حالة قوالب Zoko وسجل رحلة العميل"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <AutoRefresh interval={30_000} />

      {!env.ZOKO_CUSTOMER_JOURNEY_ENABLED && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            رحلة العميل متوقفة حالياً. اضبط <code dir="ltr">ZOKO_CUSTOMER_JOURNEY_ENABLED=true</code>{' '}
            بعد تطبيق ترحيل قاعدة البيانات والتحقق النهائي.
          </AlertDescription>
        </Alert>
      )}

      {databaseError && (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertDescription>
            {databaseError} تأكد من الاتصال بقاعدة البيانات ووجود جدول
            CustomerJourneyNotification.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: `إجمالي آخر ${days} أيام`, value: total, Icon: MessageCircle, tone: 'text-slate-700' },
          { label: 'تم التسليم أو القراءة', value: delivered, Icon: CheckCircle2, tone: 'text-emerald-700' },
          { label: 'قيد الانتظار والمعالجة', value: active, Icon: Clock3, tone: 'text-indigo-700' },
          { label: 'تحتاج متابعة', value: problemCount, Icon: AlertTriangle, tone: problemCount ? 'text-rose-700' : 'text-emerald-700' },
        ].map(({ label, value, Icon, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className={cn('mt-2 text-3xl font-bold', tone)}>{value.toLocaleString('ar-SA')}</p>
              </div>
              <Icon className={cn('size-8', tone)} />
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>جاهزية التشغيل</CardTitle>
          <CardDescription>فحوصات الإعداد الضرورية قبل تفعيل الرسائل للعملاء</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {runtimeChecks.map((check) => (
            <div key={check.label} className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <p className="font-medium">{check.label}</p>
                <p className={cn('mt-1 text-xs', check.ok ? 'text-emerald-700' : 'text-rose-700')}>
                  {check.detail}
                </p>
              </div>
              {check.ok ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="size-5 shrink-0 text-rose-600" />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200/80 bg-gradient-to-br from-white via-white to-emerald-50/30 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                </span>
                رحلة كل عميلة
              </CardTitle>
              <CardDescription className="mt-2">
                كل سطر يمثل طلباً، والنقاط تعرض وصول الفاتورة والتتبع وطلب تقييم المنتجات
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-slate-200 bg-white/80 text-slate-700">
              {journeyLines.length.toLocaleString('ar-SA')} رحلة ظاهرة
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="mb-6 grid gap-3 rounded-2xl border border-slate-200/80 bg-white/75 p-3 shadow-sm backdrop-blur md:grid-cols-[minmax(220px,1fr)_180px_150px_auto_auto]" method="get">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="query"
                defaultValue={query}
                className="pr-9"
                placeholder="رقم الطلب، الهاتف، القالب أو رقم رسالة Zoko"
              />
            </div>
            <select name="status" defaultValue={status} className="h-9 rounded-md border bg-background px-3 text-sm">
              {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select name="days" defaultValue={String(days)} className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="1">آخر 24 ساعة</option>
              <option value="7">آخر 7 أيام</option>
              <option value="30">آخر 30 يوماً</option>
              <option value="90">آخر 90 يوماً</option>
            </select>
            <Button type="submit">تطبيق</Button>
            <Button asChild variant="outline">
              <Link href="/zoko-notifications" prefetch={false}>
                <RefreshCcw className="size-4" />
                تحديث
              </Link>
            </Button>
          </form>
          <JourneyLines journeys={journeyLines} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5" />
                صحة القوالب المعتمدة
              </CardTitle>
              <CardDescription className="mt-2">
                فحص مباشر من Zoko للاسم واللغة والنوع وعدد المتغيرات
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={unhealthyTemplates.length ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}
            >
              {unhealthyTemplates.length ? `${unhealthyTemplates.length} مشكلة` : 'القوالب الخمسة سليمة'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {templateHealth.error && (
            <p className="mb-4 text-sm text-rose-700" dir="ltr">{templateHealth.error}</p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {templateHealth.templates.map((template) => (
              <div key={template.step} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{template.label}</p>
                  {template.status === 'ok' ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="size-5 shrink-0 text-rose-600" />
                  )}
                </div>
                <p className="mt-2 break-all text-xs text-muted-foreground" dir="ltr">
                  {template.templateId}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {template.expectedType} · {template.expectedVariables} متغيرات
                </p>
                {template.issue && <p className="mt-2 text-xs text-rose-700">{template.issue}</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>سجل رسائل رحلة العميل</CardTitle>
              <CardDescription className="mt-2">
                يتحدث تلقائياً كل 30 ثانية، ويعرض أحدث 200 رسالة مطابقة
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">تفاصيل تقنية</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {!databaseError && rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              لا توجد رسائل مطابقة للفلاتر الحالية.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطلب والمرحلة</TableHead>
                  <TableHead>القالب والمستلم</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التوقيت</TableHead>
                  <TableHead>التشخيص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const meta = STATUS_META[row.status] || { label: row.status, className: 'border-slate-200 bg-slate-50 text-slate-700' };
                  const problem = messageProblem(row);
                  return (
                    <TableRow key={row.id} className={problem ? 'bg-rose-50/30' : undefined}>
                      <TableCell className="min-w-44">
                        <p className="font-medium" dir="ltr">{row.orderId}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{STEP_LABELS[row.step] || row.step}</p>
                      </TableCell>
                      <TableCell className="min-w-56">
                        <p className="break-all text-xs" dir="ltr">{row.templateId}</p>
                        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{maskPhone(row.recipient)}</p>
                        {row.providerMessageId && (
                          <p className="mt-1 break-all text-[11px] text-muted-foreground" dir="ltr">{row.providerMessageId}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                        {row.attemptCount > 0 && <p className="mt-2 text-xs">المحاولات: {row.attemptCount + 1}</p>}
                      </TableCell>
                      <TableCell className="min-w-48 text-xs">
                        <p>أنشئت: {formatDate(row.createdAt)}</p>
                        <p className="mt-1">مجدولة: {formatDate(row.scheduledFor)}</p>
                        {row.deliveredAt && <p className="mt-1 text-emerald-700">سُلّمت: {formatDate(row.deliveredAt)}</p>}
                        {row.readAt && <p className="mt-1 text-green-700">قُرئت: {formatDate(row.readAt)}</p>}
                      </TableCell>
                      <TableCell className="max-w-80">
                        {problem ? (
                          <div className="flex items-start gap-2 text-sm text-rose-700">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            <span className="break-words">{problem}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-emerald-700">لا توجد مشكلة مكتشفة</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppPageShell>
  );
}
