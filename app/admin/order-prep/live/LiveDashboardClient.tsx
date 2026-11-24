'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, BarChart3, Expand, House, ListOrdered, Loader2, Moon, MonitorCheck, MonitorOff, RefreshCcw, Settings2, Shrink, Sun, SunMoon, Tv, Volume2, VolumeX, X } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/use-toast';
import type { BoardPacker } from '@/app/lib/order-prep/board';
import type { PrepSettings } from '@/app/lib/order-prep/settings';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { DEFAULT_THRESHOLD_HOURS, parseThreshold } from '@/app/lib/stuck-orders/threshold';
import type { ActionTarget, JourneyStaff, StuckItem } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { AnalyticsSection } from '@/app/admin/order-prep/_components/analytics/AnalyticsSection';
import { ACTION_META } from './_components/labels';
import { OrderJourneySheet } from './_components/OrderJourneySheet';
import { ViolationDialog, type ViolationInput, type ViolationTarget } from './_components/ViolationDialog';
import styles from './live.module.css';
import { AlertsPanel, type AlertAction } from './_components/AlertsPanel';
import { interventionKeys, newKeys } from './_lib/metrics';
import { BacklogPanel } from './_components/BacklogPanel';
import { OrderSearch } from './_components/OrderSearch';
import { PipelineHero } from './_components/PipelineHero';
import { LiveDot, staleNote } from './_components/primitives';
import { PriorityView } from './_components/PriorityView';
import { ReportView } from './_components/report/ReportView';
import { SettingsView } from './_components/SettingsView';
import { StuckPanel } from './_components/StuckPanel';
import { TeamPanel } from './_components/TeamPanel';
import { useLiveData } from './_components/useLiveData';
import { useUrlParam } from './_components/useUrlParam';
import { useChime, useTheme, useWakeLock } from './_components/useWallScreen';
import { LiveModeContext, type LiveScope } from './_components/LiveMode';

const FRESH_MS = 12_000;
const BASE_TITLE = 'مركز قيادة المستودع';

type View = 'live' | 'analytics' | 'priority' | 'settings';

type Confirm = { title: string; message: string; label: string; danger?: boolean; run: () => Promise<unknown> };

const clockFormat = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long' });

/**
 * One full-screen command centre for the warehouse: the prep board, the
 * shipping board and the stuck-orders monitor on a single live page.
 */
export default function LiveDashboardClient({ scope = 'full' }: { scope?: LiveScope }) {
  const { toast } = useToast();
  const full = scope === 'full';
  const [tvParam, setTvParam] = useUrlParam('tv');
  const kiosk = tvParam === '1';
  const theme = useTheme();
  const [cursorHidden, setCursorHidden] = useState(false);
  const [rawThreshold, setThresholdParam] = useUrlParam('t', String(DEFAULT_THRESHOLD_HOURS));
  const threshold = parseThreshold(rawThreshold);
  const setThreshold = (hours: number) => setThresholdParam(String(hours));
  const live = useLiveData(threshold, scope);
  const { board, shipping, stuck } = live;
  const [rawView, setViewParam] = useUrlParam('view', 'live');
  // TV mode is the live view only; shipping-only users have no settings to change.
  const view: View = kiosk ? 'live' : rawView === 'analytics' || ((rawView === 'settings' || rawView === 'priority') && full) ? rawView : 'live';
  const setView = (next: View) => setViewParam(next);
  const [openParam, setOpenParam] = useUrlParam('open');
  // The order journey reads the stuck-orders API, which needs prep-admin access.
  const openOrderId = full && openParam ? openParam.slice(0, 64) : null;
  const setOpenOrderId = useCallback((orderId: string | null) => setOpenParam(orderId), [setOpenParam]);
  const chime = useChime();
  const wake = useWakeLock();
  const [freshKeys, setFreshKeys] = useState<Set<string>>(() => new Set());
  const [unseen, setUnseen] = useState(0);
  const seenKeys = useRef<Set<string> | null>(null);
  const freshTimers = useRef(new Set<number>());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const [violation, setViolation] = useState<ViolationTarget | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  // New things needing a person since the last refresh: chime, highlight, and count in the tab title.
  const { play } = chime;
  useEffect(() => {
    if ((full && !board.data) || !shipping.data) return;
    const keys = interventionKeys(board.data, shipping.data);
    const previous = seenKeys.current;
    seenKeys.current = new Set(keys);
    const added = newKeys(previous, keys); // first load: nothing counts as new
    if (added.length === 0) return;
    play();
    setFreshKeys((current) => new Set([...current, ...added]));
    if (document.visibilityState !== 'visible' || !document.hasFocus()) setUnseen((count) => count + added.length);
    // Not cleared by the effect: the two feeds refresh separately, and the next
    // update must not cancel this one's fade-out. Cleared on unmount instead.
    const timer = window.setTimeout(() => {
      freshTimers.current.delete(timer);
      setFreshKeys((current) => {
        const next = new Set(current);
        for (const key of added) next.delete(key);
        return next;
      });
    }, FRESH_MS);
    freshTimers.current.add(timer);
  }, [full, board.data, shipping.data, play]);

  useEffect(() => {
    if (!kiosk) {
      setCursorHidden(false);
      return;
    }
    let timer = window.setTimeout(() => setCursorHidden(true), 3000);
    const onMove = () => {
      setCursorHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCursorHidden(true), 3000);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
    };
  }, [kiosk]);

  const enterKiosk = useCallback(() => {
    setTvParam('1');
    // Entering TV mode is a click, so the browser allows full screen here.
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, [setTvParam]);
  const exitKiosk = useCallback(() => setTvParam(null), [setTvParam]);

  useEffect(() => {
    const timers = freshTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) تنبيه جديد · ${BASE_TITLE}` : BASE_TITLE;
  }, [unseen]);

  useEffect(() => {
    const clear = () => setUnseen(0);
    window.addEventListener('focus', clear);
    window.addEventListener('pointerdown', clear);
    return () => {
      window.removeEventListener('focus', clear);
      window.removeEventListener('pointerdown', clear);
      document.title = BASE_TITLE;
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  // Keyboard: 1/2/3/4 switch views, R refresh, F full screen, M sound. "/" (search) lives in OrderSearch.
  const shortcuts = useRef<Record<string, () => void>>({});
  shortcuts.current = {
    '1': () => !kiosk && setView('live'),
    '2': () => !kiosk && setView('analytics'),
    '3': () => !kiosk && full && setView('settings'),
    '4': () => !kiosk && full && setView('priority'),
    r: () => void live.refreshAll(),
    f: toggleFullscreen,
    m: () => chime.setEnabled(!chime.enabled),
    t: theme.cycle,
    k: () => (kiosk ? exitKiosk() : enterKiosk()),
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      // Leave keys alone while a dialog or sheet is open.
      if (document.querySelector('[role="dialog"]')) return;
      // Match by physical key too, so shortcuts work with an Arabic keyboard layout.
      const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.code.startsWith('Digit') ? event.code.slice(5) : event.key.toLowerCase();
      const action = shortcuts.current[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** POST an action, toast the outcome, refresh what it touched. */
  const post = useCallback(
    async (key: string, url: string, body: unknown, success?: string, after: Array<() => Promise<void>> = [], method: 'POST' | 'DELETE' = 'POST') => {
      setBusy(key);
      try {
        const response =
          method === 'DELETE'
            ? await fetch(url, { method })
            : await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || data.message || 'تعذر تنفيذ الإجراء');
        toast({ description: data.message || success || 'تم' });
        await Promise.all(after.map((fn) => fn()));
        setSheetKey((value) => value + 1);
        return true;
      } catch (err) {
        toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  /** «طلب مميز»: flag puts the order first in the prep queue. */
  const onPriority = (item: StuckItem, flag: boolean) =>
    void (flag
      ? post(`priority:${item.orderId}`, '/api/order-prep/v2/priority', { orderId: item.orderId }, undefined, [live.loadBoard])
      : post(`priority:${item.orderId}`, `/api/order-prep/v2/priority?orderId=${encodeURIComponent(item.orderId)}`, null, undefined, [live.loadBoard], 'DELETE'));

  const onViolationSubmit = async (input: ViolationInput) => {
    const ok = await post('violation', '/api/user-recognition', { ...input, kind: 'PENALTY' }, `سُجّلت المخالفة على ${violation?.staff.name ?? 'المستخدم'}`);
    if (ok) setViolation(null);
  };

  const prepAction = (key: string, body: Record<string, unknown>, success: string) =>
    post(key, '/api/order-prep/v2/board/actions', body, success, [live.loadBoard, live.loadStuck]);
  const shipAction = (key: string, body: Record<string, unknown>) =>
    post(key, '/api/shipping-v2/board/actions', body, undefined, [live.loadShipping, live.loadStuck]);

  const onAlert = (action: AlertAction) => {
    const key = `${action.type}:${action.item.id}`;
    const number = `#${action.item.orderNumber ?? action.item.orderId}`;
    switch (action.type) {
      case 'requeue':
        return void prepAction(key, { action: 'requeue_escalation', escalationId: action.item.id }, 'أُعيد الطلب للتجهيز');
      case 'retry_sync':
        return void prepAction(key, { action: 'retry_sync', jobId: action.item.id }, 'تمت المزامنة');
      case 'retry_task':
        return void shipAction(key, { action: 'retry', taskId: action.item.id });
      case 'refunded':
        return setConfirm({
          title: `تم إرجاع المبلغ — ${number}`,
          message: 'يُغلق الاستثناء ويُسجَّل أن المبلغ أُرجع للعميل.',
          label: 'تأكيد الإرجاع',
          run: () => prepAction(key, { action: 'resolve_escalation', escalationId: action.item.id, resolution: 'refunded' }, 'سُجّل الإرجاع'),
        });
      case 'handled':
        return setConfirm({
          title: `عولج خارج التجهيز — ${number}`,
          message: 'يُغلق الاستثناء دون إعادة الطلب للتجهيز.',
          label: 'إغلاق الاستثناء',
          danger: true,
          run: () => prepAction(key, { action: 'resolve_escalation', escalationId: action.item.id, resolution: 'handled' }, 'أُغلق الاستثناء'),
        });
      case 'dismiss_sync':
        return setConfirm({
          title: `إخفاء تحديث سلة — ${number}`,
          message: 'لن نحاول تحديث سلة مرة أخرى لهذه العملية.',
          label: 'إخفاء',
          danger: true,
          run: () => prepAction(key, { action: 'dismiss_sync', jobId: action.item.id }, 'أُخفي'),
        });
      case 'close_task':
        return setConfirm({
          title: `إغلاق مهمة الشحن — ${number}`,
          message: action.item.hasSallaShipment
            ? 'تُغلق مهمة الشحن. للطلب بوليصة في سلة — ألغها من سلة إن لزم.'
            : 'تُغلق مهمة الشحن (عولجت يدوياً أو أُلغي الطلب).',
          label: 'تمت المعالجة',
          danger: true,
          run: () => shipAction(key, { action: 'close', taskId: action.item.id }),
        });
    }
  };

  const onRelease = (packer: BoardPacker) =>
    setConfirm({
      title: `إرجاع طلبات ${packer.name}`,
      message: 'يُعاد طلبه الحالي والتالي إلى طابور التجهيز ليأخذهما مجهِّز آخر.',
      label: 'إرجاع للقائمة',
      danger: true,
      run: () => prepAction(`release-${packer.userId}`, { action: 'release_packer', userId: packer.userId }, 'أُعيدت الطلبات للقائمة'),
    });

  const onStuckAction = (item: StuckItem, target: ActionTarget) => {
    const meta = ACTION_META[target.action];
    setConfirm({
      title: `${meta.label} — #${item.orderNumber ?? item.orderId}`,
      message: meta.confirm,
      label: meta.label,
      danger: meta.danger,
      run: () => post('stuck', '/api/admin/stuck-orders/actions', target, undefined, [live.loadStuck, live.loadBoard, live.loadShipping]),
    });
  };

  const savePrep = (settings: Partial<PrepSettings>) => prepAction('settings', { action: 'save_settings', settings }, 'حُفظت الإعدادات');
  const shippingSetting = (patch: Partial<ShippingBoardData['settings']>) =>
    void post('ship-settings', '/api/shipping-v2/board/actions', { action: 'settings', settings: patch }, undefined, [live.loadShipping]);

  const ageSeconds = now && live.lastAt ? Math.max(0, Math.round((now - live.lastAt) / 1000)) : null;
  const failedSources = (full ? [board, shipping, stuck, live.hourly] : [shipping, live.hourly]).filter((source) => source.error).length;
  const healthy = failedSources === 0 && ageSeconds !== null && ageSeconds < 60;
  const boardStale = staleNote(board);
  const shippingStale = staleNote(shipping);

  const stuckCritical = stuck.data ? Object.values(stuck.data.counts).reduce((sum, summary) => sum + (summary?.critical ?? 0), 0) : 0;
  const allPills = [
    { label: 'عالقة', value: stuck.data ? stuck.data.items.length - stuck.data.heldCount : null, hot: stuckCritical > 0 },
    { label: 'استثناءات', value: board.data?.exceptions.length ?? null, hot: false },
    { label: 'مزامنة معلّقة', value: board.data?.pendingSync.count ?? null, hot: (board.data?.pendingSync.count ?? 0) > 20 },
    {
      label: 'أعطال شحن',
      value: shipping.data ? (shipping.data.byState.failed ?? 0) + (shipping.data.byState.blocked ?? 0) : null,
      hot: shipping.data ? (shipping.data.byState.failed ?? 0) + (shipping.data.byState.blocked ?? 0) > 0 : false,
    },
  ];

  const pills = full ? allPills : allPills.filter((pill) => pill.label === 'أعطال شحن');

  const VIEWS_ALL: Array<{ key: View; label: string; Icon: typeof Activity; shortcut: string }> = [
    { key: 'live', label: 'مباشر', Icon: Activity, shortcut: '1' },
    { key: 'analytics', label: 'التحليلات', Icon: BarChart3, shortcut: '2' },
    { key: 'priority', label: 'الأولويات', Icon: ListOrdered, shortcut: '4' },
    { key: 'settings', label: 'الإعدادات', Icon: Settings2, shortcut: '3' },
  ];
  const VIEWS = full ? VIEWS_ALL : VIEWS_ALL.filter((entry) => entry.key !== 'settings' && entry.key !== 'priority');

  const onBulkRetry = (kind: 'sync' | 'shipping', count: number) =>
    setConfirm(
      kind === 'sync'
        ? {
            title: `إعادة كل تحديثات سلة الفاشلة (${count})`,
            message: `نحاول تحديث حالة كل طلب في سلة من جديد، واحداً بعد الآخر (حتى 30 في المرة). التعارضات لا تُمس: تحتاج قراراً لكل طلب.`,
            label: 'أعد المحاولة للكل',
            run: () => post('bulk:sync', '/api/order-prep/v2/board/actions', { action: 'retry_all_sync' }, undefined, [live.loadBoard, live.loadStuck]),
          }
        : {
            title: `إعادة كل مهام الشحن الفاشلة (${count})`,
            message: 'تعود كل مهمة شحن فاشلة لمحطة الشحن لتُنشأ شحنتها من جديد (حتى 100 في المرة). المهام الموقوفة لا تُمس: تنتظر إصلاحاً يدوياً.',
            label: 'أعد المحاولة للكل',
            run: () => post('bulk:shipping', '/api/shipping-v2/board/actions', { action: 'retry_all' }, undefined, [live.loadShipping, live.loadStuck]),
          },
    );

  const ThemeIcon = theme.mode === 'auto' ? SunMoon : theme.mode === 'dark' ? Moon : Sun;
  const themeLabel = theme.mode === 'auto' ? 'المظهر: تلقائي (داكن من 6م إلى 6ص) (T)' : theme.mode === 'dark' ? 'المظهر: داكن (T)' : 'المظهر: فاتح (T)';

  return (
    <LiveModeContext.Provider value={{ kiosk, scope }}>
    <div
      data-theme={theme.resolved}
      className={cn(styles.root, kiosk && styles.kiosk, kiosk && cursorHidden && styles.cursorHidden, 'flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden')}
    >
      {/* Top bar */}
      <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-3 bg-[#1f1912] px-4 py-2.5 text-white shadow-lg xl:flex-nowrap xl:px-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl bg-white/90 object-contain p-1" />
          <div className="leading-tight">
            <h1 className="text-base font-black tracking-tight">{full ? 'مركز قيادة المستودع' : 'مركز قيادة الشحن'}</h1>
            <p className="flex items-center gap-1.5 text-[11px] text-white/60">
              <LiveDot ok={healthy} />
              {failedSources > 0 ? (
                <span className="text-amber-300">
                  تعذر تحديث {failedSources === 1 ? 'مصدر واحد' : `${failedSources} مصادر`} · نعيد المحاولة
                </span>
              ) : ageSeconds === null ? (
                'جارٍ التحميل…'
              ) : (
                `مباشر · آخر تحديث قبل ${ageSeconds} ث`
              )}
            </p>
          </div>
        </div>

        {!kiosk && (
        <nav className="flex rounded-xl bg-white/[0.07] p-1 ring-1 ring-white/10">
          {VIEWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setView(entry.key)}
              title={`${entry.label} (${entry.shortcut})`}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition',
                view === entry.key ? 'bg-[#e8c896] text-[#1f1912] shadow' : 'text-white/70 hover:text-white',
              )}
            >
              <entry.Icon className="h-3.5 w-3.5" /> {entry.label}
            </button>
          ))}
        </nav>
        )}

        {/* Search reads the stuck-orders API (prep admins); TV mode shows the pills in its place. */}
        {full && !kiosk ? (
          <div className="order-last w-full xl:order-none xl:w-auto xl:flex-1">
            <OrderSearch threshold={threshold} onOpen={setOpenOrderId} />
          </div>
        ) : (
          <div className="hidden xl:block xl:flex-1" />
        )}

        <div className={cn('hidden items-center gap-1.5', kiosk || !full ? 'lg:flex' : '2xl:flex')}>
          {pills.map((pill) => (
            <span
              key={pill.label}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1',
                pill.hot ? cn('bg-rose-500/20 text-rose-100 ring-rose-400/40', styles.breathe) : 'bg-white/[0.06] text-white/70 ring-white/10',
              )}
            >
              {pill.label}
              <span className="text-sm font-black tabular-nums text-white">{pill.value ?? '—'}</span>
            </span>
          ))}
        </div>

        <div className="mr-auto flex items-center gap-3 xl:mr-0">
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-lg font-black tabular-nums" suppressHydrationWarning>
              {now ? clockFormat.format(now) : '—'}
            </p>
            <p className="text-[10px] text-white/50" suppressHydrationWarning>
              {now ? dateFormat.format(now) : ''}
            </p>
          </div>
          {kiosk ? (
            <div className="flex items-center gap-1">
              <IconButton label={themeLabel} onClick={theme.cycle}>
                <ThemeIcon className="h-4 w-4" />
              </IconButton>
              <button
                type="button"
                onClick={exitKiosk}
                title="خروج من وضع الشاشة (K)"
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white/70 ring-1 ring-white/15 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" /> خروج
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-1">
            <IconButton label={themeLabel} onClick={theme.cycle} active={theme.mode !== 'light'}>
              <ThemeIcon className="h-4 w-4" />
            </IconButton>
            <IconButton label="وضع الشاشة: للعرض فقط، أكبر، والقوائم تتمرر وحدها (K)" onClick={enterKiosk}>
              <Tv className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={chime.enabled ? (chime.unlocked ? 'صوت التنبيهات مفعّل (M)' : 'صوت التنبيهات: اضغط في أي مكان لتفعيله (M)') : 'صوت التنبيهات متوقف (M)'}
              onClick={() => chime.setEnabled(!chime.enabled)}
              active={chime.enabled && chime.unlocked}
            >
              {chime.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </IconButton>
            {wake.supported && (
              <IconButton
                label={wake.enabled ? (wake.active ? 'الشاشة لن تنطفئ' : 'إبقاء الشاشة مضاءة (بانتظار المتصفح)') : 'الشاشة قد تنطفئ'}
                onClick={() => wake.setEnabled(!wake.enabled)}
                active={wake.active}
              >
                {wake.enabled ? <MonitorCheck className="h-4 w-4" /> : <MonitorOff className="h-4 w-4" />}
              </IconButton>
            )}
            <IconButton label="تحديث الكل (R)" onClick={() => void live.refreshAll()}>
              {live.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </IconButton>
            <IconButton label={fullscreen ? 'خروج من ملء الشاشة (F)' : 'ملء الشاشة (F)'} onClick={toggleFullscreen}>
              {fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            </IconButton>
            <Link href="/" aria-label="الرئيسية" title="الرئيسية" className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <House className="h-4 w-4" />
            </Link>
          </div>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 xl:px-6">
        {view === 'live' && (
          <>
            <PipelineHero
              board={board.data}
              shipping={shipping.data}
              history={live.history}
              stale={full ? staleNote(board, shipping) : shippingStale}
              hourly={live.hourly.data}
              hourlyError={live.hourly.error}
            />
            {!full ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="h-[520px] xl:h-auto">
                  <TeamPanel board={null} shipping={shipping.data} busy={busy} onRelease={onRelease} delay={200} stale={shippingStale} />
                </div>
                <div className="h-[520px] xl:h-auto">
                  <AlertsPanel
                    board={null}
                    shipping={shipping.data}
                    busy={busy}
                    onAction={onAlert}
                    onOpenOrder={setOpenOrderId}
                    delay={260}
                    freshKeys={freshKeys}
                    stale={shippingStale}
                    onBulkRetry={onBulkRetry}
                  />
                </div>
                <div className="h-[520px] md:col-span-2 xl:col-span-1 xl:h-auto">
                  <BacklogPanel board={null} shipping={shipping.data} delay={320} stale={shippingStale} />
                </div>
              </div>
            ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:grid-rows-2 2xl:grid-cols-4 2xl:grid-rows-1">
              <div className="h-[520px] xl:col-start-1 xl:row-start-1 xl:h-auto 2xl:col-start-1">
                <TeamPanel board={board.data} shipping={shipping.data} busy={busy} onRelease={onRelease} delay={200} stale={boardStale ?? shippingStale} />
              </div>
              <div className="h-[520px] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:h-auto 2xl:row-span-1">
                <AlertsPanel
                  board={board.data}
                  shipping={shipping.data}
                  busy={busy}
                  onAction={onAlert}
                  onOpenOrder={setOpenOrderId}
                  delay={260}
                  freshKeys={freshKeys}
                  stale={staleNote(board, shipping)}
                  onBulkRetry={onBulkRetry}
                />
              </div>
              <div className="h-[520px] xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:h-auto 2xl:row-span-1">
                <StuckPanel
                  result={stuck.data}
                  threshold={threshold}
                  onThreshold={setThreshold}
                  busy={busy !== null}
                  onOpen={setOpenOrderId}
                  onAction={onStuckAction}
                  delay={320}
                  stale={staleNote(stuck)}
                />
              </div>
              <div className="h-[520px] xl:col-start-1 xl:row-start-2 xl:h-auto 2xl:col-start-4 2xl:row-start-1">
                <BacklogPanel board={board.data} shipping={shipping.data} delay={380} stale={shippingStale ?? boardStale} />
              </div>
            </div>
            )}
          </>
        )}

        {view === 'analytics' &&
          (full ? (
            <ReportView shipping={shipping.data} />
          ) : (
            <div className={cn('min-h-0 flex-1 overflow-y-auto pb-4', styles.scroll)}>
              <AnalyticsSection kind="shipping" />
            </div>
          ))}

        {view === 'priority' && <PriorityView />}

        {view === 'settings' && (
          <SettingsView
            board={board.data}
            shipping={shipping.data}
            canManageShipping={live.canManageShipping}
            busy={busy}
            onSavePrep={savePrep}
            onShippingSetting={shippingSetting}
          />
        )}
      </main>

      {full && (
      <OrderJourneySheet
        orderId={openOrderId}
        threshold={threshold}
        refreshKey={sheetKey}
        busy={busy !== null}
        onClose={() => setOpenOrderId(null)}
        onAction={onStuckAction}
        onPriority={onPriority}
        onViolation={(staff: JourneyStaff, orderNumber: string) => setViolation({ staff, orderNumber })}
        onCopy={(text) =>
          void navigator.clipboard?.writeText(text).then(
            () => toast({ description: `نُسخ ${text}` }),
            () => undefined,
          )
        }
      />
      )}

      <ViolationDialog
        target={violation}
        busy={busy === 'violation'}
        onCancel={() => setViolation(null)}
        onSubmit={(input) => void onViolationSubmit(input)}
      />

      <ConfirmationDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label ?? 'تأكيد'}
        confirmVariant={confirm?.danger ? 'danger' : 'primary'}
        onConfirm={() => {
          const current = confirm;
          setConfirm(null);
          if (current) void current.run();
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
    </LiveModeContext.Provider>
  );
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-lg p-2 transition hover:bg-white/10 hover:text-white', active ? 'text-[#e8c896]' : 'text-white/70')}
    >
      {children}
    </button>
  );
}
