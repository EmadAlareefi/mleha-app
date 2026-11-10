export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import ShippingBoardClient from './ShippingBoardClient';

export default function ShippingBoardPage() {
  return (
    <AppPageShell title="لوحة الشحن" subtitle="الطلبات المجهزة بانتظار البوليصة، الأعطال، ووتيرة الشحن">
      <div className="mx-auto w-full max-w-6xl">
        <ShippingBoardClient />
      </div>
    </AppPageShell>
  );
}
