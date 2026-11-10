export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { AppPageShell } from '@/components/dashboard/app-page-shell';
import BoardClient from './BoardClient';

export default function OrderPrepBoardPage() {
  return (
    <AppPageShell title="لوحة التجهيز" subtitle="قائمة الانتظار، المجهِّزون، الاستثناءات، ومزامنة سلة">
      <div className="mx-auto w-full max-w-6xl">
        <BoardClient />
      </div>
    </AppPageShell>
  );
}
