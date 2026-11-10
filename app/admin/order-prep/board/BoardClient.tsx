'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, RotateCcw, Settings2, UserX } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type { BoardData } from '@/app/lib/order-prep/board';
import { formatAgeAr, orderAgeMs } from '@/app/lib/order-prep/riyadh-time';
import type { PrepSettings } from '@/app/lib/order-prep/settings';
import { cn } from '@/lib/utils';

const REFRESH_MS = 15_000;

const REASON_LABELS: Record<string, string> = {
  missing_items: 'نقص (X4)',
  coming_soon: 'سيتوفر قريباً',
  manual_review: 'مراجعة',
  promo_limit: 'حد عرض الريال',
};

const KIND_LABELS: Record<string, string> = { packed: 'تم التجهيز', exception: 'مشكلة', requeue: 'إعادة للتجهيز' };

const sinceLabel = (iso: string) => formatAgeAr(Math.max(0, Date.now() - Date.parse(iso)));

export default function BoardClient() {
  const { toast } = useToast();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PrepSettings | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/order-prep/v2/board', { cache: 'no-store' });
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
    async (key: string, body: Record<string, unknown>, success: string) => {
      setBusy(key);
      try {
        const response = await fetch('/api/order-prep/v2/board/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ الإجراء');
        toast({ description: success });
        await load();
        return data;
      } catch (err) {
        toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
        return null;
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

  const oldestAge = orderAgeMs(board.stats.oldestPlacedAt);
  const settings = settingsDraft ?? board.settings;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="بالانتظار" value={board.stats.waiting} />
        <Kpi label="أقدم طلب" text={formatAgeAr(oldestAge)} danger={oldestAge !== null && oldestAge > 48 * 3_600_000} />
        <Kpi label="أنجز اليوم" value={board.packedToday} />
        <Kpi label="آخر ساعة" value={board.packedLastHour} />
        <Kpi label="مجهِّزون نشطون" value={board.packers.filter((packer) => packer.current).length} />
        <Kpi label="بانتظار مزامنة سلة" value={board.pendingSync.count} danger={board.pendingSync.count > 20} />
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-base font-bold">عمر الطلبات بالانتظار</h2>
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <Bucket label="أقل من يوم" value={board.stats.buckets.lt24h} />
          <Bucket label="1–2 يوم" value={board.stats.buckets.d1to2} tone="warn" />
          <Bucket label="2–4 أيام" value={board.stats.buckets.d2to4} tone="danger" />
          <Bucket label="أكثر من 4 أيام" value={board.stats.buckets.gt4d} tone="danger" />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">المجهِّزون</h2>
          <button type="button" onClick={() => void load()} className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCcw className="h-3.5 w-3.5" /> تحديث
          </button>
        </div>
        {board.packers.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا يوجد نشاط اليوم.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-right">
                  <th className="p-2">المجهِّز</th>
                  <th className="p-2">الطلب الحالي</th>
                  <th className="p-2">التالي</th>
                  <th className="p-2">اليوم</th>
                  <th className="p-2">بالساعة</th>
                  <th className="p-2">بالمسح</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {board.packers.map((packer) => (
                  <tr key={packer.userId} className="border-t">
                    <td className="p-2 font-semibold">{packer.name}</td>
                    <td className="p-2">
                      {packer.current ? (
                        <span className="flex items-center gap-2">
                          <span dir="ltr" className="font-mono">#{packer.current.orderNumber}</span>
                          {packer.current.minutes !== null && (
                            <span className={cn('rounded px-1.5 text-xs', packer.current.minutes > 10 ? 'bg-amber-100 text-amber-800' : 'text-muted-foreground')}>
                              {packer.current.minutes} د
                            </span>
                          )}
                          {packer.current.verifyIssue && <AlertTriangle className="h-4 w-4 text-red-600" />}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 font-mono" dir="ltr">
                      {packer.next ? `#${packer.next.orderNumber}` : '—'}
                    </td>
                    <td className="p-2 font-bold">{packer.completedToday}</td>
                    <td className="p-2">{packer.perHour ?? '—'}</td>
                    <td className="p-2">
                      {packer.completedToday > 0 ? `${Math.round((packer.scannedToday / packer.completedToday) * 100)}%` : '—'}
                    </td>
                    <td className="p-2 text-left">
                      {(packer.current || packer.next) && (
                        <button
                          type="button"
                          disabled={busy === `release-${packer.userId}`}
                          onClick={() => {
                            if (window.confirm(`إرجاع طلبات ${packer.name} إلى القائمة؟`)) {
                              void act(`release-${packer.userId}`, { action: 'release_packer', userId: packer.userId }, 'أُعيدت الطلبات للقائمة');
                            }
                          }}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                        >
                          <UserX className="h-3.5 w-3.5" /> إرجاع طلباته
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 text-base font-bold">الاستثناءات المفتوحة ({board.exceptions.length})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          طلبات خرجت من التجهيز بسبب نقص أو مراجعة. «إعادة للتجهيز» تعيدها إلى «طلب جديد» فتدخل القائمة من جديد.
        </p>
        {board.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد استثناءات مفتوحة.</p>
        ) : (
          <div className="space-y-2">
            {board.exceptions.map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono font-bold">#{item.orderNumber || item.orderId}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    {REASON_LABELS[item.reason] ?? item.reason}
                  </span>
                  {item.sync && item.sync.state !== 'synced' && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">سلة: {item.sync.state}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.createdByName ?? ''} · {sinceLabel(item.createdAt)}
                  </span>
                </div>
                {item.notes && <p className="mt-2 whitespace-pre-line text-xs text-foreground">{item.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === `requeue-${item.id}`}
                    onClick={() => void act(`requeue-${item.id}`, { action: 'requeue_escalation', escalationId: item.id }, 'أُعيد الطلب للتجهيز')}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> إعادة للتجهيز
                  </button>
                  <button
                    type="button"
                    disabled={busy === `refund-${item.id}`}
                    onClick={() =>
                      void act(`refund-${item.id}`, { action: 'resolve_escalation', escalationId: item.id, resolution: 'refunded' }, 'سُجّل الإرجاع')
                    }
                    className="rounded-md border px-3 py-1.5 text-xs font-semibold"
                  >
                    تم إرجاع المبلغ
                  </button>
                  <button
                    type="button"
                    disabled={busy === `handled-${item.id}`}
                    onClick={() =>
                      void act(`handled-${item.id}`, { action: 'resolve_escalation', escalationId: item.id, resolution: 'handled' }, 'أُغلق الاستثناء')
                    }
                    className="rounded-md border px-3 py-1.5 text-xs font-semibold"
                  >
                    عولج خارج التجهيز
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 text-base font-bold">مشاكل مزامنة سلة ({board.syncIssues.length})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          تحديثات حالة لم تُطبَّق في سلة. «تعارض» يعني أن حالة الطلب في سلة تغيّرت (مثلاً أُلغي) فلم نكتب فوقها.
          {board.pendingSync.oldestAt ? ` أقدم تحديث معلّق: ${sinceLabel(board.pendingSync.oldestAt)}.` : ''}
        </p>
        {board.syncIssues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> لا توجد مشاكل.
          </p>
        ) : (
          <div className="space-y-2">
            {board.syncIssues.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span dir="ltr" className="font-mono font-bold">#{job.orderNumber || job.orderId}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{KIND_LABELS[job.kind] ?? job.kind}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', job.state === 'conflict' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800')}>
                  {job.state === 'conflict' ? 'تعارض' : `فشل (${job.attempts})`}
                </span>
                <span className="flex-1 text-xs text-muted-foreground">{job.lastError}</span>
                <button
                  type="button"
                  disabled={busy === `retry-${job.id}`}
                  onClick={() => void act(`retry-${job.id}`, { action: 'retry_sync', jobId: job.id }, 'تمت المزامنة')}
                  className="rounded-md border px-2 py-1 text-xs font-semibold"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  disabled={busy === `dismiss-${job.id}`}
                  onClick={() => void act(`dismiss-${job.id}`, { action: 'dismiss_sync', jobId: job.id }, 'أُخفي')}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground"
                >
                  إخفاء
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
          <Settings2 className="h-4 w-4" /> الإعدادات
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">ترتيب القائمة</span>
            <select
              value={settings.priorityMode}
              onChange={(event) => setSettingsDraft({ ...settings, priorityMode: event.target.value as PrepSettings['priorityMode'] })}
              className="w-full rounded-lg border bg-background p-2"
            >
              <option value="oldest_first">الأقدم أولاً (الافتراضي)</option>
              <option value="regular_first">وضع الحملة: الطلبات العادية قبل عرض الريال</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">في وضع الحملة: يتقدّم طلب العرض بعد (ساعة)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={settings.promoAgingHours}
              onChange={(event) => setSettingsDraft({ ...settings, promoAgingHours: Number(event.target.value) })}
              className="w-full rounded-lg border bg-background p-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">مسح الباركود</span>
            <select
              value={settings.scanMode}
              onChange={(event) => setSettingsDraft({ ...settings, scanMode: event.target.value as PrepSettings['scanMode'] })}
              className="w-full rounded-lg border bg-background p-2"
            >
              <option value="optional">اختياري (يُسجَّل التأكيد اليدوي)</option>
              <option value="required">إلزامي (مع خيار «الباركود لا يعمل»)</option>
              <option value="off">إيقاف</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">مهلة حجز الطلب (دقيقة)</span>
            <input
              type="number"
              min={3}
              max={120}
              value={settings.leaseMinutes}
              onChange={(event) => setSettingsDraft({ ...settings, leaseMinutes: Number(event.target.value) })}
              className="w-full rounded-lg border bg-background p-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={settings.v2Enabled}
              onChange={(event) => setSettingsDraft({ ...settings, v2Enabled: event.target.checked })}
            />
            <span className="font-semibold">تفعيل صفحة التجهيز الجديدة لكل المجهِّزين</span>
            <span className="text-xs text-muted-foreground">(الصفحة القديمة تبقى على ‎/order-prep?v=1)</span>
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={!settingsDraft || busy === 'settings'}
            onClick={async () => {
              const result = await act('settings', { action: 'save_settings', settings }, 'حُفظت الإعدادات');
              if (result) setSettingsDraft(null);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            حفظ الإعدادات
          </button>
          {settingsDraft && (
            <button type="button" onClick={() => setSettingsDraft(null)} className="rounded-lg border px-4 py-2 text-sm">
              إلغاء
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, text, danger }: { label: string; value?: number; text?: string; danger?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-3', danger && 'border-red-300 bg-red-50')}>
      <div className={cn('text-2xl font-extrabold', danger ? 'text-red-700' : 'text-foreground')}>
        {text ?? (value ?? 0).toLocaleString('ar-SA')}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
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
      <div className="text-xl font-bold">{value.toLocaleString('ar-SA')}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
