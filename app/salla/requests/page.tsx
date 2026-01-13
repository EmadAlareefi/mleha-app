import AppNavbar from '@/components/AppNavbar';
import { listQuantityRequests } from '@/app/lib/salla-product-requests';
import RequestsDashboard from './RequestsDashboard';

export const revalidate = 0;

export default async function SallaRequestsPage() {
  const requests = await listQuantityRequests();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <AppNavbar title="طلبات كميات سلة" subtitle="إدارة الطلبات وتحديث حالات التوريد" />
      <RequestsDashboard initialRequests={requests} />
    </div>
  );
}
