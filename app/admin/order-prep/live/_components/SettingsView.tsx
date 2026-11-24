'use client';

import { useState } from 'react';
import { ClipboardList, Truck } from 'lucide-react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { PrepSettings } from '@/app/lib/order-prep/settings';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { BIG_PICKUP_THRESHOLD_RANGE } from '@/app/lib/shipping/pickup';
import { cn } from '@/lib/utils';
import { Panel, PanelSkeleton } from './primitives';

const field = 'w-full rounded-xl border border-[var(--lv-line)] bg-[var(--lv-card)] p-2.5 text-sm outline-none transition focus:border-[#8b6f47] focus:ring-4 focus:ring-[#8b6f47]/15';

export function SettingsView({
  board,
  shipping,
  canManageShipping,
  busy,
  onSavePrep,
  onShippingSetting,
}: {
  board: BoardData | null;
  shipping: ShippingBoardData | null;
  canManageShipping: boolean;
  busy: string | null;
  /** Only the fields this view edits: queue order and campaign mode live on the «الأولويات» tab. */
  onSavePrep: (patch: Pick<PrepSettings, 'scanMode' | 'leaseMinutes'>) => Promise<boolean>;
  onShippingSetting: (patch: Partial<ShippingBoardData['settings']>) => void;
}) {
  const [draft, setDraft] = useState<PrepSettings | null>(null);
  const settings = draft ?? board?.settings ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pb-4 xl:grid-cols-2">
      <Panel title="إعدادات التجهيز" Icon={ClipboardList} bodyClassName="p-4">
        {!settings ? (
          <PanelSkeleton />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-bold">مسح الباركود</span>
                <select
                  value={settings.scanMode}
                  onChange={(event) => setDraft({ ...settings, scanMode: event.target.value as PrepSettings['scanMode'] })}
                  className={field}
                >
                  <option value="optional">اختياري (يُسجَّل التأكيد اليدوي)</option>
                  <option value="required">إلزامي (مع خيار «الباركود لا يعمل»)</option>
                  <option value="off">إيقاف</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-bold">مهلة حجز الطلب (دقيقة)</span>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={settings.leaseMinutes}
                  onChange={(event) => setDraft({ ...settings, leaseMinutes: Number(event.target.value) })}
                  className={field}
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-[var(--lv-muted)]">ترتيب الطابور ووضع الحملة انتقلا إلى تبويب «الأولويات».</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!draft || busy === 'settings'}
                onClick={async () => {
                  if (draft && (await onSavePrep({ scanMode: draft.scanMode, leaseMinutes: draft.leaseMinutes }))) setDraft(null);
                }}
                className="rounded-xl bg-[#8b6f47] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#765d3a] disabled:opacity-40"
              >
                حفظ الإعدادات
              </button>
              {draft && (
                <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-[var(--lv-line)] px-5 py-2 text-sm">
                  إلغاء
                </button>
              )}
            </div>
          </>
        )}
      </Panel>

      <Panel title="إعدادات الشحن" Icon={Truck} bodyClassName="p-4">
        {!shipping ? (
          <PanelSkeleton />
        ) : !canManageShipping ? (
          <p className="text-sm text-[var(--lv-muted)]">تغيير إعدادات الشحن متاح لمشرفي التجهيز فقط.</p>
        ) : (
          <div className="space-y-3">
            <Switch
              label="إنشاء الشحنة تلقائياً بعد التجهيز"
              hint="عند الإيقاف تُنشأ الشحنة عند مسح الطلب في محطة الشحن."
              value={shipping.settings.precreateEnabled}
              disabled={busy === 'ship-settings'}
              onChange={(value) => onShippingSetting({ precreateEnabled: value })}
            />
            <PickupThreshold
              key={shipping.settings.bigPickupThreshold}
              value={shipping.settings.bigPickupThreshold}
              disabled={busy === 'ship-settings'}
              onSave={(value) => onShippingSetting({ bigPickupThreshold: value })}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

function Switch({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--lv-line2)] bg-[var(--lv-card)] p-3 text-right transition hover:border-[#c9a97a] disabled:opacity-50"
    >
      <span>
        <span className="block text-sm font-bold text-[var(--lv-ink)]">{label}</span>
        <span className="block text-xs text-[var(--lv-muted)]">{hint}</span>
      </span>
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', value ? 'bg-emerald-500' : 'bg-stone-300')}>
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-[var(--lv-card)] shadow transition-all duration-300',
            value ? 'right-0.5' : 'right-[calc(100%-1.375rem)]',
          )}
        />
      </span>
    </button>
  );
}

/** «Call the carrier for a big truck» once one carrier expects this many parcels. */
function PickupThreshold({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const parsed = Number(draft);
  const valid =
    Number.isInteger(parsed) && parsed >= BIG_PICKUP_THRESHOLD_RANGE.min && parsed <= BIG_PICKUP_THRESHOLD_RANGE.max;
  const dirty = valid && parsed !== value;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) onSave(parsed);
      }}
      className="rounded-xl border border-[var(--lv-line)] bg-[var(--lv-card)] p-3"
    >
      <label className="block space-y-1.5 text-sm">
        <span className="font-bold">حد الدفعة الكبيرة للتنبيه (شحنة)</span>
        <span className="block text-xs text-[var(--lv-muted)]">
          عندما تتوقع شركة شحن هذا العدد أو أكثر، تنبّه لوحة «المتبقي للشحن» للاتصال بها وطلب شاحنة كبيرة.
        </span>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={BIG_PICKUP_THRESHOLD_RANGE.min}
            max={BIG_PICKUP_THRESHOLD_RANGE.max}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={cn(field, 'max-w-32', !valid && 'border-rose-300')}
          />
          <button
            type="submit"
            disabled={disabled || !dirty}
            className="rounded-xl bg-[var(--lv-strong)] px-4 text-sm font-bold text-[var(--lv-strong-ink)] transition disabled:opacity-40"
          >
            حفظ
          </button>
        </div>
      </label>
    </form>
  );
}
