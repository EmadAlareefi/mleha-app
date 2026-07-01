import { AppPageShell } from '@/components/dashboard/app-page-shell';
import TailorDashboard from './TailorDashboard';

export const revalidate = 0;

export default function TailorPage() {
  return (
    <AppPageShell title="لوحة الخياط" subtitle="أقمشتي، موديلاتي، التصنيع، وسجل التسليمات">
      <TailorDashboard />
    </AppPageShell>
  );
}
