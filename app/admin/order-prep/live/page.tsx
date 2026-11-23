export const dynamic = 'force-dynamic';
export const revalidate = 0;

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import LiveDashboardClient from './LiveDashboardClient';

export const metadata: Metadata = { title: 'مركز قيادة المستودع' };

/**
 * Full-screen warehouse dashboard: prep board + shipping board + stuck orders.
 * Middleware lets in admin-order-prep and shipping-board users; the latter get
 * the shipping-only view (their APIs refuse prep data anyway).
 */
export default async function WarehouseLivePage() {
  const session = await getServerSession(authOptions);
  const scope = hasServiceAccess(session, ['admin-order-prep']) ? 'full' : 'shipping';
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#e9dccb]" />}>
      <LiveDashboardClient scope={scope} />
    </Suspense>
  );
}
