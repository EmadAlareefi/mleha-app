'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { PieceChangePreview } from '@/app/lib/returns/piece-changes-service';
import { CouponAmountDialog } from './coupon-amount-dialog';
import { InspectorNotesDialog } from './inspector-notes-dialog';
import { ProcessDialog } from './process-dialog';
import { ReopenDialog } from './reopen-dialog';
import { ReplacementOrderSheet } from './replacement-order-sheet';
import { RevokeCouponDialog } from './revoke-coupon-dialog';
import { TypeChangeDialog, type PieceChangeDraft } from './type-change-dialog';
import { WindowOverrideDialog } from './window-override-dialog';
import { describeCouponNotification, formatMoney, type Notify, type ReturnRequest } from './types';

type ConfirmState = {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  action: () => Promise<unknown>;
} | null;

export type RequestDialog =
  | 'process'
  | 'coupon-amount'
  | 'inspector-notes'
  | 'reopen'
  | 'replacement'
  | 'revoke-coupon'
  | 'window-override';

export type ExchangeAction = 'release' | 'cancel' | 'resend_link' | 'retry';

export interface RequestActions {
  busy: string | null;
  /** POST with a busy key; toasts the result and refreshes. Returns the response body, or null on error. */
  run: (key: string, url: string, body: unknown, success?: (data: any) => string) => Promise<any | null>;
  askConfirm: (state: NonNullable<ConfirmState>) => void;
  open: (dialog: RequestDialog) => void;
  /** Piece type / refund changes: previews, then confirms when money or a coupon is involved. */
  changePieces: (draft: PieceChangeDraft) => Promise<boolean>;
  issueCoupon: () => void;
  manualCoupon: { open: boolean; code: string; setCode: (code: string) => void; submit: () => Promise<void>; close: () => void };
  exchangeAction: (action: ExchangeAction) => void;
  /** Settings switch: false = exchanges are coupon only, no new replacement orders. */
  exchangeOrdersEnabled: boolean;
  dialogs: ReactNode;
}

/**
 * Everything staff can do to one return request, shared by the detail sheet and
 * the full page: the API calls, the confirmations and every dialog.
 */
export function useRequestActions(
  request: ReturnRequest | null,
  { notify, onChanged }: { notify: Notify; onChanged: () => void },
): RequestActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [dialog, setDialog] = useState<RequestDialog | null>(null);
  const [pieceChange, setPieceChange] = useState<{ draft: PieceChangeDraft; preview: PieceChangePreview } | null>(null);
  const [manualCouponOpen, setManualCouponOpen] = useState(false);
  const [manualCouponCode, setManualCouponCode] = useState('');
  const [exchangeOrdersEnabled, setExchangeOrdersEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/returns/exchange/config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setExchangeOrdersEnabled(data.exchangeOrdersEnabled !== false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (key: string, url: string, body: unknown, success?: (data: any) => string) => {
      setBusy(key);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'فشل تنفيذ الإجراء');
        if (success) notify(success(data));
        onChanged();
        return data;
      } catch (err) {
        notify(err instanceof Error ? err.message : 'حدث خطأ', 'destructive');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [notify, onChanged],
  );

  const changePieces = useCallback(
    async (draft: PieceChangeDraft) => {
      if (!request) return false;
      setBusy('pieces');
      try {
        const response = await fetch('/api/returns/pieces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: request.id, ...draft, dryRun: true }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'لا يمكن تغيير القطع');
        const preview: PieceChangePreview = data.preview;
        // Only a refund flag changed and nothing needs a decision: save directly.
        if (!preview.typeChanged && preview.warnings.length === 0 && !preview.coupon) {
          const saved = await fetch('/api/returns/pieces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: request.id, ...draft }),
          });
          const savedData = await saved.json().catch(() => ({}));
          if (!saved.ok) throw new Error(savedData.error || 'تعذر الحفظ');
          notify(savedData.message || 'تم الحفظ.');
          onChanged();
          return true;
        }
        setPieceChange({ draft, preview });
        return false;
      } catch (err) {
        notify(err instanceof Error ? err.message : 'حدث خطأ', 'destructive');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [notify, onChanged, request],
  );

  const issueCoupon = useCallback(() => {
    if (!request) return;
    const amount = Number(request.couponAmount ?? (request.type === 'exchange' ? request.totalRefundAmount : 0)) || 0;
    setConfirm({
      title: 'إنشاء كوبون الاستبدال',
      message:
        amount > 0
          ? `سيُنشأ كوبون بقيمة ${formatMoney(amount, request.currency)} في سلة ويُرسل للعميل على الواتساب.`
          : 'سيُنشأ كوبون الاستبدال بالقيمة المحسوبة لقطع الاستبدال في سلة ويُرسل للعميل على الواتساب.',
      confirmLabel: 'إنشاء وإرسال',
      action: async () => {
        setBusy('create-coupon');
        try {
          const response = await fetch('/api/returns/create-coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ returnRequestId: request.id, expiryDays: 30 }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (data?.permissionDenied) {
              setManualCouponOpen(true);
              notify('تعذر إنشاء الكوبون تلقائياً بسبب صلاحيات سلة. أدخلي رمز كوبون منشأ يدوياً.', 'destructive');
              return;
            }
            throw new Error(data?.error || 'فشل إنشاء الكوبون');
          }
          notify(
            `تم إنشاء الكوبون ${data?.coupon?.code ?? ''}. ${describeCouponNotification(data?.notification, 'وأُرسل للعميل على الواتساب.')}`,
          );
          onChanged();
        } catch (err) {
          notify(err instanceof Error ? err.message : 'حدث خطأ', 'destructive');
        } finally {
          setBusy(null);
        }
      },
    });
  }, [notify, onChanged, request]);

  const submitManualCoupon = useCallback(async () => {
    if (!request || !manualCouponCode.trim()) return;
    const data = await run(
      'manual-coupon',
      '/api/returns/manual-coupon',
      { returnRequestId: request.id, couponCode: manualCouponCode.trim() },
      (result) => describeCouponNotification(result.notification, 'تم تسجيل الكوبون وإرساله للعميل.'),
    );
    if (data) {
      setManualCouponOpen(false);
      setManualCouponCode('');
    }
  }, [manualCouponCode, request, run]);

  const exchangeAction = useCallback(
    (action: ExchangeAction) => {
      if (!request) return;
      const go = () =>
        run(`exchange:${action}`, '/api/returns/exchange-order', { returnRequestId: request.id, action }, (data) => data.message || 'تم.');
      if (action === 'release') {
        setConfirm({
          title: 'إرسال الطلب البديل للتجهيز الآن',
          message:
            'يتحول الطلب البديل في سلة إلى «طلب جديد» ليُجهّز ويُشحن، حتى لو لم يكتمل فحص القطعة المرتجعة أو كانت غير سليمة.',
          confirmLabel: 'إرسال للتجهيز',
          action: go,
        });
      } else if (action === 'cancel') {
        setConfirm({
          title: 'إلغاء الطلب البديل',
          message: 'يُلغى الطلب البديل في سلة ويعود المخزون، ويُسترجع أي فرق دفعه العميل. يتحول الرصيد إلى كوبون عند المعالجة.',
          danger: true,
          confirmLabel: 'إلغاء الطلب البديل',
          action: go,
        });
      } else {
        void go();
      }
    },
    [request, run],
  );

  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    notify(message);
    onChanged();
  };

  const dialogs = (
    <>
      <ProcessDialog
        request={dialog === 'process' ? request : null}
        onClose={close}
        onDone={({ completed, message }) => {
          setDialog(null);
          notify(message, completed ? 'default' : 'destructive');
          onChanged();
        }}
      />
      <CouponAmountDialog request={dialog === 'coupon-amount' ? request : null} onClose={close} onSaved={done} />
      <InspectorNotesDialog
        request={dialog === 'inspector-notes' ? request : null}
        onClose={close}
        onSaved={() => done('تم حفظ الملاحظات للمفتش.')}
      />
      <ReopenDialog request={request} open={dialog === 'reopen'} onOpenChange={(value) => !value && close()} onDone={done} />
      <RevokeCouponDialog
        request={request}
        open={dialog === 'revoke-coupon'}
        onOpenChange={(value) => !value && close()}
        onDone={done}
      />
      <ReplacementOrderSheet
        request={request}
        open={dialog === 'replacement'}
        onOpenChange={(value) => !value && close()}
        onCreated={onChanged}
      />
      <WindowOverrideDialog
        open={dialog === 'window-override'}
        onOpenChange={(value) => !value && close()}
        defaultOrderNumber={request?.orderNumber}
        onChanged={onChanged}
      />
      <TypeChangeDialog
        requestId={request?.id ?? null}
        orderNumber={request?.orderNumber}
        draft={pieceChange?.draft ?? null}
        preview={pieceChange?.preview ?? null}
        onClose={() => setPieceChange(null)}
        onDone={(message) => {
          setPieceChange(null);
          notify(message);
          onChanged();
        }}
      />
      <ConfirmationDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        confirmVariant={confirm?.danger ? 'danger' : 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          void action?.();
        }}
      />
    </>
  );

  return {
    busy,
    run,
    askConfirm: setConfirm,
    open: setDialog,
    changePieces,
    issueCoupon,
    manualCoupon: {
      open: manualCouponOpen,
      code: manualCouponCode,
      setCode: setManualCouponCode,
      submit: submitManualCoupon,
      close: () => setManualCouponOpen(false),
    },
    exchangeAction,
    exchangeOrdersEnabled,
    dialogs,
  };
}
