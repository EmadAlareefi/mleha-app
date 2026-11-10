'use client';

import Image from 'next/image';
import { useState } from 'react';
import { AlertOctagon, Check, Gift, Globe, MapPin, RotateCcw, Tag, X, Zap } from 'lucide-react';
import type { PrepAssignmentView, PrepItem } from '@/app/lib/order-prep/types';
import { cn } from '@/lib/utils';
import type { ItemProgress } from './prep-store';

/** The order on screen: photo, size and shelf in large type, and a check per unit. */
export function OrderView({
  view,
  progress,
  checkable,
  sharedSku,
  onTapItem,
  onResetItem,
  onSkip,
}: {
  view: PrepAssignmentView;
  progress: ItemProgress | undefined;
  /** Lines need per-unit checks (more than one line, or a quantity above 1). */
  checkable: boolean;
  sharedSku: boolean;
  onTapItem: (item: PrepItem) => void;
  onResetItem: (item: PrepItem) => void;
  onSkip: () => void;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const order = view.order;
  const single = !checkable && order.items.length === 1;

  return (
    <div className="space-y-3 px-3 py-3">
      {view.verifyIssue && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-red-500 bg-red-50 p-3">
          <AlertOctagon className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-bold text-red-800">
              تغيّرت حالة هذا الطلب في سلة ({describeIssue(view.verifyIssue)}). لا تجهّزه.
            </p>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white"
            >
              تخطي الطلب
            </button>
          </div>
        </div>
      )}

      <Flags view={view} />

      {sharedSku && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
          نفس الموديل بأكثر من مقاس في هذا الطلب — انتبه للمقاس.
        </div>
      )}

      {order.items.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          لا توجد منتجات محفوظة لهذا الطلب بعد. سيتم تحديثه تلقائياً؛ أو أرجعه للقائمة.
        </div>
      )}

      {single ? (
        <SingleItem item={order.items[0]} progress={progress} onZoom={setZoom} />
      ) : (
        <div className="space-y-2">
          {order.totalUnits > 1 && (
            <p className="px-1 text-sm font-bold text-foreground">
              عدد القطع في الطلب: <span className="text-lg">{order.totalUnits}</span>
            </p>
          )}
          {order.items.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              checked={progress?.[item.index]?.checked ?? 0}
              scanned={progress?.[item.index]?.method === 'scan'}
              onTap={() => onTapItem(item)}
              onReset={() => onResetItem(item)}
              onZoom={setZoom}
            />
          ))}
        </div>
      )}

      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          aria-label="إغلاق الصورة"
        >
          <span className="relative h-full w-full">
            <Image src={zoom} alt="" fill unoptimized sizes="100vw" className="object-contain" />
          </span>
          <X className="absolute left-4 top-4 h-8 w-8 text-white" />
        </button>
      )}
    </div>
  );
}

function describeIssue(issue: string) {
  if (issue === 'not_found') return 'غير موجود في سلة';
  if (issue.startsWith('status:')) return issue.slice('status:'.length);
  if (issue.startsWith('conflict:')) return issue.slice('conflict:'.length);
  return issue;
}

function Flags({ view }: { view: PrepAssignmentView }) {
  const order = view.order;
  const chips: Array<{ key: string; icon: React.ReactNode; label: string; className: string }> = [];
  if (order.highPriority) chips.push({ key: 'hp', icon: <Zap className="h-4 w-4" />, label: 'عاجل', className: 'bg-red-600 text-white' });
  if (order.gift) chips.push({ key: 'gift', icon: <Gift className="h-4 w-4" />, label: 'هدية', className: 'bg-pink-600 text-white' });
  if (order.isInternational) {
    chips.push({
      key: 'intl',
      icon: <Globe className="h-4 w-4" />,
      label: order.country ? `دولي · ${order.country}` : 'دولي',
      className: 'bg-indigo-600 text-white',
    });
  }
  order.tags.forEach((tag, index) =>
    chips.push({ key: `tag-${index}`, icon: <Tag className="h-4 w-4" />, label: tag, className: 'bg-blue-600 text-white' }),
  );
  if (chips.length === 0 && !order.gift?.message && !order.shippingCompany) return null;
  return (
    <div className="space-y-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip.key} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold', chip.className)}>
              {chip.icon}
              {chip.label}
            </span>
          ))}
        </div>
      )}
      {order.gift?.message && (
        <div className="rounded-xl border-2 border-pink-300 bg-pink-50 px-3 py-2 text-sm text-pink-900">
          <span className="font-bold">رسالة الهدية: </span>
          {order.gift.message}
        </div>
      )}
      {order.shippingCompany && (
        <p className="px-1 text-xs text-muted-foreground">
          الشحن: <span className="font-semibold text-foreground">{order.shippingCompany}</span>
          {order.city ? ` · ${order.city}` : ''}
        </p>
      )}
    </div>
  );
}

function SizeChip({ size, large }: { size: string | null; large?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl bg-foreground px-3 text-background', large ? 'min-w-24 py-2' : 'min-w-16 py-1')}>
      <span className="text-[11px] opacity-80">المقاس</span>
      <span className={cn('font-extrabold leading-none', large ? 'text-4xl' : 'text-2xl')} dir="ltr">
        {size || '—'}
      </span>
    </div>
  );
}

function LocationChip({ location, note, large }: { location: string | null; note: string | null; large?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col justify-center rounded-xl px-3',
        location ? 'bg-amber-100 text-amber-950 ring-2 ring-amber-400' : 'bg-muted text-muted-foreground',
        large ? 'py-2' : 'py-1',
      )}
    >
      <span className="flex items-center gap-1 text-[11px] opacity-80">
        <MapPin className="h-3.5 w-3.5" /> الموقع
      </span>
      <span className={cn('font-mono font-extrabold leading-tight', large ? 'text-3xl' : 'text-xl')} dir="ltr">
        {location || 'غير مسجل'}
      </span>
      {note && <span className="text-xs">{note}</span>}
    </div>
  );
}

function SingleItem({
  item,
  progress,
  onZoom,
}: {
  item: PrepItem;
  progress: ItemProgress | undefined;
  onZoom: (url: string) => void;
}) {
  const scanned = (progress?.[item.index]?.checked ?? 0) >= item.quantity && progress?.[item.index]?.method === 'scan';
  return (
    <div className={cn('overflow-hidden rounded-2xl border-2 bg-card', scanned ? 'border-emerald-500' : 'border-transparent')}>
      {item.imageUrl ? (
        <button type="button" onClick={() => onZoom(item.imageUrl!)} className="relative block aspect-[4/5] max-h-[46vh] w-full bg-muted">
          <Image src={item.imageUrl} alt={item.name} fill unoptimized priority sizes="100vw" className="object-contain" />
          {scanned && (
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-sm font-bold text-white">
              <Check className="h-4 w-4" /> تم المسح
            </span>
          )}
        </button>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-sm text-muted-foreground">بدون صورة</div>
      )}
      <div className="space-y-2 p-3">
        <p className="text-lg font-bold leading-snug text-foreground">{item.name}</p>
        <div className="flex gap-2">
          <SizeChip size={item.size} large />
          <LocationChip location={item.location} note={item.locationNote} large />
        </div>
        <ItemMeta item={item} />
      </div>
    </div>
  );
}

function ItemMeta({ item }: { item: PrepItem }) {
  const extraOptions = item.options.filter(
    (option) => option.value && option.value !== item.size && option.value !== item.color,
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {item.sku && (
        <span dir="ltr" className="rounded-md bg-muted px-2 py-0.5 font-mono text-base font-bold text-foreground">
          {item.sku}
        </span>
      )}
      {item.color && <span className="font-semibold text-foreground">اللون: {item.color}</span>}
      {item.quantity > 1 && (
        <span className="rounded-md bg-orange-500 px-2 py-0.5 text-base font-extrabold text-white">×{item.quantity}</span>
      )}
      {extraOptions.map((option, index) => (
        <span key={index} className="rounded-md border px-2 py-0.5 text-xs text-foreground">
          {option.name}: {option.value}
        </span>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  checked,
  scanned,
  onTap,
  onReset,
  onZoom,
}: {
  item: PrepItem;
  checked: number;
  scanned: boolean;
  onTap: () => void;
  onReset: () => void;
  onZoom: (url: string) => void;
}) {
  const done = checked >= item.quantity;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-2xl border-2 bg-card p-2',
        done ? 'border-emerald-500 bg-emerald-50' : 'border-transparent',
      )}
    >
      {item.imageUrl ? (
        <button
          type="button"
          onClick={() => onZoom(item.imageUrl!)}
          className="relative h-28 w-22 shrink-0 overflow-hidden rounded-xl bg-muted"
          aria-label="تكبير الصورة"
        >
          <Image src={item.imageUrl} alt={item.name} fill unoptimized sizes="96px" className="object-cover" />
        </button>
      ) : (
        <div className="flex h-28 w-22 shrink-0 items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">—</div>
      )}
      <button type="button" onClick={onTap} disabled={done} className="flex min-w-0 flex-1 flex-col gap-1.5 text-right">
        <span className="line-clamp-2 text-sm font-bold text-foreground">{item.name}</span>
        <span className="flex gap-1.5">
          <SizeChip size={item.size} />
          <LocationChip location={item.location} note={null} />
        </span>
        <ItemMeta item={item} />
      </button>
      <div className="flex w-14 shrink-0 flex-col items-center justify-between">
        <button
          type="button"
          onClick={onTap}
          disabled={done}
          aria-label="تأكيد قطعة"
          className={cn(
            'flex h-14 w-14 flex-col items-center justify-center rounded-xl text-lg font-extrabold',
            done ? 'bg-emerald-600 text-white' : 'bg-muted text-foreground ring-2 ring-border',
          )}
        >
          {done ? <Check className="h-7 w-7" /> : `${checked}/${item.quantity}`}
        </button>
        {checked > 0 && (
          <button type="button" onClick={onReset} aria-label="إعادة العد" className="rounded-md p-1 text-muted-foreground">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {scanned && done && <span className="text-[10px] font-bold text-emerald-700">مسح</span>}
      </div>
    </div>
  );
}
