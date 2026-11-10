'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Home, Loader2, Printer, ScanLine, Search, Truck } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isCameraScanSupported, useBarcodeScanner } from '@/components/hooks/useBarcodeScanner';
import { normalizeCode } from '@/app/lib/shipping/rules';
import type { StationView } from '@/app/lib/shipping/types';
import { feedback } from '@/app/order-prep/_components/feedback';
import { ScannerPanel } from '@/app/order-prep/_components/ScannerPanel';
import { cn } from '@/lib/utils';
import { StationCard } from './StationCard';

/**
 * The shipping station: scan the prep ticket → the order's card (photo, size,
 * quantity, warnings) → print the label. Courier labels are usually made
 * while the parcel walks over from packing, so printing is one tap; a label
 * still on its way prints by itself when it arrives.
 */

const POLL_MS = 2_000;
const ARM_MS = 1_500;
const WAITING = new Set(['queued', 'creating', 'awaiting_label']);

type Banner = { tone: 'error' | 'success' | 'info'; text: string } | null;
type Agent = { id: string; name: string | null; username: string; isActive?: boolean };

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PROBLEM_REASONS: Array<{ key: string; label: string }> = [
  { key: 'wrong_item', label: 'قطعة خاطئة أو مقاس خاطئ' },
  { key: 'missing_item', label: 'قطعة ناقصة' },
  { key: 'damaged', label: 'قطعة تالفة' },
  { key: 'address', label: 'مشكلة في العنوان' },
  { key: 'other', label: 'أخرى' },
];

async function callJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => null);
  return { response, data: data as Record<string, any> | null };
}

export default function ShipApp({ userName, isSupervisor }: { userName: string; isSupervisor: boolean }) {
  const [view, setView] = useState<StationView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [manualCode, setManualCode] = useState('');
  const [printWhenReady, setPrintWhenReady] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [problemOpen, setProblemOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const printKeyRef = useRef<{ orderId: string; key: string } | null>(null);
  const viewRef = useRef<StationView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => setCameraSupported(isCameraScanSupported()), []);

  const orderId = view?.orderId ?? null;
  useEffect(() => {
    if (!orderId) return;
    const timer = window.setTimeout(() => setArmedFor(orderId), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [orderId]);
  const arming = Boolean(orderId) && armedFor !== orderId;

  useEffect(() => {
    if (!banner || banner.tone === 'error') return;
    const timer = window.setTimeout(() => setBanner(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const shownAtRef = useRef(0);
  const showView = useCallback((next: StationView | null) => {
    if (next && printKeyRef.current?.orderId !== next.orderId) {
      printKeyRef.current = { orderId: next.orderId, key: newKey() };
      shownAtRef.current = Date.now();
    }
    setView(next);
  }, []);

  const lookup = useCallback(
    async (params: { code?: string; orderId?: string }, options: { quiet?: boolean } = {}) => {
      if (!options.quiet) setLoading(true);
      try {
        const query = params.orderId ? `orderId=${encodeURIComponent(params.orderId)}` : `code=${encodeURIComponent(params.code ?? '')}`;
        const { response, data } = await callJson(`/api/shipping-v2/lookup?${query}`);
        if (!response.ok || !data?.success) {
          if (!options.quiet) {
            feedback.scanWrong();
            setBanner({ tone: 'error', text: data?.error?.message || 'تعذر العثور على الطلب' });
          }
          return null;
        }
        const next = data.view as StationView;
        if (!options.quiet) {
          feedback.scanOk();
          setBanner(null);
          setPrintWhenReady(false);
        }
        showView(next);
        return next;
      } catch {
        if (!options.quiet) setBanner({ tone: 'error', text: 'تعذر الاتصال — تحقق من الشبكة' });
        return null;
      } finally {
        if (!options.quiet) setLoading(false);
      }
    },
    [showView],
  );

  const runAction = useCallback(
    async (name: string, url: string, body: Record<string, unknown>) => {
      setBusy(name);
      try {
        const { response, data } = await callJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (data?.view) showView(data.view as StationView);
        if (!response.ok || !data?.success) {
          feedback.scanWrong();
          setBanner({ tone: 'error', text: data?.error?.message || 'تعذر إتمام العملية' });
          return false;
        }
        if (data.message) setBanner({ tone: 'success', text: data.message });
        return true;
      } catch {
        setBanner({ tone: 'error', text: 'تعذر الاتصال — تحقق من الشبكة وحاول مرة أخرى' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [showView],
  );

  const print = useCallback(async () => {
    const current = viewRef.current;
    if (!current || !printKeyRef.current) return;
    // One automatic attempt per request: a failure needs a new tap.
    setPrintWhenReady(false);
    const ok = await runAction('print', '/api/shipping-v2/print', { orderId: current.orderId, printKey: printKeyRef.current.key });
    if (ok) {
      feedback.done();
      setRecent((list) => [current.orderNumber, ...list.filter((entry) => entry !== current.orderNumber)].slice(0, 5));
    }
  }, [runAction]);

  // Ask Salla again; the label then prints by itself when it arrives.
  const retryCreate = useCallback(async () => {
    const current = viewRef.current;
    if (!current) return;
    const ok = await runAction('create', '/api/shipping-v2/create-now', { orderId: current.orderId });
    if (ok) setPrintWhenReady(true);
  }, [runAction]);

  // A label still on its way: poll, and print by itself if asked to.
  const waiting = Boolean(view?.state && WAITING.has(view.state)) || Boolean(view && !view.state && view.prep.packed);
  useEffect(() => {
    if (!orderId || !waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void lookup({ orderId }, { quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [lookup, orderId, waiting]);

  useEffect(() => {
    if (printWhenReady && view?.state === 'label_ready' && !view.flags.doNotShip && busy === null) {
      void print();
    }
  }, [busy, print, printWhenReady, view]);

  const onScan = useCallback(
    (raw: string, source: 'camera' | 'keyboard' = 'keyboard') => {
      const code = normalizeCode(raw);
      if (!code) return;
      const current = viewRef.current;
      // Scanning the order on screen again = print it — but not a ticket
      // still held in front of the camera from the first scan.
      if (current && (code === current.orderNumber || code === current.orderId)) {
        // A camera keeps seeing the ticket, so only a deliberate second scan
        // with a hand scanner prints; on the phone it's the print button.
        if (source === 'camera' || Date.now() - shownAtRef.current < 3_000) return;
        if (current.state === 'label_ready') void print();
        else if (current.state && WAITING.has(current.state)) setPrintWhenReady(true);
        return;
      }
      void lookup({ code });
    },
    [lookup, print],
  );

  const scanner = useBarcodeScanner({ onScan, keyboard: !problemOpen && !agentOpen });

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    (document.activeElement as HTMLElement | null)?.blur();
    void lookup({ code });
  };

  const primary = (() => {
    if (!view) return null;
    if (view.flags.doNotShip) return { label: 'لا تشحن — سلّمه للمشرف', disabled: true, onClick: () => undefined };
    switch (view.state) {
      case 'label_ready':
        return { label: '🖨 طباعة البوليصة', disabled: false, onClick: () => void print() };
      case 'printed':
        return isSupervisor
          ? { label: '🖨 إعادة الطباعة (مشرف)', disabled: false, onClick: () => void print() }
          : { label: 'طُبعت ✓ — امسح الطلب التالي', disabled: true, onClick: () => undefined };
      case 'queued':
      case 'creating':
      case 'awaiting_label':
        if (view.task?.canRetry) {
          return { label: '🔄 البوليصة تأخرت — أعد الطلب', disabled: false, onClick: () => void retryCreate() };
        }
        return printWhenReady
          ? { label: '⏳ ستُطبع فور وصولها', disabled: true, onClick: () => undefined }
          : { label: '🖨 اطبع عند الجاهزية', disabled: false, onClick: () => setPrintWhenReady(true) };
      case 'failed':
        return { label: '🔄 أعد إنشاء الشحنة', disabled: false, onClick: () => void retryCreate() };
      case 'needs_agent':
        return { label: '🛵 اختر المندوب', disabled: false, onClick: () => setAgentOpen(true) };
      case 'manual_international':
        return {
          label: '🧾 طباعة الفاتورة التجارية',
          disabled: false,
          onClick: () =>
            void (async () => {
              setBusy('invoice');
              try {
                const { response, data } = await callJson('/api/invoices/print', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId: view.orderId, orderNumber: view.orderNumber, forceInternational: true, allowDomestic: false }),
                });
                setBanner(
                  response.ok && data?.success !== false
                    ? { tone: 'success', text: 'أُرسلت الفاتورة التجارية للطابعة' }
                    : { tone: 'error', text: data?.error || 'تعذر طباعة الفاتورة' },
                );
              } catch {
                setBanner({ tone: 'error', text: 'تعذر الاتصال' });
              } finally {
                setBusy(null);
              }
            })(),
        };
      case 'blocked':
      case 'cancelled':
        return { label: 'الطلب موقوف', disabled: true, onClick: () => undefined };
      default:
        if (view.method === 'local') return { label: '🛵 اختر المندوب', disabled: false, onClick: () => setAgentOpen(true) };
        if (view.method === 'international') return { label: 'طلب دولي — لا يُنشأ هنا', disabled: true, onClick: () => undefined };
        return {
          label: view.prep.packed ? '⏳ جاري التحضير…' : 'إنشاء الشحنة الآن',
          disabled: view.prep.packed,
          onClick: () => void runAction('create', '/api/shipping-v2/create-now', { orderId: view.orderId }),
        };
    }
  })();

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[calc(96px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="الرئيسية" className="rounded-xl border p-2">
            <Home className="h-5 w-5" />
          </Link>
          <form onSubmit={submitManual} className="flex flex-1 items-center gap-2">
            <input
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              inputMode="numeric"
              placeholder="رقم الطلب أو التتبع"
              className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-base"
            />
            <button type="submit" className="flex h-11 w-11 items-center justify-center rounded-xl border" aria-label="بحث">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            </button>
          </form>
          {cameraSupported && (
            <button
              type="button"
              onClick={() => (scanner.active ? scanner.stop() : void scanner.start())}
              className={cn(
                'flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-bold',
                scanner.active ? 'bg-emerald-600 text-white' : 'border',
              )}
            >
              <Camera className="h-5 w-5" />
            </button>
          )}
        </div>
        {recent.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <Printer className="ml-1 inline h-3.5 w-3.5" />
            آخر بوالص: {recent.map((entry) => `#${entry}`).join(' · ')}
          </p>
        )}
      </header>

      {banner && (
        <div
          className={cn(
            'mx-3 mt-3 rounded-xl border-2 px-3 py-2 text-sm font-bold',
            banner.tone === 'error' && 'border-red-500 bg-red-50 text-red-900',
            banner.tone === 'success' && 'border-emerald-500 bg-emerald-50 text-emerald-900',
            banner.tone === 'info' && 'border-blue-400 bg-blue-50 text-blue-900',
          )}
          onClick={() => setBanner(null)}
        >
          {banner.text}
        </div>
      )}
      {scanner.error && <p className="mx-3 mt-2 text-sm font-semibold text-red-700">{scanner.error}</p>}

      {view ? (
        <StationCard view={view} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <ScanLine className="h-16 w-16 text-muted-foreground" />
          <p className="text-xl font-extrabold">امسح بطاقة الطلب</p>
          <p className="text-sm text-muted-foreground">
            {cameraSupported ? 'شغّل الكاميرا من الأعلى، أو اكتب رقم الطلب.' : 'استخدم الماسح أو اكتب رقم الطلب.'}
          </p>
          {cameraSupported && !scanner.active && (
            <button
              type="button"
              onClick={() => void scanner.start()}
              className="flex h-14 items-center gap-2 rounded-2xl bg-emerald-600 px-6 text-lg font-extrabold text-white"
            >
              <Camera className="h-6 w-6" /> تشغيل الكاميرا
            </button>
          )}
          {userName && <p className="text-xs text-muted-foreground">{userName}</p>}
        </div>
      )}

      <ScannerPanel videoRef={scanner.videoRef} active={scanner.active} onClose={scanner.stop} />

      {view && primary && (
        <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setProblemOpen(true)}
              disabled={busy !== null || view.state === 'blocked'}
              className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-red-300 text-sm font-bold text-red-700 disabled:opacity-40"
            >
              <AlertTriangle className="h-5 w-5" /> مشكلة
            </button>
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled || busy !== null || arming}
              className={cn(
                'flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-lg font-extrabold text-white shadow-md active:scale-[0.98]',
                primary.disabled || arming ? 'bg-muted-foreground/40' : view.flags.doNotShip ? 'bg-red-600' : 'bg-emerald-600',
              )}
            >
              {busy && busy !== 'problem' && <Loader2 className="h-5 w-5 animate-spin" />}
              <span className="truncate">{primary.label}</span>
            </button>
          </div>
        </footer>
      )}

      <ProblemSheet
        open={problemOpen}
        orderNumber={view?.orderNumber ?? ''}
        onClose={() => setProblemOpen(false)}
        onSubmit={async (reason, note) => {
          if (!view) return;
          const ok = await runAction('problem', '/api/shipping-v2/problem', { orderId: view.orderId, reason, note });
          if (ok) setProblemOpen(false);
        }}
        busy={busy === 'problem'}
      />
      <AgentSheet
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        busy={busy === 'local'}
        onSubmit={async (agentId) => {
          if (!view) return;
          const ok = await runAction('local', '/api/shipping-v2/local', { orderId: view.orderId, deliveryAgentId: agentId });
          if (ok) {
            setAgentOpen(false);
            setRecent((list) => [view.orderNumber, ...list.filter((entry) => entry !== view.orderNumber)].slice(0, 5));
          }
        }}
      />
    </div>
  );
}

function ProblemSheet({
  open,
  orderNumber,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  orderNumber: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string, note: string | null) => void;
}) {
  const [reason, setReason] = useState('wrong_item');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setReason('wrong_item');
      setNote('');
    }
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle>مشكلة في الطلب #{orderNumber}</SheetTitle>
          <SheetDescription>يُوقف الطلب ولا تُطبع بوليصته. إن لم تُنشأ الشحنة بعد يُحوّل للمراجعة (X4).</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2">
          {PROBLEM_REASONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setReason(entry.key)}
              className={cn(
                'h-12 rounded-xl border-2 px-4 text-right text-base font-bold',
                reason === entry.key ? 'border-red-500 bg-red-50 text-red-900' : 'border-border',
              )}
            >
              {entry.label}
            </button>
          ))}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="ملاحظة (اختياري)"
            rows={2}
            className="rounded-xl border bg-card p-3 text-base"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit(reason, note.trim() || null)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-red-600 text-lg font-extrabold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" />} إيقاف الطلب
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const PREFERRED_AGENT = (agent: Agent) => agent.id === '11' || agent.username === '11' || (agent.name ?? '').replace(/\s+/g, '').includes('سعيد');

function AgentSheet({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (agentId: string) => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!open || agents) return;
    void (async () => {
      try {
        const { response, data } = await callJson('/api/delivery-agents');
        if (!response.ok || data?.success === false) throw new Error();
        const list = ((data?.deliveryAgents ?? []) as Agent[]).filter((agent) => agent.isActive !== false);
        setAgents(list);
        setSelected((current) => current ?? list.find(PREFERRED_AGENT)?.id ?? list[0]?.id ?? null);
      } catch {
        setError('تعذر تحميل قائمة المناديب');
      }
    })();
  }, [agents, open]);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle>توصيل محلي — اختر المندوب</SheetTitle>
          <SheetDescription>تُنشأ الشحنة المحلية ويُطبع ملصقها ويُسند الطلب للمندوب.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2">
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          {!agents && !error && <Loader2 className="mx-auto h-6 w-6 animate-spin" />}
          {agents?.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setSelected(agent.id)}
              className={cn(
                'flex h-12 items-center gap-2 rounded-xl border-2 px-4 text-base font-bold',
                selected === agent.id ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-border',
              )}
            >
              <Truck className="h-5 w-5" /> {agent.name || agent.username}
            </button>
          ))}
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => selected && onSubmit(selected)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" />} إنشاء الشحنة وطباعة الملصق
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
