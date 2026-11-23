export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { Suspense } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import StuckOrdersClient from './StuckOrdersClient';

export default function StuckOrdersPage() {
  return (
    <AppPageShell title="الطلبات العالقة" subtitle="كل طلب توقف داخل المستودع: أين توقف، منذ متى، ولماذا">
      <div className="mx-auto w-full max-w-6xl">
        <Suspense fallback={<LoadingState />}>
          <StuckOrdersClient />
        </Suspense>
      </div>
    </AppPageShell>
  );
}
