export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import MissingItemsClient from './MissingItemsClient';

export default function OrderShortagesPage() {
  return (
    <AppPageShell title="نواقص الطلبات" subtitle="متابعة المنتجات غير المتوفرة أثناء تجهيز الطلبات">
      <div className="mx-auto w-full max-w-6xl">
        <MissingItemsClient />
      </div>
    </AppPageShell>
  );
}
