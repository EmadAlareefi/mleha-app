'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Loader2, PackageOpen, X } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { isCameraScanSupported, useBarcodeScanner } from '@/components/hooks/useBarcodeScanner';
import { hasSharedSku, matchScan } from '@/app/lib/order-prep/scan-match';
import type { PrepItem, PrepState, ProblemItem } from '@/app/lib/order-prep/types';
import type { ScanMode } from '@/app/lib/order-prep/settings';
import { cn } from '@/lib/utils';
import { feedback } from './feedback';
import { OrderView } from './OrderView';
import { ProblemSheet } from './ProblemSheet';
import { ScannerPanel } from './ScannerPanel';
import { StartScreen } from './StartScreen';
import { TopBar } from './TopBar';
import { UndoBar } from './UndoBar';
import {
  UNDO_MS,
  allUnitsChecked,
  initialPrepState,
  needsItemChecks,
  prepReducer,
  summarizeChecks,
  type Banner,
} from './prep-store';
import { usePrepRuntime } from './usePrepRuntime';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Done stays locked this long after a new order appears, so a double tap on
// Done can't also complete the order that swaps in under the finger.
const DONE_ARM_MS = 1_500;

const BANNER_STYLES: Record<Banner['tone'], string> = {
  error: 'border-red-500 bg-red-50 text-red-900',
  warn: 'border-amber-500 bg-amber-50 text-amber-900',
  info: 'border-blue-400 bg-blue-50 text-blue-900',
  success: 'border-emerald-500 bg-emerald-50 text-emerald-900',
};

export default function PrepApp({
  initialState,
  scanMode,
  userId,
}: {
  initialState: PrepState | null;
  scanMode: ScanMode;
  userId: string;
}) {
  const [state, dispatch] = useReducer(prepReducer, initialState, initialPrepState);
  const runtime = usePrepRuntime(state, dispatch, userId);
  const [problemOpen, setProblemOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'pause' | 'return'>(null);
  const [manualOverride, setManualOverride] = useState<Record<string, boolean>>({});
  const [cameraSupported, setCameraSupported] = useState(false);
  useEffect(() => setCameraSupported(isCameraScanSupported()), []);

  const view = state.current;
  const progress = view ? state.progress[view.assignmentId] : undefined;
  const checkable = view ? needsItemChecks(view) : false;
  const allChecked = view ? allUnitsChecked(view, progress) : false;
  const allScanned = Boolean(
    view &&
      view.order.items.length > 0 &&
      view.order.items.every((item) => progress?.[item.index]?.method === 'scan' && (progress[item.index].checked ?? 0) >= item.quantity),
  );
  const remaining = view
    ? view.order.items.reduce((sum, item) => sum + Math.max(0, item.quantity - (progress?.[item.index]?.checked ?? 0)), 0)
    : 0;
  const scanItems = useMemo(
    () => view?.order.items.map((item) => ({ index: item.index, sku: item.sku, size: item.size, quantity: item.quantity })) ?? [],
    [view],
  );
  const sharedSku = useMemo(() => hasSharedSku(scanItems), [scanItems]);
  const override = view ? Boolean(manualOverride[view.assignmentId]) : false;
  const scanRequired = scanMode === 'required' && scanItems.some((item) => item.sku);
  const manualAllowed = !scanRequired || override;

  // Non-sticky banners clear themselves.
  useEffect(() => {
    const transient = state.banners.filter((banner) => !banner.sticky);
    if (transient.length === 0) return;
    const timers = transient.map((banner) =>
      window.setTimeout(() => dispatch({ type: 'DISMISS_BANNER', id: banner.id }), banner.tone === 'error' ? 5_000 : 3_000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [state.banners]);

  const currentAssignmentId = view?.assignmentId ?? null;
  const [armedFor, setArmedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!currentAssignmentId) return;
    const timer = window.setTimeout(() => setArmedFor(currentAssignmentId), DONE_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [currentAssignmentId]);
  const doneArming = Boolean(view) && armedFor !== currentAssignmentId;

  const viewRef = useRef(view);
  const progressRef = useRef(progress);
  useEffect(() => {
    viewRef.current = view;
    progressRef.current = progress;
  });

  const onScan = useCallback((value: string) => {
    const current = viewRef.current;
    if (!current) return;
    const checked = Object.fromEntries(
      Object.entries(progressRef.current ?? {}).map(([index, entry]) => [Number(index), entry.checked]),
    );
    const items = current.order.items.map((item) => ({ index: item.index, sku: item.sku, size: item.size, quantity: item.quantity }));
    const result = matchScan(value, items, checked);
    if (result.kind === 'match') {
      const item = current.order.items.find((entry) => entry.index === result.index)!;
      dispatch({ type: 'MARK_ITEM', assignmentId: current.assignmentId, index: item.index, method: 'scan', quantity: item.quantity, mode: 'add' });
      feedback.scanOk();
      dispatch({
        type: 'BANNER',
        banner: { id: 'scan', tone: 'success', text: `✓ ${item.name}${item.size ? ` — تأكد أن المقاس ${item.size}` : ''}` },
      });
    } else if (result.kind === 'already_done') {
      feedback.scanWrong();
      dispatch({ type: 'BANNER', banner: { id: 'scan', tone: 'warn', text: 'تم مسح كل قطع هذا المنتج مسبقاً' } });
    } else {
      feedback.scanWrong();
      dispatch({
        type: 'BANNER',
        banner: { id: 'scan', tone: 'error', text: `الباركود (${result.scanned}) لا يطابق هذا الطلب — تأكد من القطعة` },
      });
    }
  }, []);

  const scanner = useBarcodeScanner({ onScan, keyboard: state.phase === 'packing' });

  const handleDone = useCallback(() => {
    if (!view || doneArming) return;
    const confirmAll = !checkable && !allChecked;
    const { itemChecks, scanMethod } = summarizeChecks(view, progress, confirmAll);
    const orderNumber = view.order.orderNumber;
    dispatch({
      type: 'DONE',
      now: Date.now(),
      action: {
        id: newId(),
        kind: 'complete',
        assignmentId: view.assignmentId,
        orderId: view.order.orderId,
        orderNumber,
        itemChecks,
        scanMethod,
        notBefore: Date.now() + UNDO_MS,
        attempts: 0,
        nextTryAt: 0,
      },
    });
    feedback.done();
    // Shared printer: the ticket that comes out now belongs to this order.
    void runtime.printTicket(view.order.orderId, orderNumber);
    window.scrollTo({ top: 0 });
  }, [allChecked, checkable, doneArming, progress, runtime, view]);

  const handleProblem = useCallback(
    (items: ProblemItem[], note: string | null) => {
      if (!view) return;
      const { itemChecks } = summarizeChecks(view, progress, false);
      dispatch({
        type: 'PROBLEM',
        action: {
          id: newId(),
          kind: 'exception',
          assignmentId: view.assignmentId,
          orderId: view.order.orderId,
          orderNumber: view.order.orderNumber,
          items,
          note,
          itemChecks,
          notBefore: 0,
          attempts: 0,
          nextTryAt: 0,
        },
      });
      setProblemOpen(false);
      dispatch({ type: 'BANNER', banner: { id: 'problem', tone: 'info', text: `سُجّلت مشكلة الطلب #${view.order.orderNumber}` } });
      window.scrollTo({ top: 0 });
    },
    [progress, view],
  );

  const release = useCallback(
    (scope: 'all' | 'current', reason: string | null) => {
      const target = view;
      dispatch({
        type: 'RELEASE',
        action: {
          id: newId(),
          kind: 'release',
          scope,
          reason,
          orderId: target?.order.orderId ?? '',
          orderNumber: target?.order.orderNumber ?? '',
          notBefore: 0,
          attempts: 0,
          nextTryAt: 0,
        },
      });
      if (scope === 'all') scanner.stop();
    },
    [scanner, view],
  );

  const tapItem = useCallback(
    (item: PrepItem) => {
      if (!view || !manualAllowed) {
        if (!manualAllowed) {
          dispatch({ type: 'BANNER', banner: { id: 'scan', tone: 'warn', text: 'امسح باركود القطعة لتأكيدها' } });
        }
        return;
      }
      dispatch({ type: 'MARK_ITEM', assignmentId: view.assignmentId, index: item.index, method: 'manual', quantity: item.quantity, mode: 'add' });
    },
    [manualAllowed, view],
  );

  const resetItem = useCallback(
    (item: PrepItem) => {
      if (!view) return;
      dispatch({ type: 'MARK_ITEM', assignmentId: view.assignmentId, index: item.index, method: 'manual', quantity: item.quantity, mode: 'clear' });
    },
    [view],
  );

  const lastDone = state.lastDone;
  const reprint = useCallback(() => {
    if (lastDone) void runtime.printTicket(lastDone.orderId, lastDone.orderNumber);
  }, [lastDone, runtime]);

  const singleItem = view && !checkable ? view.order.items[0] : null;
  const singleScanned = Boolean(singleItem && allScanned);
  const doneBlockedByChecks = checkable && !allChecked;
  const doneBlockedByScan = scanRequired && !allScanned && !override;
  const doneDisabled = !view || doneArming || doneBlockedByChecks || doneBlockedByScan || view.order.items.length === 0;
  const doneLabel = !view
    ? 'تم التجهيز'
    : doneBlockedByChecks
      ? `تبقّى ${remaining} ${remaining === 1 ? 'قطعة' : 'قطع'}`
      : doneBlockedByScan
        ? 'امسح الباركود أولاً'
        : singleScanned && singleItem?.size
          ? `المقاس ${singleItem.size} صحيح — تم`
          : 'تم التجهيز';

  const packing = state.phase === 'packing';
  const showStart = state.phase === 'idle' || state.phase === 'starting' || state.phase === 'empty';

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar
        current={packing ? view : null}
        stats={state.stats}
        myCompletedToday={state.myCompletedToday}
        lastDone={lastDone}
        pending={state.queue.length}
        online={state.online}
        onPause={packing ? () => setConfirm('pause') : null}
        onReprint={reprint}
      />

      {state.banners.length > 0 && (
        <div className="sticky top-[76px] z-20 space-y-1.5 px-3 pt-2">
          {state.banners.map((banner) => (
            <div key={banner.id} className={cn('flex items-start gap-2 rounded-xl border-2 px-3 py-2 text-sm font-semibold shadow-sm', BANNER_STYLES[banner.tone])}>
              <span className="flex-1">{banner.text}</span>
              <button type="button" onClick={() => dispatch({ type: 'DISMISS_BANNER', id: banner.id })} aria-label="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="flex flex-1 flex-col pb-[calc(96px+env(safe-area-inset-bottom))]">
        {showStart && (
          <StartScreen
            stats={state.stats}
            myCompletedToday={state.myCompletedToday}
            starting={state.phase === 'starting'}
            empty={state.phase === 'empty'}
            onStart={() => void runtime.start()}
          />
        )}

        {packing && view && (
          <OrderView
            key={view.assignmentId}
            view={view}
            progress={progress}
            checkable={checkable}
            sharedSku={sharedSku}
            onTapItem={tapItem}
            onResetItem={resetItem}
            onSkip={() => release('current', 'verify_issue')}
          />
        )}

        {packing && !view && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            {state.queue.length > 0 || state.inFlightId ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm font-semibold">جاري تحميل الطلب التالي…</p>
              </>
            ) : (
              <>
                <PackageOpen className="h-10 w-10" />
                <p className="text-sm font-semibold">لا توجد طلبات حالياً. يتم التحقق تلقائياً.</p>
              </>
            )}
          </div>
        )}
      </main>

      {state.undo && (
        <UndoBar orderNumber={state.undo.orderNumber} expiresAt={state.undo.expiresAt} onUndo={() => dispatch({ type: 'UNDO', now: Date.now() })} />
      )}

      <ScannerPanel videoRef={scanner.videoRef} active={scanner.active && packing} onClose={scanner.stop} />

      {packing && view && (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)] backdrop-blur">
          {scanner.error && <p className="pb-1 text-center text-xs font-semibold text-red-700">{scanner.error}</p>}
          {scanRequired && !allScanned && !override && (
            <button
              type="button"
              onClick={() => setManualOverride((prev) => ({ ...prev, [view.assignmentId]: true }))}
              className="mb-1 w-full text-center text-xs font-semibold text-muted-foreground underline"
            >
              الباركود لا يعمل؟ تأكيد يدوي
            </button>
          )}
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => setProblemOpen(true)}
              className="flex h-16 w-[26%] flex-col items-center justify-center rounded-2xl border-2 border-amber-500 bg-amber-50 text-xs font-bold text-amber-900"
            >
              <AlertTriangle className="h-5 w-5" /> مشكلة
            </button>
            {cameraSupported && (
              <button
                type="button"
                onClick={scanner.active ? scanner.stop : () => void scanner.start()}
                aria-pressed={scanner.active}
                className={cn(
                  'flex h-16 w-[20%] flex-col items-center justify-center rounded-2xl border-2 text-xs font-bold',
                  scanner.active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border bg-background text-foreground',
                )}
              >
                <Camera className="h-5 w-5" /> {scanner.active ? 'يمسح' : 'مسح'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDone}
              disabled={doneDisabled}
              className={cn(
                'flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl text-lg font-extrabold text-white shadow-md active:scale-[0.98]',
                doneDisabled ? 'bg-muted-foreground/40' : 'bg-emerald-600',
              )}
            >
              {!doneDisabled && <Check className="h-6 w-6" />}
              <span className="truncate">{doneLabel}</span>
            </button>
          </div>
        </footer>
      )}

      <ProblemSheet
        open={problemOpen}
        view={view}
        onClose={() => setProblemOpen(false)}
        onSubmit={handleProblem}
        onReturnToQueue={() => {
          setProblemOpen(false);
          setConfirm('return');
        }}
      />

      <ConfirmationDialog
        open={confirm !== null}
        title={confirm === 'pause' ? 'إيقاف مؤقت' : 'إرجاع الطلب للقائمة'}
        message={
          confirm === 'pause'
            ? 'سيعود طلبك الحالي والتالي إلى القائمة ليأخذها زميل. هل تريد الإيقاف؟'
            : 'سيعود هذا الطلب إلى القائمة ويأخذه زميل، وينتقل لك الطلب التالي.'
        }
        confirmLabel={confirm === 'pause' ? 'إيقاف' : 'إرجاع'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          release(confirm === 'pause' ? 'all' : 'current', confirm === 'pause' ? 'pause' : 'returned_by_packer');
          setConfirm(null);
        }}
      />
    </div>
  );
}
