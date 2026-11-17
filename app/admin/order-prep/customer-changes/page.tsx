export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import CustomerChangesClient from './CustomerChangesClient';

export default function CustomerChangesPage() {
  return (
    <AppPageShell
      title="تعديلات العملاء على الطلبات"
      subtitle="ما ألغاه أو عدّله العملاء بأنفسهم قبل التجهيز، وما يحتاج تدخلاً منك"
    >
      <div className="mx-auto w-full max-w-5xl">
        <CustomerChangesClient />
      </div>
    </AppPageShell>
  );
}
