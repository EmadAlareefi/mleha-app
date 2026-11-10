import { Suspense } from 'react';
import { LoadingState } from '@/components/dashboard/states';
import { ReturnsManagementView } from './components/returns-management-view';

/** Returns & exchanges for staff. The view keeps its filters and the open request in the URL. */
export default function ReturnsManagementPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReturnsManagementView />
    </Suspense>
  );
}
