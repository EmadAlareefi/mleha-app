import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import {
  Activity,
  Award,
  Boxes,
  CalendarDays,
  Clock3,
  PackageCheck,
  ScanLine,
  ShieldAlert,
  Truck,
  UserRoundCheck,
} from 'lucide-react';
import { authOptions } from '@/app/lib/auth';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { prisma } from '@/lib/prisma';
import { RecognitionQuickAction } from './RecognitionQuickAction';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MONITORED_SERVICE_KEYS = new Set(['order-prep', 'order-shipping', 'warehouse']);
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

type SearchParams = Record<string, string | string[] | undefined>;
type ActivityFilter = 'all' | 'prep' | 'shipping' | 'warehouse';

type EmployeeMetric = {
  id: string;
  name: string;
  username: string;
  isActive: boolean;
  services: string[];
  warehouseNames: string[];
  prepCompleted: number;
  prepDurationMinutes: number;
  shippingSalla: number;
  shippingLocal: number;
  warehouseScans: number;
  warehouseHandovers: number;
  rewardCount: number;
  penaltyCount: number;
  rewardPoints: number;
  penaltyPoints: number;
  latestWorkAt: Date | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function riyadhDateInput(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isDateInput(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function shiftDateInput(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveRange(params: SearchParams) {
  const today = riyadhDateInput();
  let toInput = firstParam(params.to);
  let fromInput = firstParam(params.from);

  if (!isDateInput(toInput)) toInput = today;
  if (!isDateInput(fromInput)) fromInput = shiftDateInput(toInput, -29);

  let from = new Date(`${fromInput}T00:00:00+03:00`);
  const to = new Date(`${toInput}T00:00:00+03:00`);

  if (from > to || (to.getTime() - from.getTime()) / DAY_MS >= MAX_RANGE_DAYS) {
    fromInput = shiftDateInput(toInput, -29);
    from = new Date(`${fromInput}T00:00:00+03:00`);
  }

  const endExclusive = new Date(to.getTime() + DAY_MS);
  return { fromInput, toInput, start: from, endExclusive };
}

function normalizeIdentity(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar') || '';
}

function buildIdentityResolver(employees: Array<{ id: string; name: string; username: string }>) {
  const buckets = new Map<string, Set<string>>();

  for (const employee of employees) {
    for (const identifier of [employee.id, employee.username, employee.name]) {
      const normalized = normalizeIdentity(identifier);
      if (!normalized) continue;
      const ids = buckets.get(normalized) || new Set<string>();
      ids.add(employee.id);
      buckets.set(normalized, ids);
    }
  }

  return (...candidates: Array<string | null | undefined>) => {
    for (const candidate of candidates) {
      const ids = buckets.get(normalizeIdentity(candidate));
      if (ids?.size === 1) return Array.from(ids)[0];
    }
    return null;
  };
}

function updateLatest(metric: EmployeeMetric, value: Date | null | undefined) {
  if (value && (!metric.latestWorkAt || value > metric.latestWorkAt)) {
    metric.latestWorkAt = value;
  }
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

function formatDateTime(value: Date | null) {
  if (!value) return 'لا يوجد نشاط';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function formatDateRange(from: string, to: string) {
  const formatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
  });
  return `${formatter.format(new Date(`${from}T12:00:00+03:00`))} – ${formatter.format(
    new Date(`${to}T12:00:00+03:00`),
  )}`;
}

function getServices(
  role: string,
  permissionKeys: string[],
  hasWarehouseAssignment: boolean,
) {
  const keys = new Set(permissionKeys.filter((key) => MONITORED_SERVICE_KEYS.has(key)));
  if (keys.size === 0 && role === 'ORDERS') {
    keys.add('order-prep');
    keys.add('order-shipping');
  }
  if (role === 'WAREHOUSE' || hasWarehouseAssignment) keys.add('warehouse');
  return Array.from(keys);
}

function serviceLabel(service: string) {
  if (service === 'order-prep') return 'التحضير';
  if (service === 'order-shipping') return 'الشحن';
  return 'المستودع';
}

function buildPresetHref(days: number, to: string, userId: string, activity: ActivityFilter) {
  const query = new URLSearchParams({
    from: shiftDateInput(to, -(days - 1)),
    to,
    activity,
  });
  if (userId) query.set('userId', userId);
  return `/employee-performance?${query.toString()}`;
}

export default async function EmployeePerformancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const sessionUser = session.user as any;
  const roles = Array.isArray(sessionUser?.roles) ? sessionUser.roles : [sessionUser?.role];
  const isAdmin = sessionUser?.role === 'admin' || roles.includes('admin');
  if (!isAdmin) redirect('/');

  const params = (await searchParams) || {};
  const range = resolveRange(params);
  const selectedUserId = firstParam(params.userId) || '';
  const requestedActivity = firstParam(params.activity);
  const activity: ActivityFilter = ['prep', 'shipping', 'warehouse'].includes(requestedActivity || '')
    ? (requestedActivity as ActivityFilter)
    : 'all';
  const dateWhere = { gte: range.start, lt: range.endExclusive };

  const [employees, prepAssignments, sallaLabels, localLabels, warehouseShipments, recognitions] =
    await Promise.all([
      prisma.orderUser.findMany({
        where: { userType: 'employee' },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          isActive: true,
          servicePermissions: { select: { serviceKey: true } },
          warehouseAssignments: {
            select: { warehouse: { select: { name: true } } },
          },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      prisma.orderPrepAssignment.findMany({
        where: { completedAt: dateWhere },
        select: { userId: true, assignedAt: true, startedAt: true, completedAt: true },
      }),
      prisma.sallaShipment.findMany({
        where: { labelPrintedAt: dateWhere },
        select: { labelPrintedBy: true, labelPrintedByName: true, labelPrintedAt: true },
      }),
      prisma.localShipment.findMany({
        where: { createdAt: dateWhere, generatedBy: { not: null } },
        select: { generatedBy: true, createdAt: true },
      }),
      prisma.shipment.findMany({
        where: {
          OR: [{ scannedAt: dateWhere }, { handoverScannedAt: dateWhere }],
        },
        select: {
          scannedBy: true,
          scannedAt: true,
          handoverScannedBy: true,
          handoverScannedAt: true,
        },
      }),
      prisma.userRecognition.findMany({
        where: { effectiveDate: dateWhere },
        select: { userId: true, kind: true, points: true },
      }),
    ]);

  const metrics = new Map<string, EmployeeMetric>();
  for (const employee of employees) {
    const permissionKeys = employee.servicePermissions.map((permission) => permission.serviceKey);
    const services = getServices(
      employee.role,
      permissionKeys,
      employee.warehouseAssignments.length > 0,
    );
    metrics.set(employee.id, {
      id: employee.id,
      name: employee.name,
      username: employee.username,
      isActive: employee.isActive,
      services,
      warehouseNames: employee.warehouseAssignments.map((assignment) => assignment.warehouse.name),
      prepCompleted: 0,
      prepDurationMinutes: 0,
      shippingSalla: 0,
      shippingLocal: 0,
      warehouseScans: 0,
      warehouseHandovers: 0,
      rewardCount: 0,
      penaltyCount: 0,
      rewardPoints: 0,
      penaltyPoints: 0,
      latestWorkAt: null,
    });
  }

  const resolveEmployee = buildIdentityResolver(employees);
  let unattributedShipping = 0;
  let unattributedWarehouse = 0;

  for (const assignment of prepAssignments) {
    const metric = metrics.get(assignment.userId);
    if (!metric || !assignment.completedAt) continue;
    metric.prepCompleted += 1;
    const startedAt = assignment.startedAt || assignment.assignedAt;
    const duration = Math.max(0, (assignment.completedAt.getTime() - startedAt.getTime()) / 60_000);
    metric.prepDurationMinutes += duration;
    updateLatest(metric, assignment.completedAt);
  }

  for (const label of sallaLabels) {
    const employeeId = resolveEmployee(label.labelPrintedBy, label.labelPrintedByName);
    const metric = employeeId ? metrics.get(employeeId) : null;
    if (!metric) {
      unattributedShipping += 1;
      continue;
    }
    metric.shippingSalla += 1;
    updateLatest(metric, label.labelPrintedAt);
  }

  for (const label of localLabels) {
    const employeeId = resolveEmployee(label.generatedBy);
    const metric = employeeId ? metrics.get(employeeId) : null;
    if (!metric) {
      unattributedShipping += 1;
      continue;
    }
    metric.shippingLocal += 1;
    updateLatest(metric, label.createdAt);
  }

  for (const shipment of warehouseShipments) {
    if (shipment.scannedAt >= range.start && shipment.scannedAt < range.endExclusive) {
      const employeeId = resolveEmployee(shipment.scannedBy);
      const metric = employeeId ? metrics.get(employeeId) : null;
      if (metric) {
        metric.warehouseScans += 1;
        updateLatest(metric, shipment.scannedAt);
      } else {
        unattributedWarehouse += 1;
      }
    }
    if (
      shipment.handoverScannedAt &&
      shipment.handoverScannedAt >= range.start &&
      shipment.handoverScannedAt < range.endExclusive
    ) {
      const employeeId = resolveEmployee(shipment.handoverScannedBy);
      const metric = employeeId ? metrics.get(employeeId) : null;
      if (metric) {
        metric.warehouseHandovers += 1;
        updateLatest(metric, shipment.handoverScannedAt);
      } else {
        unattributedWarehouse += 1;
      }
    }
  }

  for (const recognition of recognitions) {
    const metric = metrics.get(recognition.userId);
    if (!metric) continue;
    if (recognition.kind === 'REWARD') {
      metric.rewardCount += 1;
      metric.rewardPoints += Math.abs(recognition.points);
    } else {
      metric.penaltyCount += 1;
      metric.penaltyPoints += Math.abs(recognition.points);
    }
  }

  const monitoredEmployees = Array.from(metrics.values()).filter((metric) => {
    const totalWork =
      metric.prepCompleted +
      metric.shippingSalla +
      metric.shippingLocal +
      metric.warehouseScans +
      metric.warehouseHandovers;
    const belongsToMonitoredTeam = metric.services.length > 0;
    return belongsToMonitoredTeam || totalWork > 0 || metric.rewardCount + metric.penaltyCount > 0;
  });

  const visibleEmployees = monitoredEmployees
    .filter((metric) => !selectedUserId || metric.id === selectedUserId)
    .filter((metric) => {
      if (activity === 'prep') return metric.prepCompleted > 0 || metric.services.includes('order-prep');
      if (activity === 'shipping') {
        return metric.shippingSalla + metric.shippingLocal > 0 || metric.services.includes('order-shipping');
      }
      if (activity === 'warehouse') {
        return metric.warehouseScans + metric.warehouseHandovers > 0 || metric.services.includes('warehouse');
      }
      return true;
    })
    .sort((a, b) => {
      const aTotal = a.prepCompleted + a.shippingSalla + a.shippingLocal + a.warehouseScans + a.warehouseHandovers;
      const bTotal = b.prepCompleted + b.shippingSalla + b.shippingLocal + b.warehouseScans + b.warehouseHandovers;
      return bTotal - aTotal || a.name.localeCompare(b.name, 'ar');
    });

  const summary = visibleEmployees.reduce(
    (result, metric) => {
      const employeeActions =
        metric.prepCompleted +
        metric.shippingSalla +
        metric.shippingLocal +
        metric.warehouseScans +
        metric.warehouseHandovers;
      result.totalActions += employeeActions;
      if (employeeActions > 0) result.activeEmployees += 1;
      result.rewards += metric.rewardCount;
      result.penalties += metric.penaltyCount;
      result.netPoints += metric.rewardPoints - metric.penaltyPoints;
      return result;
    },
    { totalActions: 0, activeEmployees: 0, rewards: 0, penalties: 0, netPoints: 0 },
  );

  const filterActivityLabel =
    activity === 'prep'
      ? 'فريق التحضير'
      : activity === 'shipping'
        ? 'فريق الشحن'
        : activity === 'warehouse'
          ? 'فريق المستودع'
          : 'جميع الفرق';

  return (
    <AppPageShell
      title="أداء الموظفين"
      subtitle="متابعة التحضير والشحن ومسح المستودع والسجل التحفيزي في لوحة واحدة"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-l from-slate-950 via-blue-950 to-cyan-900 p-5 text-white shadow-xl md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Badge className="border-white/20 bg-white/10 text-white">تقرير تشغيلي موحد</Badge>
            <h2 className="text-2xl font-bold md:text-3xl">صورة واضحة عن إنجاز كل موظف</h2>
            <p className="max-w-3xl text-sm leading-7 text-cyan-50/80">
              الأرقام مبنية على العمليات المسجلة باسم الموظف، ويمكن إضافة المكافأة أو المخالفة من صفه مباشرة.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <CalendarDays className="size-5 text-cyan-300" />
            <div>
              <p className="text-xs text-cyan-100/70">الفترة الحالية</p>
              <p className="text-sm font-semibold">{formatDateRange(range.fromInput, range.toInput)}</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 md:p-5">
          <form method="get" className="grid gap-4 lg:grid-cols-[1fr,1fr,1.4fr,1fr,auto] lg:items-end">
            <label className="space-y-1.5 text-sm font-medium">
              <span>من تاريخ</span>
              <Input type="date" name="from" defaultValue={range.fromInput} max={range.toInput} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>إلى تاريخ</span>
              <Input type="date" name="to" defaultValue={range.toInput} min={range.fromInput} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>الموظف</span>
              <NativeSelect name="userId" defaultValue={selectedUserId} className="w-full">
                <NativeSelectOption value="">كل الموظفين</NativeSelectOption>
                {monitoredEmployees.map((employee) => (
                  <NativeSelectOption key={employee.id} value={employee.id}>
                    {employee.name} ({employee.username})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>الفريق</span>
              <NativeSelect name="activity" defaultValue={activity} className="w-full">
                <NativeSelectOption value="all">جميع الفرق</NativeSelectOption>
                <NativeSelectOption value="prep">تحضير الطلبات</NativeSelectOption>
                <NativeSelectOption value="shipping">شحن الطلبات</NativeSelectOption>
                <NativeSelectOption value="warehouse">مسح المستودع</NativeSelectOption>
              </NativeSelect>
            </label>
            <Button type="submit" className="w-full lg:w-auto">
              <Activity />
              تحديث التقرير
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-500">فترات سريعة:</span>
            {[1, 7, 30, 90].map((days) => (
              <Button key={days} asChild variant="outline" size="xs">
                <Link href={buildPresetHref(days, range.toInput, selectedUserId, activity)}>
                  {days === 1 ? 'اليوم' : `آخر ${formatNumber(days)} يوم`}
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="border-blue-100 bg-blue-50/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-blue-800">
              إجمالي العمليات <Boxes className="size-5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-950">{formatNumber(summary.totalActions)}</p>
            <p className="mt-1 text-xs text-blue-700">تحضير + شحن + مسح وتسليم</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-100 bg-cyan-50/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-cyan-800">
              الموظفون النشطون <UserRoundCheck className="size-5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-cyan-950">{formatNumber(summary.activeEmployees)}</p>
            <p className="mt-1 text-xs text-cyan-700">من أصل {formatNumber(visibleEmployees.length)} في التقرير</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-100 bg-emerald-50/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-emerald-800">
              المكافآت <Award className="size-5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-950">{formatNumber(summary.rewards)}</p>
            <p className="mt-1 text-xs text-emerald-700">ضمن نفس الفترة</p>
          </CardContent>
        </Card>
        <Card className="border-rose-100 bg-rose-50/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-rose-800">
              المخالفات <ShieldAlert className="size-5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-rose-950">{formatNumber(summary.penalties)}</p>
            <p className="mt-1 text-xs text-rose-700">ضمن نفس الفترة</p>
          </CardContent>
        </Card>
        <Card className="border-violet-100 bg-violet-50/60 shadow-sm sm:col-span-2 xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-violet-800">
              صافي النقاط <Activity className="size-5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${summary.netPoints >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {summary.netPoints > 0 ? '+' : ''}{formatNumber(summary.netPoints)}
            </p>
            <p className="mt-1 text-xs text-violet-700">المكافآت ناقص المخالفات</p>
          </CardContent>
        </Card>
      </section>

      {(unattributedShipping > 0 || unattributedWarehouse > 0) && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertDescription>
            توجد {formatNumber(unattributedShipping + unattributedWarehouse)} عملية لم نتمكن من ربطها بموظف
            ({formatNumber(unattributedShipping)} شحن، {formatNumber(unattributedWarehouse)} مستودع). غالباً سُجلت باسم قديم أو باسم النظام.
          </AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden border-slate-200 shadow-md">
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <CardTitle>تقرير {filterActivityLabel}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">مرتّب حسب إجمالي العمليات المسجلة خلال الفترة.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/user-recognition">فتح السجل الكامل</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>المهام</TableHead>
                  <TableHead className="text-center">التحضير</TableHead>
                  <TableHead className="text-center">متوسط الوقت</TableHead>
                  <TableHead className="text-center">الشحن</TableHead>
                  <TableHead className="text-center">مسح المستودع</TableHead>
                  <TableHead className="text-center">تأكيد التسليم</TableHead>
                  <TableHead className="text-center">إجمالي العمل</TableHead>
                  <TableHead className="text-center">السجل التحفيزي</TableHead>
                  <TableHead>آخر نشاط</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-14 text-center text-slate-500">
                      لا توجد نتائج تطابق الفترة والفلاتر المختارة.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleEmployees.map((employee, index) => {
                    const shippingTotal = employee.shippingSalla + employee.shippingLocal;
                    const warehouseTotal = employee.warehouseScans + employee.warehouseHandovers;
                    const totalWork = employee.prepCompleted + shippingTotal + warehouseTotal;
                    const averagePrep = employee.prepCompleted
                      ? Math.round(employee.prepDurationMinutes / employee.prepCompleted)
                      : 0;
                    const netPoints = employee.rewardPoints - employee.penaltyPoints;

                    return (
                      <TableRow key={employee.id} className="align-middle">
                        <TableCell className="text-center font-semibold text-slate-400">
                          {formatNumber(index + 1)}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-40">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-950">{employee.name}</span>
                              {!employee.isActive && <Badge variant="outline">غير نشط</Badge>}
                            </div>
                            <p className="text-xs text-slate-500">@{employee.username}</p>
                            {employee.warehouseNames.length > 0 && (
                              <p className="mt-1 max-w-48 truncate text-xs text-slate-400">
                                {employee.warehouseNames.join('، ')}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-40 flex-wrap gap-1">
                            {employee.services.map((service) => (
                              <Badge key={service} variant="outline" className="bg-white">
                                {serviceLabel(service)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                            <PackageCheck className="size-4" /> {formatNumber(employee.prepCompleted)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1 text-slate-600">
                            <Clock3 className="size-4" />
                            {employee.prepCompleted ? `${formatNumber(averagePrep)} د` : '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="font-semibold text-emerald-700">{formatNumber(shippingTotal)}</div>
                          <div className="text-[11px] text-slate-400">
                            سلة {formatNumber(employee.shippingSalla)} · محلي {formatNumber(employee.shippingLocal)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1.5 font-semibold text-blue-700">
                            <ScanLine className="size-4" /> {formatNumber(employee.warehouseScans)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-semibold text-cyan-700">
                          {formatNumber(employee.warehouseHandovers)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className="bg-slate-900 text-white">{formatNumber(totalWork)}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2 text-xs">
                            <span className="text-emerald-700">+{formatNumber(employee.rewardCount)}</span>
                            <span className="text-slate-300">/</span>
                            <span className="text-rose-700">-{formatNumber(employee.penaltyCount)}</span>
                          </div>
                          <div className={`mt-1 text-xs font-semibold ${netPoints >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {netPoints > 0 ? '+' : ''}{formatNumber(netPoints)} نقطة
                          </div>
                        </TableCell>
                        <TableCell className="min-w-36 text-xs text-slate-500">
                          {formatDateTime(employee.latestWorkAt)}
                        </TableCell>
                        <TableCell>
                          <RecognitionQuickAction userId={employee.id} userName={employee.name} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-slate-50/70 shadow-none">
        <CardContent className="grid gap-4 p-5 text-sm text-slate-600 md:grid-cols-3">
          <div className="flex gap-3">
            <PackageCheck className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <p><strong className="text-slate-900">التحضير:</strong> الطلبات التي اكتمل تحضيرها، والوقت من بدء التحضير (أو التعيين) حتى الاكتمال.</p>
          </div>
          <div className="flex gap-3">
            <Truck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <p><strong className="text-slate-900">الشحن:</strong> بوالص سلة المطبوعة والشحنات المحلية المنشأة باسم الموظف؛ كل طلب يحسب مرة واحدة في التقرير.</p>
          </div>
          <div className="flex gap-3">
            <ScanLine className="mt-0.5 size-5 shrink-0 text-blue-600" />
            <p><strong className="text-slate-900">المستودع:</strong> المسح الأول وتأكيد التسليم محسوبان كعمليتين منفصلتين وباسم منفذ كل عملية.</p>
          </div>
        </CardContent>
      </Card>
    </AppPageShell>
  );
}
