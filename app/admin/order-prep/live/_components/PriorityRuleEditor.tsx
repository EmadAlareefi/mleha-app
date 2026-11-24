'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { CatalogCategory } from '@/app/lib/order-prep/priority-catalog';
import type { PriorityRule, RuleEffect, RuleItem, RuleKind } from '@/app/lib/order-prep/priority-rules';
import { cn } from '@/lib/utils';

export const field =
  'w-full rounded-xl border border-[var(--lv-line)] bg-[var(--lv-card)] p-2.5 text-sm outline-none transition focus:border-[#8b6f47] focus:ring-4 focus:ring-[#8b6f47]/15';

export const KIND_LABEL: Record<RuleKind, string> = {
  category: 'تصنيف',
  shipping_company: 'شركة شحن',
  product: 'منتج',
  price_range: 'قيمة الطلب',
};

type CatalogProductRow = { id: string; name: string; sku: string };

const sar = (value: number) => `${value.toLocaleString('en-US')} ر.س`;

/** One-line Arabic description of what a rule matches. */
export function describeMatch(rule: Pick<PriorityRule, 'kind' | 'items' | 'minSar' | 'maxSar'>): string {
  if (rule.kind === 'price_range') {
    if (rule.minSar !== null && rule.maxSar !== null) return `من ${sar(rule.minSar)} إلى ${sar(rule.maxSar)}`;
    if (rule.minSar !== null) return `${sar(rule.minSar)} فأكثر`;
    return `${sar(rule.maxSar ?? 0)} فأقل`;
  }
  const labels = rule.items.map((item) => item.label);
  return labels.length <= 3 ? labels.join('، ') : `${labels.slice(0, 3).join('، ')} و${labels.length - 3} غيرها`;
}

export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** datetime-local value (browser time) ⇄ ISO. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

export function PriorityRuleEditor({
  initial,
  categories,
  companies,
  catalogReady,
  onSave,
  onCancel,
}: {
  initial: PriorityRule | null;
  categories: CatalogCategory[];
  companies: string[];
  catalogReady: boolean;
  onSave: (rule: PriorityRule) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RuleKind>(initial?.kind ?? 'category');
  const [effect, setEffect] = useState<RuleEffect>(initial?.effect ?? 'boost');
  const [items, setItems] = useState<RuleItem[]>(initial?.items ?? []);
  const [minSar, setMinSar] = useState(initial?.minSar?.toString() ?? '');
  const [maxSar, setMaxSar] = useState(initial?.maxSar?.toString() ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [expiresAt, setExpiresAt] = useState(toLocalInput(initial?.expiresAt ?? null));

  const switchKind = (next: RuleKind) => {
    if (next === kind) return;
    setKind(next);
    setItems([]);
  };

  const toggle = (item: RuleItem) =>
    setItems((current) =>
      current.some((entry) => entry.value === item.value) ? current.filter((entry) => entry.value !== item.value) : [...current, item],
    );

  const min = minSar.trim() === '' ? null : Number(minSar);
  const max = maxSar.trim() === '' ? null : Number(maxSar);
  const priceValid =
    (min !== null || max !== null) &&
    (min === null || (Number.isFinite(min) && min >= 0)) &&
    (max === null || (Number.isFinite(max) && max >= 0)) &&
    (min === null || max === null || min <= max);
  const valid = kind === 'price_range' ? priceValid : items.length > 0;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: initial?.id ?? newRuleId(),
      enabled: initial?.enabled ?? true,
      effect,
      kind,
      items: kind === 'price_range' ? [] : items,
      minSar: kind === 'price_range' ? min : null,
      maxSar: kind === 'price_range' ? max : null,
      note: note.trim(),
      expiresAt: fromLocalInput(expiresAt),
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border-2 border-[#c9a97a] bg-[var(--lv-card)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-[var(--lv-ink)]">{initial ? 'تعديل القاعدة' : 'قاعدة جديدة'}</h3>
        <button type="button" onClick={onCancel} aria-label="إغلاق" className="rounded-lg p-1 text-[var(--lv-muted)] hover:bg-[var(--lv-hover)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Segmented
          label="الإجراء"
          value={effect}
          onChange={setEffect}
          options={[
            { value: 'boost', label: '⬆ تقديم' },
            { value: 'lower', label: '⬇ تأخير' },
          ]}
        />
        <label className="space-y-1.5 text-sm">
          <span className="font-bold">الطلبات التي فيها…</span>
          <select value={kind} onChange={(event) => switchKind(event.target.value as RuleKind)} className={field}>
            {(Object.keys(KIND_LABEL) as RuleKind[]).map((key) => (
              <option key={key} value={key}>
                {KIND_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind === 'category' && (
        <CategoryPicker categories={categories} ready={catalogReady} selected={items} onToggle={toggle} />
      )}
      {kind === 'shipping_company' && <CompanyPicker companies={companies} selected={items} onToggle={toggle} />}
      {kind === 'product' && <ProductPicker selected={items} onToggle={toggle} />}
      {kind === 'price_range' && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">من (ر.س)</span>
              <input type="number" min={0} inputMode="decimal" value={minSar} onChange={(event) => setMinSar(event.target.value)} placeholder="بلا حد أدنى" className={field} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">إلى (ر.س)</span>
              <input type="number" min={0} inputMode="decimal" value={maxSar} onChange={(event) => setMaxSar(event.target.value)} placeholder="بلا حد أعلى" className={field} />
            </label>
          </div>
          <p className="text-xs text-[var(--lv-muted)]">إجمالي الطلب شاملاً الشحن والضريبة، محوّلاً إلى الريال لطلبات العملات الأخرى. الحدّان داخلان.</p>
          {!priceValid && (minSar || maxSar) && <p className="text-xs font-bold text-rose-600">تأكد أن «من» أصغر من «إلى» وأن القيم موجبة.</p>}
        </div>
      )}

      {kind !== 'price_range' && items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => toggle(item)}
              className="flex items-center gap-1 rounded-full bg-[var(--lv-chip)] px-2.5 py-1 text-xs font-bold text-[var(--lv-ink)] hover:bg-rose-100 hover:text-rose-700"
              title="إزالة"
            >
              {item.label} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-bold">ملاحظة (اختياري)</span>
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="مثال: حملة اليوم الوطني" className={field} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-bold">تنتهي في (اختياري)</span>
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={field} />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid}
          onClick={submit}
          className="flex items-center gap-1.5 rounded-xl bg-[#8b6f47] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#765d3a] disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> {initial ? 'تحديث القاعدة' : 'إضافة القاعدة'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-[var(--lv-line)] px-5 py-2 text-sm">
          إلغاء
        </button>
      </div>
      <p className="text-[11px] text-[var(--lv-muted)]">لا تُطبَّق القاعدة حتى تضغط «حفظ الأولويات».</p>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="font-bold">{label}</span>
      <div className="flex rounded-xl border border-[var(--lv-line)] bg-[var(--lv-track)] p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition',
              value === option.value ? 'bg-[var(--lv-card)] text-[var(--lv-ink)] shadow' : 'text-[var(--lv-muted)]',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckRow({ label, hint, checked, onClick }: { label: string; hint?: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right text-sm transition',
        checked ? 'bg-[#8b6f47]/10 font-bold text-[var(--lv-ink)]' : 'hover:bg-[var(--lv-hover)]',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          checked ? 'border-[#8b6f47] bg-[#8b6f47] text-white' : 'border-[var(--lv-line)]',
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] tabular-nums text-[var(--lv-muted)]">{hint}</span>}
    </button>
  );
}

function CategoryPicker({
  categories,
  ready,
  selected,
  onToggle,
}: {
  categories: CatalogCategory[];
  ready: boolean;
  selected: RuleItem[];
  onToggle: (item: RuleItem) => void;
}) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  if (!ready || categories.length === 0) {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
        لم تُحمَّل التصنيفات من سلة بعد. اضغط «تحديث من سلة» أعلى الصفحة وانتظر دقيقة ثم أعد التحميل.
      </p>
    );
  }
  return (
    <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--lv-line)] p-1">
      {categories.map((category) => {
        const parent = category.parentId ? byId.get(category.parentId) : null;
        const label = parent ? `${parent.name} › ${category.name}` : category.name;
        return (
          <CheckRow
            key={category.id}
            label={label}
            hint={`${category.products} منتج`}
            checked={selected.some((item) => item.value === category.id)}
            onClick={() => onToggle({ value: category.id, label })}
          />
        );
      })}
    </div>
  );
}

function CompanyPicker({ companies, selected, onToggle }: { companies: string[]; selected: RuleItem[]; onToggle: (item: RuleItem) => void }) {
  const [custom, setCustom] = useState('');
  const all = [...new Set([...companies, ...selected.map((item) => item.value)])];
  return (
    <div className="space-y-2">
      <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--lv-line)] p-1">
        {all.map((company) => (
          <CheckRow
            key={company}
            label={company}
            checked={selected.some((item) => item.value === company)}
            onClick={() => onToggle({ value: company, label: company })}
          />
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = custom.trim();
          if (name && !selected.some((item) => item.value === name)) onToggle({ value: name, label: name });
          setCustom('');
        }}
      >
        <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="شركة غير موجودة؟ اكتب اسمها كما يظهر في سلة" className={field} />
        <button type="submit" className="shrink-0 rounded-xl border border-[var(--lv-line)] px-4 text-sm font-bold">
          إضافة
        </button>
      </form>
      <p className="text-[11px] text-[var(--lv-muted)]">الشركة التي اختارها العميل عند الدفع في سلة.</p>
    </div>
  );
}

function ProductPicker({ selected, onToggle }: { selected: RuleItem[]; onToggle: (item: RuleItem) => void }) {
  const [products, setProducts] = useState<CatalogProductRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/order-prep/v2/priority/catalog')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) throw new Error(data.error);
        setProducts(data.products);
      })
      .catch((err) => !cancelled && setError(err instanceof Error && err.message ? err.message : 'تعذر تحميل المنتجات'));
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!products || !needle) return [];
    return products.filter((product) => product.sku.toLowerCase().includes(needle) || product.name.toLowerCase().includes(needle)).slice(0, 40);
  }, [products, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--lv-muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={products ? `ابحث باسم المنتج أو رقم SKU (${products.length} منتج)` : 'جارٍ تحميل المنتجات…'}
          disabled={!products}
          className={cn(field, 'pr-9')}
        />
      </div>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {products && products.length === 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">لم تُحمَّل المنتجات من سلة بعد. اضغط «تحديث من سلة» أعلى الصفحة.</p>
      )}
      {results.length > 0 && (
        <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--lv-line)] p-1">
          {results.map((product) => {
            const label = product.sku ? `${product.sku} · ${product.name}` : product.name;
            return (
              <CheckRow
                key={product.id}
                label={label}
                checked={selected.some((item) => item.value === product.id)}
                onClick={() => onToggle({ value: product.id, label })}
              />
            );
          })}
        </div>
      )}
      {query.trim() && products && results.length === 0 && <p className="text-xs text-[var(--lv-muted)]">لا نتائج.</p>}
    </div>
  );
}
