import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { ServiceCardGrid } from '@/components/dashboard/service-card-grid';
import { getHubCardServices } from '@/components/dashboard/dashboard-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FabricHubPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const canFabric = hasServiceAccess(session, ['fabric-management', 'fabric-warehouse']);

  if (!canFabric) {
    redirect('/');
  }

  const services = getHubCardServices({ canFabric });

  return (
    <AppPageShell title="الأقمشة والخياطين" subtitle="الوصول السريع لإدارة الأقمشة">
      <ServiceCardGrid services={services} />
    </AppPageShell>
  );
}
