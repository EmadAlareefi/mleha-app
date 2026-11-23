import {
  CircleHelp,
  CirclePause,
  Hourglass,
  PackageCheck,
  PackageOpen,
  PackageX,
  RefreshCwOff,
  Ticket,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { StageKey, StuckAction, StuckCategory } from '@/app/lib/stuck-orders/types';

export type CategoryMeta = {
  label: string;
  hint: string;
  Icon: LucideIcon;
  /** Icon chip + accent colors. */
  chip: string;
  ring: string;
};

/** Display order = pipeline order. */
export const CATEGORY_ORDER: StuckCategory[] = [
  'waiting_queue',
  'prep_stopped',
  'prep_abandoned',
  'sync_failed',
  'packed_no_shipping',
  'shipping_stuck',
  'label_not_shipped',
  'cancelled_in_warehouse',
  'unknown_stuck',
  'return_unprocessed',
];

export const CATEGORY_META: Record<StuckCategory, CategoryMeta> = {
  waiting_queue: {
    label: 'لم يدخل التجهيز',
    hint: 'طلب جديد لم يستلمه أي مجهز',
    Icon: Hourglass,
    chip: 'bg-sky-100 text-sky-700',
    ring: 'ring-sky-400',
  },
  prep_stopped: {
    label: 'موقوف في التجهيز',
    hint: 'أوقفه المجهز (نقص / مراجعة) ولم يُحسم',
    Icon: CirclePause,
    chip: 'bg-amber-100 text-amber-700',
    ring: 'ring-amber-400',
  },
  prep_abandoned: {
    label: 'سُحب ولم يكتمل',
    hint: 'استُلم للتجهيز ولم يُكمل',
    Icon: PackageOpen,
    chip: 'bg-orange-100 text-orange-700',
    ring: 'ring-orange-400',
  },
  sync_failed: {
    label: 'فشل تحديث سلة',
    hint: 'الحالة لم تتحدث في سلة',
    Icon: RefreshCwOff,
    chip: 'bg-violet-100 text-violet-700',
    ring: 'ring-violet-400',
  },
  packed_no_shipping: {
    label: 'مجهز بلا شحن',
    hint: 'جُهّز ولم يصل لمحطة الشحن',
    Icon: PackageCheck,
    chip: 'bg-teal-100 text-teal-700',
    ring: 'ring-teal-400',
  },
  shipping_stuck: {
    label: 'عالق في الشحن',
    hint: 'بانتظار البوليصة أو موقوف في المحطة',
    Icon: Truck,
    chip: 'bg-blue-100 text-blue-700',
    ring: 'ring-blue-400',
  },
  label_not_shipped: {
    label: 'بوليصة بلا شحن',
    hint: 'له بوليصة ولم يخرج / لم تستلمه الشركة',
    Icon: Ticket,
    chip: 'bg-rose-100 text-rose-700',
    ring: 'ring-rose-400',
  },
  cancelled_in_warehouse: {
    label: 'ملغي داخل المستودع',
    hint: 'أُلغي بعد تجهيزه — القطع تحتاج إرجاع للرف',
    Icon: PackageX,
    chip: 'bg-stone-200 text-stone-700',
    ring: 'ring-stone-400',
  },
  unknown_stuck: {
    label: 'عالق — سبب غير معروف',
    hint: 'لا يوجد له أي أثر شحن',
    Icon: CircleHelp,
    chip: 'bg-slate-200 text-slate-700',
    ring: 'ring-slate-400',
  },
  return_unprocessed: {
    label: 'مرتجع لم يُعالج',
    hint: 'وصل المستودع ولم تتم معالجته',
    Icon: Undo2,
    chip: 'bg-fuchsia-100 text-fuchsia-700',
    ring: 'ring-fuchsia-400',
  },
};

export const STAGE_LABELS: Record<string, string> = {
  placed: 'الطلب',
  prep: 'التجهيز',
  packed: 'مجهز',
  label: 'البوليصة',
  printed: 'الطباعة',
  scanned: 'الخروج',
  shipped: 'الشحن',
  requested: 'طلب الإرجاع',
  received: 'وصل المستودع',
  processing: 'المعالجة',
  done: 'مكتمل',
};

export const ORDER_STAGES: StageKey[] = ['placed', 'prep', 'packed', 'label', 'printed', 'scanned', 'shipped'];
export const RETURN_STAGES = ['requested', 'received', 'processing', 'done'];

export const ACTION_META: Record<StuckAction, { label: string; confirm: string; danger?: boolean }> = {
  requeue_escalation: { label: 'أعده للتجهيز', confirm: 'سيرجع الطلب إلى «طلب جديد» في سلة ويدخل طابور التجهيز من جديد.' },
  resolve_escalation: { label: 'أغلق الإيقاف', confirm: 'يُغلق الإيقاف دون تغيير حالة الطلب في سلة (عولج خارج النظام).', danger: true },
  retry_sync: { label: 'أعد تحديث سلة', confirm: 'سنحاول تحديث حالة الطلب في سلة الآن.' },
  dismiss_sync: { label: 'تجاهل التحديث', confirm: 'لن نحاول تحديث سلة مرة أخرى لهذه العملية.', danger: true },
  retry_task: { label: 'أعد محاولة الشحن', confirm: 'تعود مهمة الشحن للمحطة ونحاول إنشاء الشحنة من جديد.' },
  close_task: { label: 'أغلق مهمة الشحن', confirm: 'تُغلق مهمة الشحن (عولجت يدوياً أو أُلغي الطلب).', danger: true },
};

export const THRESHOLD_LABELS: Record<number, string> = { 24: '24 ساعة', 48: '48 ساعة', 72: '3 أيام', 168: 'أسبوع' };

export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '—';
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : days === 2 ? 'يومان' : `${days} أيام`;
}

const dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export const formatDate = (iso: string | null | undefined) => (iso ? dateFormatter.format(new Date(iso)) : '—');
