/** Shapes returned by /api/public/order-manage/order (see app/lib/order-manage/facts.ts). */

export type ManageAction = 'cancel' | 'address' | 'swap' | 'items';

export type ManageVerdict = { allowed: true } | { allowed: false; code: string; reason: string };

export type ManageItem = {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  image: string | null;
  options: Array<{ name: string; value: string }>;
  total: number | null;
};

export type ManageChange = {
  id: string;
  kind: string;
  state: string;
  refundStatus: string;
  refundAmount: number | null;
  currency: string | null;
  createdAt: string;
};

export type ManageOrder = {
  orderNumber: string;
  statusName: string | null;
  placedAt: string | null;
  total: number | null;
  currency: string;
  paymentMethod: string | null;
  items: ManageItem[];
  changes: ManageChange[];
};

export type ManageOrderResponse = { order: ManageOrder; actions: Record<ManageAction, ManageVerdict> };

export const SUPPORT_WHATSAPP = '966531349631';

export const formatMoney = (value: number | null | undefined, currency = 'SAR') =>
  `${(Number(value) || 0).toFixed(2)} ${currency === 'SAR' ? 'ر.س' : currency}`;

export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '';

export function supportLink(orderNumber: string | undefined, topic: string): string {
  const message = `مرحبًا، أحتاج مساعدة بخصوص ${topic}${orderNumber ? ` للطلب رقم ${orderNumber}` : ''}.`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}
