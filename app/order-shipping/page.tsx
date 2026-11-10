export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { getShippingSettings } from '@/app/lib/shipping/settings';
import OrderShippingPage from './legacy/OrderShippingClient';
import ShipApp from './_components/ShipApp';

/**
 * /order-shipping serves the new scan-to-print station when
 * `shipping.v2_enabled` is on (or with ?v=2 for a pilot); ?v=1 keeps the old
 * page reachable meanwhile.
 */
export default async function OrderShippingPageWrapper({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const version = typeof params.v === 'string' ? params.v : null;
  const settings = await getShippingSettings();
  const useV2 = version === '2' || (settings.v2Enabled && version !== '1');
  if (!useV2) return <OrderShippingPage />;

  const session = await getServerSession(authOptions);
  const user = session?.user as { name?: string | null; username?: string | null; role?: string } | undefined;
  const isSupervisor = Boolean(session && (user?.role === 'admin' || hasServiceAccess(session, ['admin-order-prep'])));
  return <ShipApp userName={user?.name || user?.username || ''} isSupervisor={isSupervisor} />;
}
