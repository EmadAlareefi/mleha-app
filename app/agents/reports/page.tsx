import { AppPageShell } from "@/components/dashboard/app-page-shell";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAgentPerformanceReport } from "@/app/lib/zoko-insights";

type SearchParams = Record<string, string | string[] | undefined>;

export const dynamic = "force-dynamic";

export default async function AgentsReportsPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  const resolved = await resolveSearchParams(searchParams);
  const { fromDate, toDate } = resolveDateRange(resolved);
  const agentId =
    typeof resolved.agent === "string" && resolved.agent !== "all" ? resolved.agent : undefined;

  const report = await getAgentPerformanceReport({
    from: fromDate,
    to: toDate,
    agentId,
  });

  return (
    <AppPageShell
      title="تقارير أداء الوكلاء"
      subtitle="اطّلع على حجم المحادثات المغلقة، سرعة الحل، ورسائل واتساب لكل وكيل"
    >
      <PageHeader
        title="تقارير أداء الوكلاء"
        description="اطّلع على حجم المحادثات المغلقة، سرعة الحل، ورسائل واتساب لكل وكيل"
      />

      <Filters
        fromValue={formatDateInput(fromDate)}
        toValue={formatDateInput(toDate)}
        agentId={agentId ?? "all"}
        agents={report.availableAgents}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="محادثات مخصصة" value={report.totals.assigned} hint="في النطاق الزمني المحدد" />
        <SummaryCard title="محادثات مغلقة" value={report.totals.closed} hint="تم إغلاقها من قِبل الوكلاء" />
        <SummaryCard
          title="متوسط وقت الحل"
          value={`${report.totals.averageResolutionMinutes} دقيقة`}
          hint="الفارق بين التعيين والإغلاق"
        />
        <SummaryCard
          title="رسائل العملاء"
          value={report.totals.incomingMessages}
          hint="رسائل واتساب الواردة في نفس الفترة"
        />
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>تفاصيل الوكلاء</CardTitle>
          <CardDescription>
            الفترة من {formatDateLabel(report.range.from)} إلى {formatDateLabel(report.range.to)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوكيل</TableHead>
                <TableHead>محادثات مخصصة</TableHead>
                <TableHead>محادثات مغلقة</TableHead>
                <TableHead>متوسط الحل</TableHead>
                <TableHead>رسائل صادرة</TableHead>
                <TableHead>آخر تعيين</TableHead>
                <TableHead>آخر إغلاق</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.agents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    لا تتوفر بيانات لهذا النطاق
                  </TableCell>
                </TableRow>
              )}
              {report.agents.map((agent) => (
                <TableRow key={agent.agentId ?? agent.agentEmail ?? agent.agentName ?? "agent"}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold">
                        {agent.agentName ?? "بدون اسم مسجل"}
                      </span>
                      {agent.agentEmail && (
                        <span className="text-sm text-muted-foreground">{agent.agentEmail}</span>
                      )}
                      {!agent.agentEmail && (
                        <span className="text-sm text-muted-foreground">بدون بريد مسجل</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{agent.assignedChats}</TableCell>
                  <TableCell>{agent.closedChats}</TableCell>
                  <TableCell>{agent.avgResolutionMinutes || "—"} دقيقة</TableCell>
                  <TableCell>{agent.outgoingMessages}</TableCell>
                  <TableCell>{formatRelative(agent.lastAssignmentAt)}</TableCell>
                  <TableCell>{formatRelative(agent.lastClosureAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppPageShell>
  );
}

function Filters({
  fromValue,
  toValue,
  agentId,
  agents,
}: {
  fromValue: string;
  toValue: string;
  agentId: string;
  agents: { id: string; name: string | null; email: string | null }[];
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="p-4">
        <form className="grid gap-4 md:grid-cols-4" method="get">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">من تاريخ</span>
            <Input type="date" name="from" defaultValue={fromValue} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">إلى تاريخ</span>
            <Input type="date" name="to" defaultValue={toValue} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">الوكيل</span>
            <NativeSelect name="agent" defaultValue={agentId}>
              <NativeSelectOption value="all">الكل</NativeSelectOption>
              {agents.map((agent) => (
                <NativeSelectOption key={agent.id} value={agent.id}>
                  {agent.name ?? agent.email ?? agent.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              عرض التقارير
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ title, value, hint }: { title: string; value: number | string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardHeader>
    </Card>
  );
}

async function resolveSearchParams(params?: SearchParams | Promise<SearchParams>) {
  if (!params) return {} as SearchParams;
  if (typeof (params as any)?.then === "function") {
    return (await params) as SearchParams;
  }
  return params;
}

function resolveDateRange(params: SearchParams) {
  const now = new Date();
  const defaultTo = new Date(now);
  defaultTo.setHours(23, 59, 59, 999);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - 6);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromCandidate = parseDate(params.from);
  const toCandidate = parseDate(params.to);

  const fromDate = startOfDay(fromCandidate ?? defaultFrom);
  const toDate = endOfDay(toCandidate ?? defaultTo);

  return { fromDate, toDate };
}

function parseDate(value: string | string[] | undefined) {
  if (!value || Array.isArray(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatDateInput(date: Date) {
  return date.toISOString().split("T")[0] ?? "";
}

function formatDateLabel(iso: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatRelative(iso: string | null) {
  if (!iso) return "—";
  const formatter = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  const target = new Date(iso);
  const diffMs = target.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  return formatter.format(diffHours, "hour");
}
