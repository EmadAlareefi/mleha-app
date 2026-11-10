'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { ActionBar, DetailHeader, RequestDetailBody } from './request-detail-body';
import { useRequestActions } from './use-request-actions';
import { useReturnRequest } from './use-return-request';

/** The full page of one request: the same body, actions and dialogs as the sheet. */
export function RequestDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const notify = useCallback(
    (message: string, variant: 'default' | 'destructive' = 'default') =>
      toast({ title: variant === 'destructive' ? 'تعذر التنفيذ' : 'تم', description: message, variant }),
    [toast],
  );
  const { request, loading, error, reload } = useReturnRequest(id);
  const onChanged = useCallback(() => void reload(), [reload]);
  const actions = useRequestActions(request, { notify, onChanged });

  return (
    <AppPageShell title="طلب إرجاع / استبدال" contentClassName="flex flex-1 flex-col p-0">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {request ? (
          <>
            <DetailHeader request={request} loading={loading} onBack={() => router.push('/returns-management')} />
            <div className="flex-1 p-3 sm:p-6">
              <RequestDetailBody request={request} actions={actions} />
            </div>
            <ActionBar request={request} actions={actions} />
          </>
        ) : error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <LoadingState />
        )}
      </div>
      {actions.dialogs}
    </AppPageShell>
  );
}
