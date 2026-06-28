import { getServerSession } from 'next-auth';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  getManufacturerUserId,
  listPurchaseRequests,
} from '@/app/lib/salla-purchase-requests';
import PurchaseRequestsBoard from './PurchaseRequestsBoard';

export const revalidate = 0;

export default async function SallaPurchaseRequestsPage() {
  const [session, requests] = await Promise.all([
    getServerSession(authOptions),
    listPurchaseRequests(),
  ]);

  const canManage = hasServiceAccess(session, ['salla-purchase-requests-manage']);
  // Only resolve whether this user is a manufacturer here (cheap, indexed lookup).
  // The heavy linked-product sales stats are loaded client-side so the page never
  // blocks on a full scan of the orders table.
  const manufacturerUserId = await getManufacturerUserId((session?.user as any)?.id);

  return (
    <AppPageShell
      title="طلبات الشراء"
      subtitle="اطلب شراء منتجات سلة وتابع الطلبات قيد الشراء"
    >
      <PurchaseRequestsBoard
        initialRequests={requests}
        loadManufacturerProducts={Boolean(manufacturerUserId)}
        canManage={canManage}
      />
    </AppPageShell>
  );
}
