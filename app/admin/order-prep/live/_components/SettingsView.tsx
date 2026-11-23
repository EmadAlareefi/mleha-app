'use client';

import { useState } from 'react';
import { ClipboardList, Truck } from 'lucide-react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { PrepSettings } from '@/app/lib/order-prep/settings';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { cn } from '@/lib/utils';
import { Panel, PanelSkeleton } from './primitives';

const field = 'w-full rounded-xl border border-[#e3d5c3] bg-white p-2.5 text-sm outline-none transition focus:border-[#8b6f47] focus:ring-4 focus:ring-[#8b6f47]/15';

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
  onSavePrep: (settings: PrepSettings) => Promise<boolean>;
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
                <span className="font-bold">ترتيب القائمة</span>
                <select
                  value={settings.priorityMode}
                  onChange={(event) => setDraft({ ...settings, priorityMode: event.target.value as PrepSettings['priorityMode'] })}
                  className={field}
                >
                  <option value="oldest_first">الأقدم أولاً (الافتراضي)</option>
                  <option value="regular_first">وضع الحملة: الطلبات العادية قبل عرض الريال</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-bold">في وضع الحملة: يتقدّم طلب العرض بعد (ساعة)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={settings.promoAgingHours}
                  onChange={(event) => setDraft({ ...settings, promoAgingHours: Number(event.target.value) })}
                  className={field}
                />
              </label>
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
            <div className="mt-4">
              <Switch
                label="تفعيل صفحة التجهيز الجديدة لكل المجهِّزين"
                hint="الصفحة القديمة تبقى على ‎/order-prep?v=1"
                value={settings.v2Enabled}
                onChange={(value) => setDraft({ ...settings, v2Enabled: value })}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!draft || busy === 'settings'}
                onClick={async () => {
                  if (draft && (await onSavePrep(draft))) setDraft(null);
                }}
                className="rounded-xl bg-[#8b6f47] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#765d3a] disabled:opacity-40"
              >
                حفظ الإعدادات
              </button>
              {draft && (
                <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-[#e3d5c3] px-5 py-2 text-sm">
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
          <p className="text-sm text-[#6b5d4f]">تغيير إعدادات الشحن متاح لمشرفي التجهيز فقط.</p>
        ) : (
          <div className="space-y-3">
            <Switch
              label="إنشاء الشحنة تلقائياً بعد التجهيز"
              hint="عند الإيقاف تُنشأ الشحنة عند مسح الطلب في محطة الشحن."
              value={shipping.settings.precreateEnabled}
              disabled={busy === 'ship-settings'}
              onChange={(value) => onShippingSetting({ precreateEnabled: value })}
            />
            <Switch
              label="صفحة الشحن الجديدة للجميع"
              hint="الصفحة القديمة تبقى متاحة على /order-shipping?v=1"
              value={shipping.settings.v2Enabled}
              disabled={busy === 'ship-settings'}
              onChange={(value) => onShippingSetting({ v2Enabled: value })}
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
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#efe4d6] bg-white p-3 text-right transition hover:border-[#c9a97a] disabled:opacity-50"
    >
      <span>
        <span className="block text-sm font-bold text-[#2c2416]">{label}</span>
        <span className="block text-xs text-[#6b5d4f]">{hint}</span>
      </span>
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', value ? 'bg-emerald-500' : 'bg-stone-300')}>
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300',
            value ? 'right-0.5' : 'right-[calc(100%-1.375rem)]',
          )}
        />
      </span>
    </button>
  );
}
