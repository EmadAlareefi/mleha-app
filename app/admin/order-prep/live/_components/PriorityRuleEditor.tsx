'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { normalizeCity } from '@/app/lib/order-prep/city-name';
import type { CatalogCategory } from '@/app/lib/order-prep/priority-catalog';
import type { PriorityRule, RuleEffect, RuleItem, RuleKind } from '@/app/lib/order-prep/priority-rules';
import { cn } from '@/lib/utils';

export const field =
  'w-full rounded-xl border border-[var(--lv-line)] bg-[var(--lv-card)] p-2.5 text-sm outline-none transition focus:border-[#8b6f47] focus:ring-4 focus:ring-[#8b6f47]/15';

export const KIND_LABEL: Record<RuleKind, string> = {
  category: 'تصنيف',
  product: 'منتج',
  shipping_company: 'شركة شحن',
  city: 'مدينة الشحن',
  destination: 'داخلي / دولي',
  payment_method: 'طريقة الدفع',
  price_range: 'قيمة الطلب',
  item_count: 'عدد القطع',
  repeat_customer: 'طلبات العميل السابقة',
  customer: 'عملاء محددون (VIP)',
};

const KIND_GROUPS: Array<{ label: string; kinds: RuleKind[] }> = [
  { label: 'المنتجات', kinds: ['category', 'product', 'item_count'] },
  { label: 'الشحن', kinds: ['shipping_company', 'city', 'destination'] },
  { label: 'الطلب', kinds: ['price_range', 'payment_method'] },
  { label: 'العميل', kinds: ['repeat_customer', 'customer'] },
];

const RANGE: Partial<Record<RuleKind, { unit: string; step: string; hint: string }>> = {
  price_range: {
    unit: 'ر.س',
    step: 'any',
    hint: 'إجمالي الطلب شاملاً الشحن والضريبة، محوّلاً إلى الريال لطلبات العملات الأخرى. الحدّان داخلان.',
  },
  item_count: { unit: 'قطعة', step: '1', hint: 'مجموع الكميات في الطلب. مثال: من 1 إلى 1 = الطلبات ذات القطعة الواحدة.' },
  repeat_customer: {
    unit: 'طلب',
    step: '1',
    hint: 'عدد طلبات العميل قبل هذا الطلب (دون الملغاة). مثال: «إلى 0» = العملاء الجدد، «من 3» = العملاء المتكررون.',
  },
};

export const PAYMENT_LABEL: Record<string, string> = {
  mada: 'مدى',
  credit_card: 'بطاقة ائتمانية',
  tamara_installment: 'تمارا',
  tabby_installment: 'تابي',
  stc_pay: 'STC Pay',
  apple_pay: 'Apple Pay',
  cod: 'الدفع عند الاستلام',
  bank: 'تحويل بنكي',
  free: 'مجاني',
  customer_wallet: 'محفظة العميل',
};

export const DAY_LABEL = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

type CatalogProductRow = { id: string; name: string; sku: string };

const fmt = (value: number) => value.toLocaleString('en-US');

/** One-line Arabic description of what a rule matches. */
export function describeMatch(rule: Pick<PriorityRule, 'kind' | 'items' | 'min' | 'max'>): string {
  const range = RANGE[rule.kind];
  if (range) {
    if (rule.kind === 'repeat_customer') {
      if (rule.max === 0) return 'عملاء جدد (أول طلب)';
      if (rule.min !== null && rule.max === null) return `${fmt(rule.min)} طلبات سابقة فأكثر`;
    }
    if (rule.kind === 'item_count' && rule.min === 1 && rule.max === 1) return 'قطعة واحدة';
    if (rule.min !== null && rule.max !== null) return `من ${fmt(rule.min)} إلى ${fmt(rule.max)} ${range.unit}`;
    if (rule.min !== null) return `${fmt(rule.min)} ${range.unit} فأكثر`;
    return `${fmt(rule.max ?? 0)} ${range.unit} فأقل`;
  }
  const labels = rule.items.map((item) => item.label);
  return labels.length <= 3 ? labels.join('، ') : `${labels.slice(0, 3).join('، ')} و${labels.length - 3} غيرها`;
}

/** «كل يوم 12:00–16:00 · أحد، إثنين» — or '' when the rule has no window. */
export function describeSchedule(rule: Pick<PriorityRule, 'activeFrom' | 'activeTo' | 'days'>): string {
  const parts: string[] = [];
  if (rule.activeFrom && rule.activeTo) parts.push(`${rule.activeFrom}–${rule.activeTo}`);
  if (rule.days.length > 0) parts.push(rule.days.map((day) => DAY_LABEL[day]).join('، '));
  return parts.join(' · ');
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
  cities,
  paymentMethods,
  catalogReady,
  onSave,
  onCancel,
}: {
  initial: PriorityRule | null;
  categories: CatalogCategory[];
  companies: string[];
  cities: string[];
  paymentMethods: string[];
  catalogReady: boolean;
  onSave: (rule: PriorityRule) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RuleKind>(initial?.kind ?? 'category');
  const [effect, setEffect] = useState<RuleEffect>(initial?.effect ?? 'boost');
  const [items, setItems] = useState<RuleItem[]>(initial?.items ?? []);
  const [minText, setMinText] = useState(initial?.min?.toString() ?? '');
  const [maxText, setMaxText] = useState(initial?.max?.toString() ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [expiresAt, setExpiresAt] = useState(toLocalInput(initial?.expiresAt ?? null));
  const [windowOn, setWindowOn] = useState(Boolean(initial?.activeFrom || initial?.days.length));
  const [activeFrom, setActiveFrom] = useState(initial?.activeFrom ?? '');
  const [activeTo, setActiveTo] = useState(initial?.activeTo ?? '');
  const [days, setDays] = useState<number[]>(initial?.days ?? []);

  const switchKind = (next: RuleKind) => {
    if (next === kind) return;
    setKind(next);
    setItems(next === 'destination' ? [{ value: 'domestic', label: 'داخل السعودية' }] : []);
    setMinText('');
    setMaxText('');
  };

  const toggle = (item: RuleItem) =>
    setItems((current) =>
      current.some((entry) => entry.value === item.value) ? current.filter((entry) => entry.value !== item.value) : [...current, item],
    );

  const range = RANGE[kind];
  const min = minText.trim() === '' ? null : Number(minText);
  const max = maxText.trim() === '' ? null : Number(maxText);
  const rangeValid =
    (min !== null || max !== null) &&
    (min === null || (Number.isFinite(min) && min >= 0)) &&
    (max === null || (Number.isFinite(max) && max >= 0)) &&
    (min === null || max === null || min <= max);
  const hoursSet = Boolean(activeFrom && activeTo && activeFrom !== activeTo);
  const hoursEmpty = !activeFrom && !activeTo;
  // A window needs valid hours, or no hours but at least one weekday.
  const windowValid = !windowOn || hoursSet || (hoursEmpty && days.length > 0);
  const valid = (range ? rangeValid : items.length > 0) && windowValid;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: initial?.id ?? newRuleId(),
      enabled: initial?.enabled ?? true,
      effect,
      kind,
      items: range ? [] : items,
      min: range ? min : null,
      max: range ? max : null,
      note: note.trim(),
      expiresAt: fromLocalInput(expiresAt),
      activeFrom: windowOn && hoursSet ? activeFrom : null,
      activeTo: windowOn && hoursSet ? activeTo : null,
      days: windowOn && days.length < 7 ? days : [],
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <span className="font-bold">الطلبات حسب…</span>
          <select value={kind} onChange={(event) => switchKind(event.target.value as RuleKind)} className={field}>
            {KIND_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.kinds.map((key) => (
                  <option key={key} value={key}>
                    {KIND_LABEL[key]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {kind === 'category' && <CategoryPicker categories={categories} ready={catalogReady} selected={items} onToggle={toggle} />}
      {kind === 'product' && <ProductPicker selected={items} onToggle={toggle} />}
      {kind === 'shipping_company' && (
        <ListPicker
          options={companies.map((company) => ({ value: company, label: company }))}
          selected={items}
          onToggle={toggle}
          customPlaceholder="شركة غير موجودة؟ اكتب اسمها كما يظهر في سلة"
          hint="الشركة التي اختارها العميل عند الدفع في سلة."
        />
      )}
      {kind === 'city' && (
        <ListPicker
          options={[...new Map(cities.map((city) => [normalizeCity(city), { value: normalizeCity(city), label: city }])).values()]}
          selected={items}
          onToggle={toggle}
          customPlaceholder="مدينة غير موجودة؟ اكتب اسمها"
          hint="مدينة عنوان الشحن. «جدة» و«جده» تُعامَلان كمدينة واحدة. لمنطقة كاملة اختر مدنها."
          searchable
          normalize={normalizeCity}
        />
      )}
      {kind === 'destination' && (
        <Segmented
          label="وجهة الشحن"
          value={(items[0]?.value as 'domestic' | 'international') ?? 'domestic'}
          onChange={(value) => setItems([{ value, label: value === 'international' ? 'دولي (خارج السعودية)' : 'داخل السعودية' }])}
          options={[
            { value: 'domestic', label: 'داخل السعودية' },
            { value: 'international', label: 'دولي' },
          ]}
        />
      )}
      {kind === 'payment_method' && (
        <ListPicker
          options={[...new Set([...paymentMethods, 'cod'])].map((method) => ({ value: method, label: PAYMENT_LABEL[method] ?? method }))}
          selected={items}
          onToggle={toggle}
        />
      )}
      {kind === 'customer' && <CustomerPicker selected={items} onToggle={toggle} />}
      {range && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">من ({range.unit})</span>
              <input type="number" min={0} step={range.step} inputMode="decimal" value={minText} onChange={(event) => setMinText(event.target.value)} placeholder="بلا حد أدنى" className={field} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-bold">إلى ({range.unit})</span>
              <input type="number" min={0} step={range.step} inputMode="decimal" value={maxText} onChange={(event) => setMaxText(event.target.value)} placeholder="بلا حد أعلى" className={field} />
            </label>
          </div>
          <p className="text-xs text-[var(--lv-muted)]">{range.hint}</p>
          {!rangeValid && (minText || maxText) && <p className="text-xs font-bold text-rose-600">تأكد أن «من» أصغر من «إلى» وأن القيم موجبة.</p>}
          {kind === 'item_count' && (
            <QuickFill onPick={(a, b) => { setMinText(a); setMaxText(b); }} options={[['قطعة واحدة', '1', '1'], ['3 قطع فأكثر', '3', '']]} />
          )}
          {kind === 'repeat_customer' && (
            <QuickFill onPick={(a, b) => { setMinText(a); setMaxText(b); }} options={[['عملاء جدد', '', '0'], ['عملاء متكررون (3+)', '3', '']]} />
          )}
        </div>
      )}

      {!range && kind !== 'destination' && items.length > 0 && (
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

      <div className="space-y-3 rounded-xl border border-[var(--lv-line2)] p-3">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={windowOn} onChange={(event) => setWindowOn(event.target.checked)} className="h-4 w-4 accent-[#8b6f47]" />
          في أوقات أو أيام محددة فقط
        </label>
        {windowOn && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-sm">
                <span className="font-bold">من الساعة</span>
                <input type="time" value={activeFrom} onChange={(event) => setActiveFrom(event.target.value)} className={field} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-bold">إلى الساعة</span>
                <input type="time" value={activeTo} onChange={(event) => setActiveTo(event.target.value)} className={field} />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABEL.map((label, day) => {
                const on = days.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays((current) => (on ? current.filter((entry) => entry !== day) : [...current, day].sort()))}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-bold ring-1 transition',
                      on ? 'bg-[#8b6f47] text-white ring-[#8b6f47]' : 'text-[var(--lv-muted)] ring-[var(--lv-line)] hover:bg-[var(--lv-hover)]',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--lv-muted)]">
              بتوقيت الرياض. بلا أيام = كل يوم. مثال لموعد استلام شركة الشحن: «تقديم · سمسا · من 12:00 إلى 16:00» يجهّز طلبات سمسا قبل مرور المندوب.
            </p>
            {!windowValid && <p className="text-xs font-bold text-rose-600">اختر ساعتي البداية والنهاية (مختلفتين) أو يوماً واحداً على الأقل.</p>}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

function QuickFill({ options, onPick }: { options: Array<[string, string, string]>; onPick: (min: string, max: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([label, min, max]) => (
        <button key={label} type="button" onClick={() => onPick(min, max)} className="rounded-lg px-2.5 py-1 text-xs font-bold text-[var(--lv-muted)] ring-1 ring-[var(--lv-line)] hover:bg-[var(--lv-hover)]">
          {label}
        </button>
      ))}
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

/** Checklist of known values, optional search, plus a free-text add. */
function ListPicker({
  options,
  selected,
  onToggle,
  customPlaceholder,
  hint,
  searchable,
  normalize,
}: {
  options: RuleItem[];
  selected: RuleItem[];
  onToggle: (item: RuleItem) => void;
  customPlaceholder?: string;
  hint?: string;
  searchable?: boolean;
  /** Canonical form for typed values (cities). */
  normalize?: (value: string) => string;
}) {
  const [custom, setCustom] = useState('');
  const [query, setQuery] = useState('');
  const all = [...options, ...selected.filter((item) => !options.some((option) => option.value === item.value))];
  const needle = query.trim();
  const shown = needle ? all.filter((option) => option.label.includes(needle)) : all;
  return (
    <div className="space-y-2">
      {searchable && (
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--lv-muted)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث" className={cn(field, 'pr-9')} />
        </div>
      )}
      <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--lv-line)] p-1">
        {shown.map((option) => (
          <CheckRow
            key={option.value}
            label={option.label}
            checked={selected.some((item) => item.value === option.value)}
            onClick={() => onToggle(option)}
          />
        ))}
        {shown.length === 0 && <p className="p-2 text-xs text-[var(--lv-muted)]">لا نتائج.</p>}
      </div>
      {customPlaceholder && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = custom.trim();
            const value = normalize ? normalize(name) : name;
            if (name && !selected.some((item) => item.value === value)) onToggle({ value, label: name });
            setCustom('');
          }}
        >
          <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={customPlaceholder} className={field} />
          <button type="submit" className="shrink-0 rounded-xl border border-[var(--lv-line)] px-4 text-sm font-bold">
            إضافة
          </button>
        </form>
      )}
      {hint && <p className="text-[11px] text-[var(--lv-muted)]">{hint}</p>}
    </div>
  );
}

/** VIP customers by mobile: one number per line or comma-separated; the server normalises them. */
function CustomerPicker({ selected, onToggle }: { selected: RuleItem[]; onToggle: (item: RuleItem) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    for (const raw of text.split(/[\n,،;]+/)) {
      const value = raw.replace(/[^\d+]/g, '');
      if (value.length >= 9 && !selected.some((item) => item.value === value)) onToggle({ value, label: value });
    }
    setText('');
  };
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        dir="ltr"
        placeholder={'0551234567\n+971501234567'}
        className={cn(field, 'font-mono')}
      />
      <button type="button" onClick={add} disabled={!text.trim()} className="rounded-xl border border-[var(--lv-line)] px-4 py-2 text-sm font-bold disabled:opacity-40">
        إضافة الأرقام
      </button>
      <p className="text-[11px] text-[var(--lv-muted)]">
        رقم جوال العميل في سلة. رقم في كل سطر؛ الأرقام السعودية تُقبل بصيغة 05… أو ‎+966…. الأرقام غير الصالحة تُحذف عند الحفظ.
      </p>
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
