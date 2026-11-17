'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { BoardChange, OrderManageBoard } from '@/app/lib/order-manage/board';
import type { OrderManageSettings } from '@/app/lib/order-manage/settings';
import { formatAgeAr } from '@/app/lib/order-prep/riyadh-time';

const REFRESH_MS = 30_000;
const since = (iso: string) => formatAgeAr(Math.max(0, Date.now() - Date.parse(iso)));
const money = (value: number | null, currency: string | null) =>
  value === null ? '—' : `${value.toFixed(2)} ${!currency || currency === 'SAR' ? 'ر.س' : currency}`;

const KIND: Record<string, string> = { cancel: 'إلغاء', address: 'تعديل العنوان', swap: 'تغيير مقاس/لون', items: 'تعديل المنتجات' };
const STATE: Record<string, string> = {
  held: 'محجوز',
  applying: 'قيد التنفيذ',
  awaiting_payment: 'بانتظار الدفع',
  completed: 'تم',
  failed: 'لم يتم',
  needs_staff: 'يحتاج مراجعة',
};
const REFUND: Record<string, string> = {
  none: '',
  not_needed: 'لا يوجد استرجاع',
  requested: 'الاسترجاع قيد الإرسال',
  refunded: 'تم الاسترجاع',
  manual: 'استرجاع يدوي مطلوب',
  failed: 'فشل الاسترجاع',
  unknown: 'نتيجة الاسترجاع غير مؤكدة',
};
const PAYMENT: Record<string, string> = {
  mada: 'مدى',
  credit_card: 'بطاقة ائتمانية',
  tamara_installment: 'تمارا',
  tabby_installment: 'تابي',
  stc_pay: 'STC Pay',
  bank: 'تحويل بنكي',
  free: 'مجاني',
  customer_wallet: 'محفظة العميل',
};

type Action = 'resolve_cancel' | 'refund_done' | 'refund_not_sent' | 'refund_retry';
type Pending = { action: Action; change: BoardChange; title: string; message: string; danger?: boolean };

export default function CustomerChangesClient() {
  const { toast } = useToast();
  const [board, setBoard] = useState<OrderManageBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pilotDraft, setPilotDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/order-manage/admin', { cache: 'no-store' });
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

  const post = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      setBusy(key);
      try {
        const response = await fetch('/api/order-manage/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || data.message || 'تعذر تنفيذ الإجراء');
        if (data.message) toast({ description: data.message });
        await load();
        return true;
      } catch (err) {
        toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
        await load();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  const saveSettings = (patch: Partial<OrderManageSettings>) => post('settings', { action: 'settings', settings: patch });

  if (!board) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        {error ? <span className="text-red-700">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> جاري التحميل...</>}
      </div>
    );
  }

  const { settings } = board;
  const ask = (action: Action, change: BoardChange) => {
    const order = `#${change.orderNumber ?? change.orderId}`;
    const amount = money(change.refundAmount ?? change.orderTotal, change.currency);
    const prompts: Record<Action, Omit<Pending, 'action' | 'change'>> = {
      resolve_cancel: {
        title: `التحقق من الطلب ${order} في سلة`,
        message: 'سنقرأ حالة الطلب من سلة الآن. إن كان ملغياً أُنهي الطلب وبدأ الاسترجاع، وإن لم يكن ملغياً أُعيد إلى طابور التجهيز.',
      },
      refund_done: {
        title: `تسجيل استرجاع ${amount} للطلب ${order}`,
        message: 'أكّد فقط بعد أن أعدت المبلغ للعميل فعلاً (من سلة، تابي، أو تحويل بنكي). لن يُرسل أي مبلغ من هنا.',
      },
      refund_not_sent: {
        title: `الاسترجاع لم يتم للطلب ${order}؟`,
        message: 'أكّد فقط بعد التحقق من عمليات الدفع في سلة أن المبلغ لم يُسترجع. بعدها يمكن إعادة الاسترجاع.',
        danger: true,
      },
      refund_retry: {
        title: `استرجاع ${amount} عبر سلة للطلب ${order}`,
        message: 'سيُرسل طلب استرجاع كامل المبلغ إلى وسيلة الدفع الأصلية عبر سلة الآن.',
        danger: true,
      },
    };
    setPending({ action, change, ...prompts[action] });
  };

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {settings.enabled ? 'الخدمة مفعّلة' : 'الخدمة متوقفة'}
          {settings.enabled && settings.pilotMobiles.length > 0 ? ` — تجريبية لـ ${settings.pilotMobiles.length} رقم` : ''}
        </p>
        <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm">
          <RefreshCcw className="h-4 w-4" /> تحديث
        </button>
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <ChangeList
        title="يحتاج تدخلاً"
        empty="لا شيء يحتاج تدخلاً."
        tone="danger"
        changes={board.attention}
        busy={busy}
        actionsFor={(change) => {
          const actions: Array<[Action, string]> = [];
          if (change.state === 'needs_staff' && change.writeStatus === 'unknown' && change.kind === 'cancel') {
            actions.push(['resolve_cancel', 'تحقق من سلة']);
          }
          if (change.refundStatus === 'unknown') actions.push(['refund_done', 'تم الاسترجاع'], ['refund_not_sent', 'لم يتم الاسترجاع']);
          if (change.refundStatus === 'failed') actions.push(['refund_retry', 'استرجاع عبر سلة'], ['refund_done', 'استرجعته يدوياً']);
          return actions;
        }}
        onAction={ask}
      />

      <ChangeList
        title="استرجاع يدوي مطلوب"
        empty="لا توجد مبالغ بانتظار الاسترجاع."
        tone="warn"
        changes={board.manualRefunds}
        busy={busy}
        actionsFor={() => [
          ['refund_retry', 'استرجاع عبر سلة'],
          ['refund_done', 'استرجعته يدوياً'],
        ]}
        onAction={ask}
      />

      <ChangeList title="آخر التعديلات" empty="لم يستخدم أي عميل الخدمة بعد." changes={board.recent} busy={busy} />

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-base font-bold">الإعدادات</h2>
        <div className="flex flex-col gap-3 text-sm">
          <Toggle
            label="تفعيل صفحة إدارة الطلب للعملاء"
            hint="المفتاح الرئيسي. عند الإيقاف تظهر الصفحة للعميل كغير متاحة. ما بدأ قبل الإيقاف يكتمل."
            value={settings.enabled}
            busy={busy === 'settings'}
            onChange={(value) => void saveSettings({ enabled: value })}
          />
          <Toggle
            label="إلغاء الطلب"
            hint="يلغي العميل طلبه قبل أن يستلمه المجهز، ويُعاد المخزون."
            value={settings.cancelEnabled}
            busy={busy === 'settings'}
            onChange={(value) => void saveSettings({ cancelEnabled: value })}
          />
          <Toggle
            label="تغيير المقاس"
            hint="تغيير مقاس قطعة بنفس السعر، يُعدّل في سلة مباشرة."
            value={settings.swapEnabled}
            busy={busy === 'settings'}
            onChange={(value) => void saveSettings({ swapEnabled: value })}
          />
          <Toggle
            label="إلغاء قطعة أو تغيير المنتج"
            hint="إلغاء قطع مفردة أو استبدالها بمنتج آخر. الفرق يُسترد تلقائياً، والزيادة تُدفع برابط سلة خلال 30 دقيقة وإلا يُلغى التعديل."
            value={settings.itemsEnabled}
            busy={busy === 'settings'}
            onChange={(value) => void saveSettings({ itemsEnabled: value })}
          />
          <Toggle
            label="استرجاع المبلغ تلقائياً"
            hint="بعد إلغاء الطلب أو قطع منه: لمدى والبطاقات وتمارا و STC Pay فقط، وبالريال. عند الإيقاف يدخل كل استرجاع قائمة الاسترجاع اليدوي."
            value={settings.autoRefundEnabled}
            busy={busy === 'settings'}
            onChange={(value) => void saveSettings({ autoRefundEnabled: value })}
          />
          <NumberSetting
            label="الحد اليومي للاسترجاع التلقائي (ر.س)"
            hint="ما زاد عنه في آخر 24 ساعة يدخل قائمة الاسترجاع اليدوي."
            value={settings.autoRefundDailyCapSar}
            min={0}
            max={1_000_000}
            busy={busy === 'settings'}
            onSave={(value) => void saveSettings({ autoRefundDailyCapSar: value })}
          />
          <NumberSetting
            label="أقصى عدد تعديلات للطلب الواحد"
            hint="بعدها يُحوَّل العميل لخدمة العملاء."
            value={settings.maxChangesPerOrder}
            min={1}
            max={10}
            busy={busy === 'settings'}
            onSave={(value) => void saveSettings({ maxChangesPerOrder: value })}
          />
          <div className="rounded-lg border p-3">
            <label htmlFor="pilot-mobiles" className="block font-semibold">
              أرقام التجربة
            </label>
            <p className="text-xs text-muted-foreground">
              ما دامت القائمة غير فارغة تعمل الخدمة لطلبات هذه الأرقام فقط. رقم في كل سطر. اتركها فارغة لفتح الخدمة للجميع.
            </p>
            <textarea
              id="pilot-mobiles"
              dir="ltr"
              rows={3}
              className="mt-2 w-full rounded-lg border p-2 font-mono text-sm"
              value={pilotDraft ?? settings.pilotMobiles.join('\n')}
              onChange={(event) => setPilotDraft(event.target.value)}
            />
            <button
              type="button"
              disabled={busy !== null || pilotDraft === null}
              onClick={async () => {
                if (await saveSettings({ pilotMobiles: (pilotDraft ?? '').split(/[\n,]/) })) setPilotDraft(null);
              }}
              className="mt-2 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              حفظ الأرقام
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            رمز التحقق يُرسل {board.whatsappCodeTemplate ? 'عبر واتساب، ثم برسالة نصية إن تعذر' : 'برسالة نصية (قالب واتساب للرمز غير مضبوط بعد)'}.
          </p>
        </div>
      </section>

      <ConfirmationDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message}
        confirmLabel="تأكيد"
        cancelLabel="تراجع"
        confirmVariant={pending?.danger ? 'danger' : 'primary'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          const { action, change } = pending;
          setPending(null);
          void post(`${action}:${change.id}`, { action, changeId: change.id });
        }}
      />
    </div>
  );
}

function ChangeList({
  title,
  empty,
  tone,
  changes,
  busy,
  actionsFor,
  onAction,
}: {
  title: string;
  empty: string;
  tone?: 'warn' | 'danger';
  changes: BoardChange[];
  busy: string | null;
  actionsFor?: (change: BoardChange) => Array<[Action, string]>;
  onAction?: (action: Action, change: BoardChange) => void;
}) {
  const highlighted = changes.length > 0 && tone;
  const frame = highlighted === 'danger' ? 'border-red-300 bg-red-50' : highlighted === 'warn' ? 'border-amber-300 bg-amber-50' : 'bg-card';
  return (
    <section className={`rounded-xl border p-4 ${frame}`}>
      <h2 className="mb-3 text-base font-bold">
        {title} <span className="text-muted-foreground">({changes.length})</span>
      </h2>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {changes.map((change) => (
            <li key={change.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-mono font-bold">#{change.orderNumber ?? change.orderId}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{KIND[change.kind] ?? change.kind}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{STATE[change.state] ?? change.state}</span>
              {REFUND[change.refundStatus] && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {REFUND[change.refundStatus]}
                  {change.refundAmount !== null ? ` — ${money(change.refundAmount, change.currency)}` : ''}
                </span>
              )}
              {change.paymentMethod && <span className="text-xs text-muted-foreground">{PAYMENT[change.paymentMethod] ?? change.paymentMethod}</span>}
              {change.holdActive && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">محجوز عن التجهيز</span>}
              <span className="text-xs text-muted-foreground">منذ {since(change.createdAt)}</span>
              {change.error && <span className="basis-full text-xs text-red-700">{change.error}</span>}
              {actionsFor && onAction && (
                <span className="mr-auto flex flex-wrap gap-2">
                  {actionsFor(change).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onAction(action, change)}
                      className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      {busy === `${action}:${change.id}` ? '...' : label}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle({ label, hint, value, busy, onChange }: { label: string; hint: string; value: boolean; busy: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" className="h-5 w-5 shrink-0" checked={value} disabled={busy} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  busy,
  onSave,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  busy: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = Number(draft);
  const valid = draft !== null && Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={min}
          max={max}
          className="w-28 rounded-lg border p-1.5 text-center"
          aria-label={label}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => {
            onSave(parsed);
            setDraft(null);
          }}
          className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          حفظ
        </button>
      </span>
    </div>
  );
}
