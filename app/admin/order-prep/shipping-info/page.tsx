export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import ShippingInfoClient from './ShippingInfoClient';

export default function ShippingInfoAdminPage() {
  return (
    <AppPageShell
      title="بيانات الشحن الدولي الناقصة"
      subtitle="طلبات دولية موقوفة حتى تستكمل العميلة الاسم الثلاثي والحي والشارع من الرابط المرسل لها"
    >
      <div className="mx-auto w-full max-w-5xl">
        <ShippingInfoClient />
      </div>
    </AppPageShell>
  );
}
