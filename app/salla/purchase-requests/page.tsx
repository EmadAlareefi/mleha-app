import { getServerSession } from 'next-auth';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { listPurchaseRequests } from '@/app/lib/salla-purchase-requests';
import PurchaseRequestsBoard from './PurchaseRequestsBoard';

export const revalidate = 0;

export default async function SallaPurchaseRequestsPage() {
  const [session, requests] = await Promise.all([
    getServerSession(authOptions),
    listPurchaseRequests(),
  ]);

  const canManage = hasServiceAccess(session, ['salla-purchase-requests-manage']);

  return (
    <AppPageShell
      title="طلبات الشراء"
      subtitle="اطلب شراء منتجات سلة وتابع الطلبات قيد الشراء"
    >
      <PurchaseRequestsBoard initialRequests={requests} canManage={canManage} />
    </AppPageShell>
  );
}
