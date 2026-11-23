export const dynamic = 'force-dynamic';
export const revalidate = 0;

import type { Metadata } from 'next';
import { Suspense } from 'react';
import LiveDashboardClient from './LiveDashboardClient';

export const metadata: Metadata = { title: 'مركز قيادة المستودع' };

/** Full-screen warehouse dashboard: prep board + shipping board + stuck orders. No app sidebar. */
export default function WarehouseLivePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#e9dccb]" />}>
      <LiveDashboardClient />
    </Suspense>
  );
}
