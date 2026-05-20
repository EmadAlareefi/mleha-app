import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { listQuantityRequests } from '@/app/lib/salla-product-requests';
import RequestsDashboard from './RequestsDashboard';

export const revalidate = 0;

export default async function SallaRequestsPage() {
  const requests = await listQuantityRequests();

  return (
    <AppPageShell title="طلبات كميات سلة" subtitle="إدارة الطلبات وتحديث حالات التوريد">
      <RequestsDashboard initialRequests={requests} />
    </AppPageShell>
  );
}
