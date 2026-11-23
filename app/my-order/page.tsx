import { OrderManageClient } from '@/components/order-manage/OrderManageClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إدارة طلبي', robots: { index: false } };

/**
 * Customer self-service: cancel or change an order before it is prepared.
 * Public page; the customer proves the order is theirs with its number, its
 * mobile and a one-time code. `?o=` only prefills the order number.
 */
export default async function MyOrderPage({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const { o } = await searchParams;
  const initialOrderNumber = typeof o === 'string' ? o.replace(/[^\d٠-٩۰-۹]/g, '').slice(0, 20) : '';
  return <OrderManageClient initialOrderNumber={initialOrderNumber} />;
}
