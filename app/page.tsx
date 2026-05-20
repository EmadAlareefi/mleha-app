import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function HomePage() {
  return <DashboardShell />;
}
