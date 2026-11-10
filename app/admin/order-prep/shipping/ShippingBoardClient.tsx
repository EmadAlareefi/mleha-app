'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw, RotateCcw, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type { BoardTask, ShippingBoardData } from '@/app/lib/shipping/board';
import { formatAgeAr } from '@/app/lib/order-prep/riyadh-time';
import { STATE_LABELS, type ShippingState } from '@/app/lib/shipping/rules';
import { cn } from '@/lib/utils';

const REFRESH_MS = 15_000;
const since = (iso: string) => formatAgeAr(Math.max(0, Date.now() - Date.parse(iso)));
const METHOD_LABELS: Record<string, string> = { salla: 'شركة شحن', international: 'دولي', local: 'مندوب' };

export default function ShippingBoardClient() {
  const { toast } = useToast();
  const [board, setBoard] = useState<ShippingBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/shipping-v2/board', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'تعذر تحميل اللوحة');
      setBoard(data.board);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل اللوحة');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      setBusy(key);
      try {
        const response = await fetch('/api/shipping-v2/board/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || data.message || 'تعذر تنفيذ الإجراء');
        if (data.message) toast({ description: data.message });
        await load();
      } catch (err) {
        toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  if (!board) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        {error ? <span className="text-red-700">{error}</span> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    );
  }

  const open = (state: ShippingState) => board.byState[state] ?? 0;
  const waitingLabel = open('queued') + open('creating') + open('awaiting_label');

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="البوليصة جاهزة" value={open('label_ready')} />
        <Kpi label="بانتظار البوليصة" value={waitingLabel} />
        <Kpi label="فشل / موقوف" value={open('failed') + open('blocked')} danger={open('failed') + open('blocked') > 0} />
        <Kpi label="طُبعت اليوم" value={board.printedToday} />
        <Kpi label="آخر ساعة" value={board.printedLastHour} />
        <Kpi label="دولي / مندوب" text={`${open('manual_international')} / ${open('needs_agent')}`} />
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-base font-bold">مجهّزة ولم تُطبع بوليصتها</h2>
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <Bucket label="أقل من ساعة" value={board.waitingByAge.under1h} />
          <Bucket label="1–4 ساعات" value={board.waitingByAge.h1to4} tone="warn" />
          <Bucket label="4–24 ساعة" value={board.waitingByAge.h4to24} tone="danger" />
          <Bucket label="أكثر من يوم" value={board.waitingByAge.over24h} tone="danger" />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">الشاحنون اليوم</h2>
          <button type="button" onClick={() => void load()} className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCcw className="h-3.5 w-3.5" /> تحديث
          </button>
        </div>
        {board.shippers.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد بوالص مطبوعة اليوم من المحطة الجديدة.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-right">
                <th className="py-1">الشاحن</th>
                <th>اليوم</th>
                <th>الوتيرة (وسيط)</th>
                <th>آخر بوليصة</th>
              </tr>
            </thead>
            <tbody>
              {board.shippers.map((shipper) => (
                <tr key={shipper.name} className="border-t">
                  <td className="py-2 font-semibold">{shipper.name}</td>
                  <td>{shipper.printedToday}</td>
                  <td>{shipper.medianGapSeconds !== null ? `${shipper.medianGapSeconds} ث` : '—'}</td>
                  <td>{shipper.lastPrintedAt ? `منذ ${since(shipper.lastPrintedAt)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <TaskList
        title="تحتاج تدخلاً"
        empty="لا توجد أعطال."
        tasks={board.problems}
        busy={busy}
        onRetry={(task) => void act(`retry:${task.id}`, { action: 'retry', taskId: task.id })}
        onClose={(task) => {
          const note = task.hasSallaShipment ? '\nللطلب بوليصة في سلة — ألغها من سلة إن لزم.' : '';
          if (window.confirm(`إغلاق مهمة الطلب #${task.orderNumber}؟${note}`)) void act(`close:${task.id}`, { action: 'close', taskId: task.id });
        }}
      />
      <TaskList title="دولي — بانتظار شحنة DHL" empty="لا توجد طلبات دولية بالانتظار." tasks={board.international} busy={busy} />
      <TaskList title="توصيل محلي — بانتظار المندوب" empty="لا توجد طلبات محلية بالانتظار." tasks={board.local} busy={busy} />

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-base font-bold">الإعدادات</h2>
        <div className="flex flex-col gap-3 text-sm">
          <Toggle
            label="إنشاء الشحنة تلقائياً بعد التجهيز"
            hint="عند الإيقاف تُنشأ الشحنة عند مسح الطلب في محطة الشحن."
            value={board.settings.precreateEnabled}
            busy={busy === 'settings'}
            onChange={(value) => void act('settings', { action: 'settings', settings: { precreateEnabled: value } })}
          />
          <Toggle
            label="صفحة الشحن الجديدة للجميع"
            hint="الصفحة القديمة تبقى متاحة على /order-shipping?v=1"
            value={board.settings.v2Enabled}
            busy={busy === 'settings'}
            onChange={(value) => void act('settings', { action: 'settings', settings: { v2Enabled: value } })}
          />
        </div>
      </section>
    </div>
  );
}

function TaskList({
  title,
  empty,
  tasks,
  busy,
  onRetry,
  onClose,
}: {
  title: string;
  empty: string;
  tasks: BoardTask[];
  busy: string | null;
  onRetry?: (task: BoardTask) => void;
  onClose?: (task: BoardTask) => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-base font-bold">
        {title} <span className="text-muted-foreground">({tasks.length})</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-mono font-bold">#{task.orderNumber ?? task.orderId}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{METHOD_LABELS[task.method] ?? task.method}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{STATE_LABELS[task.state] ?? task.state}</span>
              <span className="text-xs text-muted-foreground">منذ {since(task.createdAt)}</span>
              {(task.blockReason || task.lastError) && (
                <span className="basis-full text-xs text-red-700">{task.blockReason || task.lastError}</span>
              )}
              {(onRetry || onClose) && (
                <span className="mr-auto flex gap-2">
                  {onRetry && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onRetry(task)}
                      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> إعادة المحاولة
                    </button>
                  )}
                  {onClose && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onClose(task)}
                      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> تمت المعالجة
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Kpi({ label, value, text, danger }: { label: string; value?: number; text?: string; danger?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-3', danger && 'border-red-300 bg-red-50')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-black', danger && 'text-red-700')}>{text ?? value ?? 0}</p>
    </div>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'danger' }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2',
        value > 0 && tone === 'warn' && 'border-amber-300 bg-amber-50',
        value > 0 && tone === 'danger' && 'border-red-300 bg-red-50',
      )}
    >
      <p className="text-xl font-black">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  busy,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" className="h-5 w-5" checked={value} disabled={busy} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
