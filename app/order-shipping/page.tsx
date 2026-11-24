export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import ShipApp from './_components/ShipApp';

/** /order-shipping: the scan-to-print shipping station. */
export default async function OrderShippingPageWrapper() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { name?: string | null; username?: string | null; role?: string } | undefined;
  const isSupervisor = Boolean(session && (user?.role === 'admin' || hasServiceAccess(session, ['admin-order-prep'])));
  return <ShipApp userName={user?.name || user?.username || ''} isSupervisor={isSupervisor} />;
}
