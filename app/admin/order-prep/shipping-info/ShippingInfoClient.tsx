'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { formatAgeAr } from '@/app/lib/order-prep/riyadh-time';
import type { ShippingInfoSettings } from '@/app/lib/shipping-info/settings';

type Row = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  status: string;
  country: string | null;
  customerName: string | null;
  missingFields: string[];
  holdStatusSet: boolean;
  sentAt: string | null;
  sendError: string | null;
  reminderSentAt: string | null;
  submittedAt: string | null;
  appliedAt: string | null;
  lastError: string | null;
  resolvedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

type Board = {
  settings: ShippingInfoSettings;
  templateConfigured: boolean;
  open: Row[];
  recent: Row[];
};

type Action = 'resend' | 'retry' | 'release';

const REFRESH_MS = 30_000;
const STAFF_AFTER_MS = 48 * 60 * 60_000;
const since = (iso: string | null) => (iso ? formatAgeAr(Math.max(0, Date.now() - Date.parse(iso))) : '—');

const MISSING: Record<string, string> = { name: 'الاسم الثلاثي', district: 'الحي', street: 'الشارع' };
const STATUS: Record<string, string> = {
  pending: 'بانتظار العميلة',
  applying: 'قيد التحديث في سلة',
  failed: 'فشل التحديث في سلة',
  applied: 'اكتمل وعاد للطلبات الجديدة',
  released: 'أُطلق بدون تعديل',
  cancelled: 'ملغي',
};

export default function ShippingInfoClient() {
  const { toast } = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: Action; row: Row } | null>(null);
  const [holdStatusId, setHoldStatusId] = useState('');
  const [pilotMobiles, setPilotMobiles] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/shipping-info/admin', { cache: 'no-store' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'تعذر التحميل');
      setBoard(data);
    } catch (error) {
      toast({ title: 'تعذر التحميل', description: error instanceof Error ? error.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!board) return;
    setHoldStatusId(board.settings.holdStatusId);
    setPilotMobiles(board.settings.pilotMobiles.join(', '));
    // Only when the saved settings change, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.settings.holdStatusId, board?.settings.pilotMobiles.join(',')]);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch('/api/shipping-info/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'لم يتم');
      toast({ title: 'تم' });
      await load();
    } catch (error) {
      toast({ title: 'لم يتم', description: error instanceof Error ? error.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !board) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (!board) return null;

  const { settings } = board;
  const needsStaff = board.open.filter(
    (row) => row.status === 'failed' || Date.now() - Date.parse(row.createdAt) > STAFF_AFTER_MS || row.sendError,
  );
  const waiting = board.open.filter((row) => !needsStaff.includes(row));

  const actionLabel: Record<Action, string> = { resend: 'إعادة إرسال الرابط', retry: 'إعادة المحاولة في سلة', release: 'إطلاق بدون تعديل' };

  const card = (row: Row, withActions = true) => (
    <div key={row.id} className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          #{row.orderNumber || row.orderId} <span className="text-sm font-normal text-neutral-500">· {row.country || '—'}</span>
        </div>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs">{STATUS[row.status] ?? row.status}</span>
      </div>
      <div className="mt-2 grid gap-1 text-sm text-neutral-600 sm:grid-cols-2">
        <div>الاسم الحالي: {row.customerName || '—'}</div>
        <div>الناقص: {row.missingFields.map((f) => MISSING[f] ?? f).join('، ') || '—'}</div>
        <div>أُرسل الرابط: {row.sentAt ? `منذ ${since(row.sentAt)}` : 'لم يُرسل'}</div>
        <div>التذكير: {row.reminderSentAt ? `منذ ${since(row.reminderSentAt)}` : '—'}</div>
        <div>موقوف منذ: {since(row.createdAt)}</div>
        <div>الحالة في سلة: {row.holdStatusSet ? 'بانتظار استكمال البيانات' : 'لم تتغير (موقوف في التطبيق فقط)'}</div>
      </div>
      {row.sendError ? <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">خطأ الإرسال: {row.sendError}</div> : null}
      {row.lastError ? <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">آخر خطأ: {row.lastError}</div> : null}
      {withActions ? (
      <div className="mt-3 flex flex-wrap gap-2">
        {(['resend', 'retry', 'release'] as Action[])
          .filter((action) => action !== 'retry' || row.submittedAt)
          .filter((action) => action !== 'resend' || !row.submittedAt)
          .map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy !== null}
              onClick={() => setPending({ action, row })}
              className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
                action === 'release' ? 'border-rose-300 text-rose-700' : 'border-neutral-300'
              }`}
            >
              {busy === `${action}:${row.id}` ? <Loader2 className="inline h-4 w-4 animate-spin" /> : actionLabel[action]}
            </button>
          ))}
      </div>
      ) : row.resolvedByName ? (
        <div className="mt-2 text-xs text-neutral-500">بواسطة: {row.resolvedByName}</div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">الإعدادات</h2>
          <button type="button" onClick={load} className="text-neutral-500" aria-label="تحديث">
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>
        {!board.templateConfigured ? (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            قالب واتساب غير مضبوط (ZOKO_TPL_SHIPPING_INFO_REQUEST): الطلبات ستُوقف لكن لن تصل الرسالة للعميلة.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy !== null || (!settings.enabled && !settings.holdStatusId)}
            onChange={(e) => post({ action: 'settings', settings: { enabled: e.target.checked } }, 'settings')}
          />
          تفعيل إيقاف الطلبات الدولية الناقصة
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            رقم حالة سلة «بانتظار استكمال بيانات الشحن»
            <input
              value={holdStatusId}
              onChange={(e) => setHoldStatusId(e.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              dir="ltr"
            />
          </label>
          <label className="text-sm">
            أرقام التجربة (فارغ = الجميع)
            <input
              value={pilotMobiles}
              onChange={(e) => setPilotMobiles(e.target.value)}
              placeholder="+9665..., +9715..."
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              dir="ltr"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => post({ action: 'settings', settings: { holdStatusId, pilotMobiles } }, 'settings')}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          حفظ
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">تحتاج متابعة ({needsStaff.length})</h2>
        <p className="text-xs text-neutral-500">موقوفة أكثر من 48 ساعة، أو فشل تحديثها في سلة، أو تعذر إرسال الرسالة. تواصلي مع العميلة.</p>
        {needsStaff.length === 0 ? <p className="text-sm text-neutral-400">لا يوجد</p> : needsStaff.map((row) => card(row))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">بانتظار العميلة ({waiting.length})</h2>
        {waiting.length === 0 ? <p className="text-sm text-neutral-400">لا يوجد</p> : waiting.map((row) => card(row))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">آخر ما أُغلق</h2>
        {board.recent.length === 0 ? <p className="text-sm text-neutral-400">لا يوجد</p> : board.recent.map((row) => card(row, false))}
      </section>

      <ConfirmationDialog
        open={pending !== null}
        title={pending ? actionLabel[pending.action] : ''}
        message={
          pending?.action === 'release'
            ? 'سيعود الطلب لـ«طلب جديد» ويُجهّز بالبيانات الحالية الناقصة. متأكدة؟'
            : pending?.action === 'resend'
              ? 'سيُرسل رابط استكمال البيانات للعميلة مرة أخرى عبر واتساب.'
              : 'سيُعاد إرسال البيانات التي أدخلتها العميلة إلى سلة.'
        }
        confirmLabel="تأكيد"
        cancelLabel="تراجع"
        confirmVariant={pending?.action === 'release' ? 'danger' : 'primary'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          const { action, row } = pending;
          setPending(null);
          post({ action, id: row.id }, `${action}:${row.id}`);
        }}
      />
    </div>
  );
}
