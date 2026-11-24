'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CloudDownload,
  Eye,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type { CatalogCategory } from '@/app/lib/order-prep/priority-catalog';
import type { PriorityConfig, PriorityRule, QueueSort } from '@/app/lib/order-prep/priority-rules';
import type { QueuePreview } from '@/app/lib/order-prep/queue';
import type { PriorityMode } from '@/app/lib/order-prep/settings';
import { cn } from '@/lib/utils';
import { EmptyNote, Panel, PanelSkeleton } from './primitives';
import { describeMatch, field, KIND_LABEL, PriorityRuleEditor } from './PriorityRuleEditor';

type Campaign = { priorityMode: PriorityMode; promoAgingHours: number };
type Preview = QueuePreview & { emptyRules: string[] };
type FlaggedOrder = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
};
type Loaded = {
  config: PriorityConfig;
  campaign: Campaign;
  catalog: { at: number | null; rebuilding: boolean; categories: CatalogCategory[] };
  companies: string[];
  preview: Preview;
};
type Draft = { rules: PriorityRule[]; sort: QueueSort; maxWaitHours: number; campaign: Campaign };

const SORT_OPTIONS: Array<{ value: QueueSort; label: string }> = [
  { value: 'oldest_first', label: 'الأقدم أولاً (الافتراضي)' },
  { value: 'newest_first', label: 'الأحدث أولاً' },
  { value: 'price_desc', label: 'الأعلى قيمة أولاً' },
  { value: 'price_asc', label: 'الأقل قيمة أولاً' },
];

const dateTime = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const ageLabel = (iso: string | null) => {
  if (!iso) return '—';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 48) return `${hours} س`;
  return `${Math.floor(hours / 24)} يوم`;
};

const toDraft = (data: Loaded): Draft => ({
  rules: data.config.rules,
  sort: data.config.sort,
  maxWaitHours: data.config.maxWaitHours,
  campaign: data.campaign,
});

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.error || 'تعذر تنفيذ الإجراء') as Error & { data?: unknown };
    error.data = data;
    throw error;
  }
  return data as T;
}

/**
 * «الأولويات» tab: which orders packers get first. Specific orders (طلب مميز)
 * apply at once; rules, sort, max wait and campaign mode are edited as a
 * draft, previewed live against the real queue, then saved together.
 */
export function PriorityView() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<PriorityRule | 'new' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadedRef = useRef<Loaded | null>(null);
  /** Reloads; an unsaved draft is kept unless `reset` (after a save conflict). */
  const load = useCallback(async (reset = false) => {
    try {
      const data = await call<Loaded>('/api/order-prep/v2/priority/rules');
      const previous = loadedRef.current;
      loadedRef.current = data;
      setLoaded(data);
      setDraft((current) =>
        reset || !current || !previous || JSON.stringify(toDraft(previous)) === JSON.stringify(current) ? toDraft(data) : current,
      );
      setPreview(data.preview);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر التحميل');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => !!loaded && !!draft && JSON.stringify(toDraft(loaded)) !== JSON.stringify(draft), [loaded, draft]);

  // Live preview of the draft against the real queue (debounced).
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!draft || !loaded) return;
    if (!dirty) {
      setPreview(loaded.preview);
      return;
    }
    const seq = ++previewSeq.current;
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const data = await call<{ preview: Preview }>('/api/order-prep/v2/priority/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview', config: draft }),
        });
        if (seq === previewSeq.current) setPreview(data.preview);
      } catch {
        // keep the last preview; saving still works
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, dirty]);

  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const setRules = (rules: PriorityRule[]) => update({ rules });

  const save = async () => {
    if (!draft || !loaded) return;
    setSaving(true);
    try {
      const data = await call<{ message: string; config: PriorityConfig; campaign: Campaign; preview: Preview }>(
        '/api/order-prep/v2/priority/rules',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            baseUpdatedAt: loaded.config.updatedAt,
            config: { rules: draft.rules, sort: draft.sort, maxWaitHours: draft.maxWaitHours },
            campaign: draft.campaign,
          }),
        },
      );
      const next = { ...loaded, config: data.config, campaign: data.campaign, preview: data.preview };
      loadedRef.current = next;
      setLoaded(next);
      setDraft(toDraft(next));
      setEditing(null);
      toast({ description: data.message });
    } catch (err) {
      const conflict = (err as { data?: { conflict?: boolean } }).data?.conflict;
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر الحفظ' });
      if (conflict) await load(true);
    } finally {
      setSaving(false);
    }
  };

  const refreshCatalog = async () => {
    try {
      const data = await call<{ message: string }>('/api/order-prep/v2/priority/catalog', { method: 'POST' });
      toast({ description: data.message });
      setLoaded((current) => (current ? { ...current, catalog: { ...current.catalog, rebuilding: true } } : current));
    } catch (err) {
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر التحديث' });
    }
  };

  if (!loaded || !draft) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="قواعد الأولوية" Icon={ListOrdered}>
          {loadError ? (
            <div className="space-y-3 p-4 text-sm">
              <p className="font-bold text-rose-600">{loadError}</p>
              <button type="button" onClick={() => void load()} className="rounded-xl border border-[var(--lv-line)] px-4 py-2 font-bold">
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </Panel>
        <Panel title="معاينة الطابور" Icon={Eye}>
          <PanelSkeleton />
        </Panel>
      </div>
    );
  }

  const ruleIndex = new Map(draft.rules.map((rule, index) => [rule.id, index]));
  const move = (index: number, delta: number) => {
    const next = [...draft.rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + delta, 0, rule);
    setRules(next);
  };
  const upsertRule = (rule: PriorityRule) => {
    const index = draft.rules.findIndex((entry) => entry.id === rule.id);
    setRules(index === -1 ? [...draft.rules, rule] : draft.rules.map((entry) => (entry.id === rule.id ? rule : entry)));
    setEditing(null);
  };

  const catalogAge = loaded.catalog.at ? dateTime.format(loaded.catalog.at) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pb-24 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:overflow-hidden xl:pb-0">
      {/* Left: editor */}
      <div className="flex min-h-0 flex-col gap-4 xl:overflow-y-auto xl:pb-24">
        <OrderLegend />

        <Panel
          title="قواعد الأولوية"
          Icon={ListOrdered}
          count={draft.rules.length}
          className="h-auto shrink-0"
          bodyClassName="overflow-visible"
          actions={
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={loaded.catalog.rebuilding}
              title={catalogAge ? `آخر تحديث للتصنيفات والمنتجات: ${catalogAge}` : 'لم تُحمّل التصنيفات بعد'}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-[var(--lv-muted)] ring-1 ring-[var(--lv-line)] hover:bg-[var(--lv-hover)] disabled:opacity-60"
            >
              {loaded.catalog.rebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudDownload className="h-3 w-3" />}
              {loaded.catalog.rebuilding ? 'يُحدَّث من سلة…' : 'تحديث من سلة'}
            </button>
          }
        >
          <div className="space-y-3 p-4">
            {draft.rules.length === 0 && editing === null && (
              <EmptyNote icon="📋" title="لا توجد قواعد" hint="الطابور يعمل بالترتيب أدناه فقط. أضف قاعدة لتقديم أو تأخير طلبات معينة." />
            )}

            <ol className="space-y-2">
              {draft.rules.map((rule, index) =>
                editing !== 'new' && editing?.id === rule.id ? (
                  <li key={rule.id}>
                    <PriorityRuleEditor
                      initial={rule}
                      categories={loaded.catalog.categories}
                      companies={loaded.companies}
                      catalogReady={!!loaded.catalog.at}
                      onSave={upsertRule}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    position={index + 1}
                    count={preview?.ruleCounts[rule.id]}
                    empty={preview?.emptyRules.includes(rule.id) ?? false}
                    first={index === 0}
                    last={index === draft.rules.length - 1}
                    onMove={(delta) => move(index, delta)}
                    onToggle={() => setRules(draft.rules.map((entry) => (entry.id === rule.id ? { ...entry, enabled: !entry.enabled } : entry)))}
                    onEdit={() => setEditing(rule)}
                    onDelete={() => setRules(draft.rules.filter((entry) => entry.id !== rule.id))}
                  />
                ),
              )}
            </ol>

            {editing === 'new' ? (
              <PriorityRuleEditor
                initial={null}
                categories={loaded.catalog.categories}
                companies={loaded.companies}
                catalogReady={!!loaded.catalog.at}
                onSave={upsertRule}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing('new')}
                disabled={draft.rules.length >= 30}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--lv-line)] py-3 text-sm font-bold text-[var(--lv-muted)] transition hover:border-[#c9a97a] hover:text-[var(--lv-ink)] disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> إضافة قاعدة
              </button>
            )}
            {draft.rules.length > 1 && (
              <p className="text-[11px] text-[var(--lv-muted)]">
                إذا طابق الطلب أكثر من قاعدة، تحكم القاعدة الأعلى في القائمة. قواعد «التقديم» تُطبَّق قبل قواعد «التأخير» دائماً.
              </p>
            )}
          </div>
        </Panel>

        <Panel title="الترتيب العام" Icon={ArrowDown} className="h-auto shrink-0" bodyClassName="overflow-visible p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">داخل كل مستوى، رتّب حسب</span>
              <select value={draft.sort} onChange={(event) => update({ sort: event.target.value as QueueSort })} className={field}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">أقصى انتظار (ساعة) — 0 للإيقاف</span>
              <input
                type="number"
                min={0}
                max={720}
                value={draft.maxWaitHours}
                onChange={(event) => update({ maxWaitHours: Math.max(0, Math.min(720, Math.round(Number(event.target.value) || 0))) })}
                className={field}
              />
              <span className="block text-[11px] text-[var(--lv-muted)]">الطلب الأقدم من هذا يتقدّم على كل القواعد (بعد الطلبات المميزة)، حتى لا ينتظر طلب مؤخَّر أياماً.</span>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">وضع الحملة</span>
              <select
                value={draft.campaign.priorityMode}
                onChange={(event) => update({ campaign: { ...draft.campaign, priorityMode: event.target.value as PriorityMode } })}
                className={field}
              >
                <option value="oldest_first">متوقف</option>
                <option value="regular_first">الطلبات العادية قبل عرض الريال</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">في وضع الحملة: يتقدّم طلب العرض بعد (ساعة)</span>
              <input
                type="number"
                min={1}
                max={720}
                disabled={draft.campaign.priorityMode !== 'regular_first'}
                value={draft.campaign.promoAgingHours}
                onChange={(event) =>
                  update({ campaign: { ...draft.campaign, promoAgingHours: Math.max(1, Math.min(720, Math.round(Number(event.target.value) || 1))) } })
                }
                className={cn(field, 'disabled:opacity-50')}
              />
            </label>
          </div>
          {draft.sort === 'newest_first' && draft.maxWaitHours === 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              «الأحدث أولاً» بدون حد أقصى للانتظار قد يترك الطلبات القديمة بلا تجهيز طويلاً.
            </p>
          )}
        </Panel>
      </div>

      {/* Right: specific orders + preview */}
      <div className="flex min-h-0 flex-col gap-4 xl:overflow-y-auto xl:pb-24">
        <FlaggedOrdersPanel onChanged={() => load()} />
        <PreviewPanel preview={preview} previewing={previewing} dirty={dirty} rules={draft.rules} ruleIndex={ruleIndex} onRefresh={() => load()} />
      </div>

      {/* Save bar */}
      {(dirty || saving) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--lv-line)] bg-[var(--lv-panel-solid)] px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(31,25,18,0.35)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="flex-1 text-sm font-bold text-[var(--lv-ink)]">
              تغييرات غير محفوظة
              <span className="block text-[11px] font-normal text-[var(--lv-muted)]">المعاينة تعرض الطابور بهذه التغييرات. تسري بعد الحفظ على الطلب التالي لكل مجهِّز.</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(toDraft(loaded));
                setEditing(null);
              }}
              className="rounded-xl border border-[var(--lv-line)] px-5 py-2 text-sm"
            >
              تراجع
            </button>
            <button
              type="button"
              disabled={saving || editing !== null}
              title={editing !== null ? 'أكمل تعديل القاعدة أولاً' : undefined}
              onClick={() => void save()}
              className="flex items-center gap-1.5 rounded-xl bg-[#8b6f47] px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#765d3a] disabled:opacity-40"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} حفظ الأولويات
            </button>
          </div>
        </div>
      )}
      {!dirty && loaded.config.updatedAt && (
        <p className="text-[11px] text-[var(--lv-muted)] xl:col-span-2">
          آخر حفظ: {loaded.config.updatedByName ?? '—'} · {dateTime.format(new Date(loaded.config.updatedAt))}
        </p>
      )}
    </div>
  );
}

function OrderLegend() {
  const steps = ['الطلبات المميزة', 'تجاوزت أقصى انتظار', 'قواعد التقديم', 'باقي الطلبات', 'قواعد التأخير'];
  return (
    <div className="rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-panel)] p-3">
      <p className="mb-2 text-xs font-bold text-[var(--lv-muted)]">ترتيب إعطاء الطلبات للمجهِّزين</p>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-1.5">
            <span className="rounded-lg bg-[var(--lv-chip)] px-2 py-1 text-[var(--lv-ink)]">
              <span className="tabular-nums text-[#8b6f47]">{index + 1}.</span> {step}
            </span>
            {index < steps.length - 1 && <span className="text-[var(--lv-faint)]">←</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-[var(--lv-muted)]">داخل كل مستوى: وضع الحملة (إن كان مفعّلاً)، ثم «الترتيب العام».</p>
    </div>
  );
}

function RuleCard({
  rule,
  position,
  count,
  empty,
  first,
  last,
  onMove,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: PriorityRule;
  position: number;
  count: number | undefined;
  empty: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const expired = !!rule.expiresAt && new Date(rule.expiresAt).getTime() <= Date.now();
  const boost = rule.effect === 'boost';
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-[var(--lv-card)] p-3 transition',
        boost ? 'border-emerald-200' : 'border-sky-200',
        (!rule.enabled || expired) && 'opacity-55',
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <button type="button" disabled={first} onClick={() => onMove(-1)} aria-label="لأعلى" className="rounded p-0.5 text-[var(--lv-muted)] hover:bg-[var(--lv-hover)] disabled:opacity-20">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] font-black tabular-nums text-[var(--lv-faint)]">{position}</span>
        <button type="button" disabled={last} onClick={() => onMove(1)} aria-label="لأسفل" className="rounded p-0.5 text-[var(--lv-muted)] hover:bg-[var(--lv-hover)] disabled:opacity-20">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-black', boost ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800')}>
            {boost ? '⬆ تقديم' : '⬇ تأخير'}
          </span>
          <span className="text-xs font-bold text-[var(--lv-muted)]">{KIND_LABEL[rule.kind]}:</span>
          <span className="min-w-0 truncate text-sm font-bold text-[var(--lv-ink)]">{describeMatch(rule)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--lv-muted)]">
          {empty && rule.enabled && !expired ? (
            <span className="font-bold text-amber-700">لا يطابق أي منتج — حدّث التصنيفات من سلة</span>
          ) : (
            count !== undefined && rule.enabled && !expired && <span className="font-bold tabular-nums">يطابق {count} طلب في الانتظار</span>
          )}
          {expired && <span className="font-bold text-rose-600">انتهت</span>}
          {rule.expiresAt && !expired && <span>تنتهي {dateTime.format(new Date(rule.expiresAt))}</span>}
          {rule.note && <span>· {rule.note}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={rule.enabled ? 'إيقاف القاعدة' : 'تفعيل القاعدة'}
          onClick={onToggle}
          className={cn('relative h-5 w-9 rounded-full transition-colors', rule.enabled ? 'bg-emerald-500' : 'bg-stone-300')}
        >
          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', rule.enabled ? 'right-0.5' : 'right-[calc(100%-1.125rem)]')} />
        </button>
        <button type="button" onClick={onEdit} aria-label="تعديل" className="rounded-lg p-1.5 text-[var(--lv-muted)] hover:bg-[var(--lv-hover)]">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDelete} aria-label="حذف" className="rounded-lg p-1.5 text-[var(--lv-muted)] hover:bg-rose-50 hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function FlaggedOrdersPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<FlaggedOrder[] | null>(null);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await call<{ orders: FlaggedOrder[] }>('/api/order-prep/v2/priority');
      setOrders(data.orders);
    } catch {
      setOrders([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, url: string, init: RequestInit) => {
    setBusy(key);
    try {
      const data = await call<{ message: string }>(url, init);
      toast({ description: data.message });
      await Promise.all([load(), onChanged()]);
      return true;
    } catch (err) {
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="طلبات مميزة" Icon={Zap} count={orders?.length} className="h-auto shrink-0" bodyClassName="overflow-visible">
      <div className="space-y-3 p-4">
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = number.trim();
            if (!value) return;
            const ok = await run('add', '/api/order-prep/v2/priority', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderNumber: value }),
            });
            if (ok) setNumber('');
          }}
        >
          <input value={number} onChange={(event) => setNumber(event.target.value)} inputMode="numeric" placeholder="رقم الطلب" className={field} />
          <button
            type="submit"
            disabled={!number.trim() || busy !== null}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-40"
          >
            {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} تمييز
          </button>
        </form>
        <p className="text-[11px] text-[var(--lv-muted)]">يُجهَّز قبل كل شيء آخر، ويسري فوراً دون حفظ.</p>
        {orders === null ? (
          <PanelSkeleton rows={2} />
        ) : orders.length === 0 ? (
          <p className="py-2 text-center text-xs text-[var(--lv-muted)]">لا توجد طلبات مميزة بانتظار التجهيز.</p>
        ) : (
          <ul className="divide-y divide-[var(--lv-line2)]">
            {orders.map((order) => (
              <li key={order.orderId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold tabular-nums text-[var(--lv-ink)]">#{order.orderNumber ?? order.orderId}</p>
                  <p className="truncate text-[11px] text-[var(--lv-muted)]">
                    {[order.customerName, order.createdByName, dateTime.format(new Date(order.createdAt))].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`del:${order.orderId}`, `/api/order-prep/v2/priority?orderId=${encodeURIComponent(order.orderId)}`, { method: 'DELETE' })
                  }
                  className="rounded-lg px-2 py-1 text-xs font-bold text-[var(--lv-muted)] ring-1 ring-[var(--lv-line)] hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                >
                  {busy === `del:${order.orderId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'إلغاء التمييز'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function PreviewPanel({
  preview,
  previewing,
  dirty,
  rules,
  ruleIndex,
  onRefresh,
}: {
  preview: Preview | null;
  previewing: boolean;
  dirty: boolean;
  rules: PriorityRule[];
  ruleIndex: Map<string, number>;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Panel
      title={dirty ? 'معاينة الطابور (بالتغييرات)' : 'معاينة الطابور'}
      Icon={Eye}
      count={preview?.total}
      className="min-h-[420px] xl:min-h-0 xl:flex-1"
      actions={
        <button
          type="button"
          aria-label="تحديث المعاينة"
          title="تحديث"
          disabled={dirty || refreshing}
          onClick={async () => {
            setRefreshing(true);
            await onRefresh();
            setRefreshing(false);
          }}
          className="rounded-lg p-1.5 text-[var(--lv-muted)] hover:bg-[var(--lv-hover)] disabled:opacity-40"
        >
          {previewing || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
        </button>
      }
    >
      {!preview ? (
        <PanelSkeleton />
      ) : preview.total === 0 ? (
        <EmptyNote icon="✅" title="لا توجد طلبات بانتظار التجهيز" hint="ستظهر هنا أول 25 طلباً بالترتيب الذي ستُعطى به للمجهِّزين." />
      ) : (
        <div className={cn('p-3 transition-opacity', previewing && 'opacity-60')}>
          <p className="mb-2 px-1 text-[11px] text-[var(--lv-muted)]">
            أول {preview.rows.length} من {preview.total} طلباً بالترتيب الذي ستُعطى به
            {preview.flagged > 0 && ` · ${preview.flagged} مميز`}
            {preview.aged > 0 && ` · ${preview.aged} تجاوز أقصى انتظار`}
          </p>
          <ol className="space-y-1">
            {preview.rows.map((row, index) => {
              const ruleAt = row.ruleId ? ruleIndex.get(row.ruleId) : undefined;
              const rule = ruleAt !== undefined ? rules[ruleAt] : null;
              return (
                <li key={row.orderId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--lv-hover)]">
                  <span className="w-5 shrink-0 text-center font-black tabular-nums text-[var(--lv-faint)]">{index + 1}</span>
                  <span className="w-20 shrink-0 font-bold tabular-nums text-[var(--lv-ink)]">#{row.orderNumber ?? row.orderId}</span>
                  <span className="w-14 shrink-0 tabular-nums text-[var(--lv-muted)]" title="عمر الطلب">
                    {ageLabel(row.placedAt)}
                  </span>
                  <span className="w-16 shrink-0 tabular-nums text-[var(--lv-muted)]">{row.totalSar === null ? '—' : `${Math.round(row.totalSar)} ر.س`}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-[var(--lv-muted)] sm:block">{row.company ?? '—'}</span>
                  <span className="mr-auto flex shrink-0 flex-wrap justify-end gap-1">
                    {row.flagged && <Reason tone="amber">مميز</Reason>}
                    {!row.flagged && row.aged && <Reason tone="rose">تجاوز الانتظار</Reason>}
                    {rule && (
                      <Reason tone={rule.effect === 'boost' ? 'emerald' : 'sky'}>
                        {rule.effect === 'boost' ? '⬆' : '⬇'} قاعدة {ruleAt! + 1}
                      </Reason>
                    )}
                    {row.promo && <Reason tone="stone">عرض</Reason>}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function Reason({ tone, children }: { tone: 'amber' | 'rose' | 'emerald' | 'sky' | 'stone'; children: React.ReactNode }) {
  const tones = {
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    sky: 'bg-sky-100 text-sky-800',
    stone: 'bg-stone-200 text-stone-700',
  };
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-black', tones[tone])}>{children}</span>;
}
