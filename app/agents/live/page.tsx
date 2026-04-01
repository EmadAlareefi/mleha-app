import { AutoRefresh } from "@/components/AutoRefresh";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLiveMonitorSnapshot } from "@/app/lib/zoko-insights";

export const dynamic = "force-dynamic";

export default async function LiveMonitorPage() {
  const snapshot = await getLiveMonitorSnapshot();
  const generatedAt = new Date(snapshot.generatedAt);

  return (
    <div className="space-y-6 p-6">
      <AutoRefresh interval={20000} />
      <section>
        <h1 className="text-2xl font-bold">مراقبة أداء وكلاء المحادثات</h1>
        <p className="text-sm text-muted-foreground">
          آخر تحديث عند {formatDateTime(generatedAt)} - يتم التحديث كل 20 ثانية تلقائيًا
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="محادثات مفتوحة" value={snapshot.totals.openChats.toString()} hint="عدد المحادثات النشطة الآن" />
        <StatCard
          title="عملاء ينتظرون رد"
          value={snapshot.totals.waitingCustomers.toString()}
          hint={`متوسط الانتظار ${snapshot.totals.averageWaitMinutes} دقيقة`}
        />
        <StatCard
          title="محادثات بلا تعيين"
          value={snapshot.totals.unassignedChats.toString()}
          hint="تحتاج إلى توزيع على وكيل"
        />
        <StatCard
          title="آخر مزامنة"
          value={formatClock(generatedAt)}
          hint={formatDateTime(generatedAt)}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>أحمال الوكلاء الحالية</CardTitle>
            <CardDescription>آخر عمليات التعيين ومستوى الضغط لكل وكيل</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوكيل</TableHead>
                  <TableHead>محادثات نشطة</TableHead>
                  <TableHead>ينتظر رد</TableHead>
                  <TableHead>آخر تعيين</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.agentLoad.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      لا توجد تعيينات حالية
                    </TableCell>
                  </TableRow>
                )}
                {snapshot.agentLoad.map((agent) => (
                  <TableRow key={`${agent.agentId ?? "na"}-${agent.agentEmail ?? "unknown"}`}>
                    <TableCell>
                      <div className="font-medium">{agent.agentName}</div>
                      <div className="text-xs text-muted-foreground">
                        {agent.agentEmail ?? "بدون بريد"}
                      </div>
                    </TableCell>
                    <TableCell>{agent.activeChats}</TableCell>
                    <TableCell>{agent.waitingChats}</TableCell>
                    <TableCell>{formatRelativeTime(agent.lastAssignedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>آخر الرسائل</CardTitle>
            <CardDescription>آخر عشرين رسالة واردة أو صادرة</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {snapshot.recentMessages.length === 0 && (
                <li className="text-sm text-muted-foreground">لا توجد رسائل بعد</li>
              )}
              {snapshot.recentMessages.map((message) => (
                <li key={message.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{directionLabel(message.direction)}</span>
                    <span>{formatRelativeTime(message.platformTimestamp)}</span>
                  </div>
                  <div className="text-sm font-semibold">{message.senderName ?? "بدون اسم"}</div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {message.text ?? "بدون نص"}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>المحادثات النشطة</CardTitle>
          <CardDescription>أحدث المحادثات التي ما تزال مفتوحة</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>الوكيل المسؤول</TableHead>
                <TableHead>آخر رسالة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.activeChats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    لا توجد محادثات حالية
                  </TableCell>
                </TableRow>
              )}
              {snapshot.activeChats.map((chat) => (
                <TableRow key={chat.id}>
                  <TableCell>
                    <div className="font-semibold">{chat.customerName ?? chat.platformSenderId}</div>
                    <div className="text-xs text-muted-foreground">{chat.platform ?? "غير معروف"}</div>
                  </TableCell>
                  <TableCell>
                    {chat.assignedAgent ? (
                      <>
                        <div className="font-medium">{chat.assignedAgent.agentName}</div>
                        <div className="text-xs text-muted-foreground">
                          عُيّنت {formatRelativeTime(chat.assignedAgent.assignedAt)}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">بلا تعيين</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{chat.lastMessageText ?? "بدون نص"}</div>
                    <div className="text-xs text-muted-foreground">
                      {directionLabel(chat.lastDirection)} • {formatRelativeTime(chat.lastMessageAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full bg-secondary px-2 py-1 text-xs">
                      {chat.status === "closed" ? "مغلقة" : "نشطة"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardHeader>
    </Card>
  );
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(iso: string | null) {
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

function directionLabel(direction: string | null | undefined) {
  if (direction === "FROM_CUSTOMER") return "من العميل";
  if (direction === "FROM_STORE") return "من فريق مليحة";
  return "غير محدد";
}
