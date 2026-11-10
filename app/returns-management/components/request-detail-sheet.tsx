'use client';

import { useCallback } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/dashboard/states';
import { ActionBar, DetailHeader, RequestDetailBody } from './request-detail-body';
import { useRequestActions } from './use-request-actions';
import { useReturnRequest } from './use-return-request';
import type { Notify, ReturnRequest } from './types';

interface RequestDetailSheetProps {
  /** The open request (from the URL), or null. */
  requestId: string | null;
  /** The list's copy, shown at once while the fresh one loads. */
  initial?: ReturnRequest | null;
  onClose: () => void;
  /** Something changed: refresh the list behind the sheet. */
  onListChanged: () => void;
  notify: Notify;
}

/**
 * One request, full screen on phones and a side panel on desktop. It is
 * fetched by id, so it stays open (and current) when an action moves the
 * request to another tab of the list.
 */
export function RequestDetailSheet({ requestId, initial, onClose, onListChanged, notify }: RequestDetailSheetProps) {
  const { request, loading, error, reload } = useReturnRequest(requestId, initial);
  const onChanged = useCallback(() => {
    void reload();
    onListChanged();
  }, [onListChanged, reload]);
  const actions = useRequestActions(request, { notify, onChanged });

  return (
    <>
      <Sheet open={Boolean(requestId)} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="left"
          dir="rtl"
          showCloseButton={false}
          className="flex h-[100dvh] w-full flex-col gap-0 bg-background p-0 sm:max-w-2xl"
        >
          {request ? (
            <>
              <DetailHeader
                request={request}
                loading={loading}
                onBack={onClose}
                title={(children) => (
                  <SheetTitle asChild>
                    <h2>{children}</h2>
                  </SheetTitle>
                )}
                description={(children) => (
                  <SheetDescription asChild>
                    <div>{children}</div>
                  </SheetDescription>
                )}
              />
              <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                <RequestDetailBody request={request} actions={actions} />
              </div>
              <ActionBar request={request} actions={actions} showFullPageLink />
            </>
          ) : (
            <div className="flex flex-1 flex-col p-4">
              <SheetTitle className="sr-only">تفاصيل طلب الإرجاع</SheetTitle>
              <SheetDescription className="sr-only">جاري التحميل</SheetDescription>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : (
                <LoadingState />
              )}
              <Button variant="outline" className="mt-4 h-11" onClick={onClose}>
                إغلاق
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {actions.dialogs}
    </>
  );
}
