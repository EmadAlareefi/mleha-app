export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import OrderPrepClient from './OrderPrepClient';

export default function OrderPrepPage() {
  return (
    <AppPageShell title="تجهيز الطلبات" subtitle="إدارة تجهيز الطلبات ومتابعة حالة المنتجات">
      <div className="mx-auto w-full max-w-7xl">
        <OrderPrepClient />
      </div>
    </AppPageShell>
  );
}
