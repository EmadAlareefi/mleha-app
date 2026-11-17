'use client';

import { ManageFlow } from '@/components/returns/flow/ManageFlow';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { typeLabel } from '@/app/lib/returns/status';
import type { PublicPiece } from '@/app/lib/returns/piece-context';
import type { ExchangeCartLine } from '@/components/returns/ExchangePicker';
import { customerStage, statusParts, type CustomerStage } from '@/lib/returns/customer-stage';
import { isInternationalOrder } from '@/lib/returns/order-country';
import { getItemAttributes } from '@/lib/returns/item-attributes';
import { AltDetailStep, AltListStep, type AltSuggestion } from '@/components/returns/flow/AltStep';
import { DoneStep, type CreatedReturn } from '@/components/returns/flow/DoneStep';
import { ItemsStep } from '@/components/returns/flow/ItemsStep';
import {
  buildPieceViews,
  computeMoney,
  itemDetails,
  itemImage,
  piecesFromOrder,
  reasonLabel,
  type ExchangeMode,
  type PieceState,
  type ReturnsOrder,
} from '@/components/returns/flow/model';
import { ReviewStep, SendFailedStep } from '@/components/returns/flow/ReviewStep';
import { formatMoney, ProdRow, RulesBlock, STORE_URL, useReturnsShell, whatsappLink } from '@/components/returns/flow/ui';

const MERCHANT = {
  merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876',
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر سلة',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0501234567',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'شارع الملك فهد، الرياض',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
};

type Screen = 'search' | 'blocked' | 'manage' | 'existing' | 'items' | 'alts' | 'alt' | 'review' | 'sendfail' | 'done';

interface Notice {
  title: string;
  text: string;
}

interface Blocked {
  title: string;
  lead: string;
  statusLabel?: string;
  cardTitle: string;
  cardText: string;
  manageOrder?: boolean;
}

interface ExistingReturn {
  id: string;
  type: string;
  status: string;
  smsaTrackingNumber?: string | null;
  totalRefundAmount?: number | string | null;
  couponAmount?: number | string | null;
  currency?: string | null;
  createdAt: string;
  statusUrl?: string | null;
  items: Array<{ id: string; productId?: string | null; productName: string; variantName?: string | null; quantity: number }>;
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: 'قيد المراجعة',
  approved: 'تمت الموافقة',
  shipped: 'في الطريق إلينا',
  delivered: 'وصلت للفحص',
  completed: 'مكتمل',
  rejected: 'لم يُقبل',
  cancelled: 'ملغى',
};

const toLatinDigits = (value: string) =>
  value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const validMobile = (value: string) => /^05\d{8}$/.test(value) || /^(?:\+|00)?9665\d{8}$/.test(value);

/** Order-level screens (40/41 and the waiting states), from the order's stage. */
function blockedForStage(stage: CustomerStage, status: unknown, prepStarted = false): Blocked {
  const { name } = statusParts(status);
  switch (stage) {
    case 'cancelled':
      return {
        title: 'هذا الطلب ملغى',
        lead: 'تم إلغاء الطلب مسبقًا، ولا توجد قطع متاحة للاستبدال أو الاسترجاع.',
        statusLabel: name || 'ملغى',
        cardTitle: 'هل هناك مبلغ مدفوع؟',
        cardText: 'إن لم يظهر المبلغ المسترد لديكِ، تواصلي معنا لمراجعة تفاصيل العملية.',
      };
    case 'editable':
      return {
        title: 'طلبك لم يُشحن بعد',
        lead: 'الاستبدال والاسترجاع متاحان بعد استلام الطلب.',
        statusLabel: name,
        cardTitle: 'ماذا يمكنك فعله؟',
        cardText:
          'يمكنك إلغاء الطلب أو تعديل المقاس أو المنتج خلال 3 ساعات من إنشائه وقبل بدء تجهيزه، بالتواصل مع خدمة العملاء. أو انتظري حتى استلامه ثم اطلبي الاستبدال أو الاسترجاع حسب الشروط.',
        manageOrder: true,
      };
    case 'waiting':
      return {
        title: 'طلبك لم يصل بعد',
        lead: 'الاستبدال والاسترجاع متاحان بعد وصول الطلب إليكِ.',
        statusLabel: name,
        cardTitle: 'ماذا يمكنك فعله؟',
        // A packer can pick a new order up within minutes, while Salla still
        // shows it as "طلب جديد" — say why it can no longer be changed.
        cardText: prepStarted
          ? 'بدأ فريقنا تجهيز طلبك، لذلك لم يعد بالإمكان إلغاؤه أو تعديله. بعد استلامه يمكنك طلب الاستبدال أو الاسترجاع حسب الشروط.'
          : 'طلبك قيد التجهيز أو في الطريق إليكِ، ولم يعد بالإمكان إلغاؤه أو تعديله. بعد استلامه يمكنك طلب الاستبدال أو الاسترجاع حسب الشروط.',
      };
    case 'returning':
      return {
        title: 'الطلب قيد الاسترجاع',
        lead: 'يوجد إجراء استرجاع جارٍ على هذا الطلب.',
        statusLabel: name,
        cardTitle: 'هل تحتاجين مساعدة؟',
        cardText: 'تواصلي معنا لمعرفة حالة الاسترجاع أو لأي استفسار عن طلبك.',
      };
    default:
      return {
        title: 'الطلب غير مؤهل للإرجاع حاليًا',
        lead: 'حالة الطلب الحالية لا تسمح بطلب استبدال أو استرجاع.',
        statusLabel: name,
        cardTitle: 'ماذا يمكنك فعله؟',
        cardText: 'إن كان لديكِ استفسار عن طلبك تواصلي معنا وسنساعدك.',
      };
  }
}

export default function ReturnsPage() {
  const { openHelp, toast, setOrderNumber: shareOrderNumber } = useReturnsShell();
  const [screen, setScreenState] = useState<Screen>('search');

  // search
  const [orderNumber, setOrderNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [searchErrors, setSearchErrors] = useState<{ order?: string; mobile?: string }>({});
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // order
  const [order, setOrder] = useState<ReturnsOrder | null>(null);
  const [pieces, setPieces] = useState<PublicPiece[] | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [existing, setExisting] = useState<ExistingReturn[]>([]);
  const [canCreateNew, setCanCreateNew] = useState(true);
  const [manualReview, setManualReview] = useState(false);

  // request being built
  const [states, setStates] = useState<Record<string, PieceState>>({});
  const [chosenMode, setMode] = useState<ExchangeMode>('order');
  const [exchangeOrdersEnabled, setExchangeOrdersEnabled] = useState<boolean | null>(null);
  const [cart, setCart] = useState<ExchangeCartLine[]>([]);
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ slug: string; label: string }>>([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [itemsNotice, setItemsNotice] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [checking, setChecking] = useState(false);
  const [created, setCreated] = useState<CreatedReturn | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const mode: ExchangeMode = exchangeOrdersEnabled ? chosenMode : 'coupon';

  /* ---------- navigation with the browser back button ---------- */
  const setScreen = useCallback((next: Screen, replace = false) => {
    setScreenState(next);
    try {
      if (replace) window.history.replaceState({ rf: next }, '');
      else window.history.pushState({ rf: next }, '');
    } catch {
      // History is a convenience only.
    }
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    try {
      window.history.replaceState({ rf: 'search' }, '');
    } catch {}
    const onPop = (event: PopStateEvent) => {
      const target = (event.state?.rf as Screen | undefined) ?? 'search';
      // Never step back into a finished or half-sent request.
      setScreenState((current) => (current === 'done' ? 'done' : target === 'sendfail' || target === 'done' ? 'review' : target));
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    fetch('/api/returns/exchange/config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setExchangeOrdersEnabled(data ? data.exchangeOrdersEnabled !== false : true))
      .catch(() => setExchangeOrdersEnabled(true));
  }, []);

  /* ---------- derived ---------- */
  const views = useMemo(() => (order ? buildPieceViews(order, pieces ?? piecesFromOrder(order)) : []), [order, pieces]);
  const chosen = useMemo(
    () =>
      views
        .filter((view) => states[view.key]?.selected && states[view.key]?.ribbonRemoved !== true)
        .map((view) => ({ view, state: states[view.key] })),
    [views, states],
  );
  const money = useMemo(
    () => (order ? computeMoney(order, chosen, mode, cart) : null),
    [order, chosen, mode, cart],
  );
  const displayOrderNumber = order?.reference_id || orderNumber;

  const suggestions: AltSuggestion[] = useMemo(() => {
    const list: AltSuggestion[] = [];
    for (const { view, state } of chosen) {
      if (state.type !== 'exchange' || list.some((entry) => entry.productId === view.piece.productId)) continue;
      const item = order?.items.find((entry) => String(entry.id) === view.piece.orderItemId);
      const { color, size } = getItemAttributes(item);
      list.push({
        productId: view.piece.productId,
        name: item?.name || item?.product?.name || view.name,
        imageUrl: itemImage(item),
        currentVariant: [size && `مقاس ${size}`, color && `لون ${color}`].filter(Boolean).join('، ') || item?.variant?.name || '',
      });
    }
    return list;
  }, [chosen, order]);
  const creditWho = useMemo(() => {
    const names = chosen.filter(({ state }) => state.type === 'exchange').map(({ view }) => [view.name, view.details].filter(Boolean).join(' · '));
    return names.length ? `يخص ${names.join('، ')}` : '';
  }, [chosen]);

  useEffect(() => {
    if (!money?.replacing || paymentMethods.length > 0) return;
    fetch(`/api/returns/exchange/payment-methods?merchantId=${encodeURIComponent(MERCHANT.merchantId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.methods) return;
        setPaymentMethods(data.methods);
        if (data.methods.length === 1) setPaymentMethod(data.methods[0].slug);
      })
      .catch(() => undefined);
  }, [money?.replacing, paymentMethods.length]);

  /* ---------- search (1-4) ---------- */
  const resetAll = () => {
    setOrder(null);
    setPieces(null);
    setBlocked(null);
    setExisting([]);
    setCanCreateNew(true);
    setManualReview(false);
    setStates({});
    setCart([]);
    setAgree(false);
    setSubmitError('');
    setCreated(null);
    setItemsNotice(null);
  };

  const runCheck = async (orderData: ReturnsOrder, normalizedMobile: string) => {
    let response: Response;
    let data: any;
    try {
      response = await fetch('/api/returns/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: MERCHANT.merchantId, orderId: String(orderData.id), customerMobile: normalizedMobile }),
      });
      data = await response.json();
    } catch {
      return { ok: false as const, manual: true };
    }
    if (!response.ok) {
      if (data?.errorCode === 'RETURN_PERIOD_EXPIRED') {
        const hours = Number(data.allowedHours);
        return {
          ok: false as const,
          blocked: {
            title: 'انتهت مدة الإرجاع',
            lead: data.message || data.error || 'انتهت المدة المسموحة للاستبدال أو الاسترجاع لهذا الطلب.',
            cardTitle: 'شروط المدة',
            cardText: hours
              ? `الحد الأقصى المسموح به هو ${hours === 24 ? '24 ساعة' : `${Math.floor(hours / 24)} أيام`} من وقت وصول الشحنة.`
              : 'الاسترجاع والاستبدال لفساتين السهرة خلال 24 ساعة، ولغيرها خلال 3 أيام من الاستلام.',
          } satisfies Blocked,
        };
      }
      if (data?.errorCode === 'DISCOUNTED_CATEGORY_NOT_RETURNABLE' || data?.errorCode === 'ORDER_ALREADY_EXCHANGED') {
        return {
          ok: false as const,
          blocked: {
            title: data.errorCode === 'ORDER_ALREADY_EXCHANGED' ? 'تم استبدال هذا الطلب مسبقًا' : 'الطلب غير مؤهل للإرجاع أو الاستبدال',
            lead: data.message || data.error,
            cardTitle: 'تعتقدين أن هناك خطأً؟',
            cardText: 'تواصلي معنا لمراجعة الطلب ومعرفة الخطوة التالية.',
          } satisfies Blocked,
        };
      }
      if (response.status === 403) return { ok: false as const, notFound: true };
      if (response.status === 429) return { ok: false as const, limited: String(data?.error || 'محاولات كثيرة، يرجى المحاولة بعد دقيقة') };
      return { ok: false as const, manual: true };
    }
    return { ok: true as const, data };
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedOrder = toLatinDigits(orderNumber).replace(/\D/g, '');
    const normalizedMobile = toLatinDigits(mobile).replace(/[^\d+]/g, '');
    const errors: { order?: string; mobile?: string } = {};
    if (!normalizedOrder) errors.order = 'رقم الطلب مطلوب. ستجدينه في رسالة تأكيد الطلب.';
    if (!validMobile(normalizedMobile)) errors.mobile = 'أدخلي رقم جوال صحيحًا مكوّنًا من 10 أرقام.';
    setSearchErrors(errors);
    if (errors.order || errors.mobile) return;

    setSearching(true);
    setNotice(null);
    resetAll();
    shareOrderNumber(normalizedOrder);
    const notFoundNotice: Notice = { title: 'لم نعثر على الطلب', text: 'راجعي رقم الطلب والجوال المستخدم عند الشراء، ثم حاولي مرة أخرى.' };
    try {
      // POST keeps the mobile and order number out of URLs and logs.
      const response = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: MERCHANT.merchantId, orderNumber: normalizedOrder, mobile: normalizedMobile }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          setNotice({ title: 'محاولات كثيرة', text: `${data.error || 'محاولات كثيرة، يرجى المحاولة لاحقًا'}. بياناتك لم تُرفض، فقط انتظري قليلًا ثم أعيدي المحاولة.` });
        } else if (response.status >= 500) {
          setNotice({ title: 'تعذر البحث عن الطلب', text: 'حدث خطأ مؤقت. حاولي مرة أخرى بعد قليل أو تواصلي معنا.' });
        } else {
          setNotice(notFoundNotice);
        }
        return;
      }
      const found = data.order as ReturnsOrder;
      setOrder(found);
      if (found.isInternational ?? isInternationalOrder(found)) {
        setBlocked({
          title: 'طلب دولي',
          lead: 'الطلبات الدولية خارج السعودية غير قابلة للإرجاع أو الاستبدال.',
          cardTitle: 'هل تحتاجين مساعدة؟',
          cardText: 'تواصلي معنا وسنساعدك بخصوص طلبك.',
        });
        setScreen('blocked');
        return;
      }

      const stage = customerStage({ status: found.status, placedAt: found.placedAt, prepStarted: found.prepStarted });
      const check = await runCheck(found, normalizedMobile);
      if (!check.ok && 'limited' in check && check.limited) {
        setOrder(null);
        setNotice({ title: 'محاولات كثيرة', text: `${check.limited}. بياناتك لم تُرفض، فقط انتظري قليلًا ثم أعيدي المحاولة.` });
        return;
      }
      // An open request comes first, whatever the order status now says
      // (sending one moves the order to "قيد الاسترجاع").
      if (check.ok && check.data.hasExistingReturns && (check.data.returns ?? []).length > 0) {
        setCanCreateNew(stage === 'returnable' && check.data.canCreateNew !== false);
        setPieces(Array.isArray(check.data.pieces) ? check.data.pieces : null);
        setExisting(check.data.returns as ExistingReturn[]);
        setScreen('existing');
        return;
      }
      // A new order in its first 3 hours: cancel or change it here (prototype 29–39).
      if (stage === 'editable' && found.manage && (found.manage.cancel || found.manage.swap || found.manage.items)) {
        setScreen('manage');
        return;
      }
      if (stage !== 'returnable') {
        setBlocked(blockedForStage(stage, found.status, Boolean(found.prepStarted)));
        setScreen('blocked');
        return;
      }
      if (!check.ok) {
        if ('notFound' in check && check.notFound) {
          setOrder(null);
          setNotice(notFoundNotice);
          return;
        }
        if ('blocked' in check && check.blocked) {
          setBlocked(check.blocked);
          setScreen('blocked');
          return;
        }
        setManualReview(true);
        setScreen('items');
        return;
      }
      setCanCreateNew(check.data.canCreateNew !== false);
      setPieces(Array.isArray(check.data.pieces) ? check.data.pieces : null);
      setScreen('items');
    } catch {
      setNotice({ title: 'تعذر البحث عن الطلب', text: 'تحققي من اتصالك بالإنترنت وحاولي مرة أخرى.' });
    } finally {
      setSearching(false);
    }
  };

  const backToSearch = () => {
    setScreen('search');
  };

  /* ---------- items (5-11) ---------- */
  const updatePiece = (key: string, next: Partial<PieceState>) => {
    setStates((previous) => {
      const view = views.find((entry) => entry.key === key);
      const base: PieceState = previous[key] ?? {
        selected: false,
        type: view?.piece.allowedTypes.includes('exchange') ? 'exchange' : 'return',
        reason: '',
        other: '',
      };
      return { ...previous, [key]: { ...base, ...next } };
    });
    setSubmitError('');
  };

  const afterItems = () => {
    if (money?.replacing) setScreen('alts');
    else {
      setCart([]);
      setScreen('review');
    }
  };

  /* ---------- submit (15-22) ---------- */
  const flowLabel = !money
    ? ''
    : money.hasExchange && money.hasReturn
      ? 'طلب مختلط'
      : money.hasReturn
        ? 'استرجاع'
        : money.replacing
          ? 'استبدال ببديل'
          : 'استبدال بكوبون';

  const buildReason = () => {
    const first = chosen[0]?.state;
    const lines = chosen
      .map(({ view, state }) => {
        const detail = state.reason === 'other' ? state.other.trim() : '';
        const label = reasonLabel(state.type, state.reason);
        return chosen.length > 1 || detail ? `${view.name}: ${label}${detail ? ` — ${detail}` : ''}` : '';
      })
      .filter(Boolean);
    const details = chosen.length > 1 ? lines.join('\n') : first?.reason === 'other' ? first.other.trim() : '';
    return { reason: first?.reason || 'other', reasonDetails: details || undefined };
  };

  const submit = async () => {
    if (!order || !money) return;
    // A second tap before React re-renders must not send a second request.
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitError('');
    setSubmitting(true);
    try {
      await sendRequest();
    } finally {
      submitLock.current = false;
    }
  };

  const sendRequest = async () => {
    if (!order || !money) return;
    const { reason, reasonDetails } = buildReason();
    let response: Response;
    try {
      response = await fetch('/api/returns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT.merchantId,
          orderId: String(order.id),
          reason,
          reasonDetails,
          pieces: chosen.map(({ view, state }) => ({
            orderItemId: view.piece.orderItemId,
            unitIndex: view.piece.unitIndex,
            type: state.type,
            ribbonRemoved: false,
          })),
          exchange: money.hasExchange
            ? {
                mode,
                lines: money.replacing ? cart.map((line) => ({ productId: line.productId, skuId: line.skuId, quantity: line.quantity })) : [],
                paymentMethod: money.replacing && money.settlement.needsPayment ? paymentMethod : undefined,
              }
            : undefined,
          customerMobile: toLatinDigits(mobile).replace(/[^\d+]/g, ''),
          merchantName: MERCHANT.name,
          merchantPhone: MERCHANT.phone,
          merchantAddress: MERCHANT.address,
          merchantCity: MERCHANT.city,
        }),
      });
    } catch {
      // The request may or may not have reached the server.
      setSubmitting(false);
      setScreen('sendfail');
      return;
    }
    const data = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok || !data) {
      if (!data || response.status >= 502) {
        setScreen('sendfail');
        return;
      }
      if (data.errorCode === 'EXCHANGE_ORDERS_DISABLED') {
        setExchangeOrdersEnabled(false);
        setCart([]);
      }
      setSubmitError(data.message || data.error || 'حدث خطأ غير متوقع، حاولي مرة أخرى.');
      return;
    }
    const createdRequest = data.returnRequest as CreatedReturn;
    const paymentUrl = createdRequest?.exchangeOrder?.paymentUrl;
    if (paymentUrl) {
      // Saved; the customer finishes paying the difference on Salla.
      setRedirecting(true);
      window.location.href = paymentUrl;
      return;
    }
    setCreated(createdRequest);
    setScreen('done', true);
  };

  const checkStatus = async () => {
    if (!order) return;
    setChecking(true);
    const result = await runCheck(order, toLatinDigits(mobile).replace(/[^\d+]/g, ''));
    setChecking(false);
    if (result.ok && result.data.hasExistingReturns && result.data.returns?.length) {
      const known = new Set(existing.map((entry) => entry.id));
      const fresh = (result.data.returns as ExistingReturn[]).filter((entry) => !known.has(entry.id));
      if (fresh.length) {
        setExisting(result.data.returns);
        setCanCreateNew(result.data.canCreateNew !== false);
        setPieces(Array.isArray(result.data.pieces) ? result.data.pieces : pieces);
        toast('تم التحقق: الطلب موجود');
        setScreen('existing', true);
        return;
      }
    }
    if (!result.ok && !('blocked' in result)) {
      toast('تعذر التحقق الآن، حاولي مرة أخرى');
      return;
    }
    toast('لم يُنشأ الطلب، يمكنك إعادة الإرسال');
    setScreen('review', true);
  };

  /* ---------- existing (28) ---------- */
  const cancelExisting = async (id: string) => {
    setCancellingId(id);
    try {
      const response = await fetch('/api/returns/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnRequestId: id, merchantId: MERCHANT.merchantId, customerMobile: toLatinDigits(mobile).replace(/[^\d+]/g, '') }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'تعذر إلغاء الطلب');
      toast('تم إلغاء الطلب');
      setItemsNotice('تم إلغاء طلبك السابق. يمكنك تقديم طلب جديد متى شئتِ.');
      // Re-read the pieces: the cancelled ones are free again.
      if (order) {
        const result = await runCheck(order, toLatinDigits(mobile).replace(/[^\d+]/g, ''));
        if (result.ok) {
          setPieces(Array.isArray(result.data.pieces) ? result.data.pieces : pieces);
          setCanCreateNew(result.data.canCreateNew !== false);
          const left = (result.data.returns ?? []) as ExistingReturn[];
          setExisting(left);
          if (!left.length) setScreen('items', true);
          return;
        }
      }
      setExisting((previous) => previous.filter((entry) => entry.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر إلغاء الطلب');
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  };

  /* ---------- render ---------- */
  if (screen === 'search' || !order) {
    return (
      <div className="pad">
        <h1>طلب إرجاع أو استبدال</h1>
        <p className="lead">أدخلي رقم الطلب ورقم الجوال للوصول إلى منتجات طلبك.</p>
        {notice && (
          <div className="banner" role="alert">
            <b>{notice.title}</b>
            <p>{notice.text}</p>
          </div>
        )}
        <form className="card" onSubmit={handleSearch} noValidate>
          <label className="f" htmlFor="rf-order">
            رقم الطلب
          </label>
          <input
            id="rf-order"
            className={`inp ${searchErrors.order ? 'err' : ''}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder={searchErrors.order ? 'أدخلي رقم الطلب' : 'مثال: 251263484'}
            value={orderNumber}
            disabled={searching}
            onChange={(event) => setOrderNumber(event.target.value)}
          />
          {searchErrors.order ? (
            <div className="err-t">{searchErrors.order}</div>
          ) : (
            <div className="help-t">يمكنك العثور على رقم الطلب في رسالة التأكيد المرسلة إليك عبر البريد الإلكتروني.</div>
          )}
          <label className="f" htmlFor="rf-mobile">
            رقم الجوال
          </label>
          <input
            id="rf-mobile"
            className={`inp ${searchErrors.mobile ? 'err' : ''}`}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="05XXXXXXXX"
            maxLength={14}
            value={mobile}
            disabled={searching}
            onChange={(event) => setMobile(event.target.value)}
          />
          {searchErrors.mobile ? (
            <div className="err-t">{searchErrors.mobile}</div>
          ) : (
            <div className="help-t">رقم الجوال المستخدم عند إنشاء الطلب، للتأكد من أن الطلب يخصك.</div>
          )}
          <button type="submit" className="btn" disabled={searching}>
            {searching ? (
              <>
                <span className="spin" />
                جارٍ البحث عن الطلب...
              </>
            ) : notice ? (
              'إعادة البحث عن الطلب ←'
            ) : (
              'البحث عن الطلب ←'
            )}
          </button>
        </form>
        {searching && (
          <>
            <div className="banner">
              <b>نبحث عن طلبك</b>
              <p>يرجى الانتظار قليلًا دون إعادة إرسال البيانات.</p>
            </div>
            <div className="prog">
              <i />
            </div>
          </>
        )}
        {notice && (
          <button type="button" className="link" onClick={openHelp}>
            ما زلتِ بحاجة للمساعدة؟ تواصلي معنا.
          </button>
        )}
        <RulesBlock />
      </div>
    );
  }

  if (screen === 'manage' && order?.manage) {
    return (
      <ManageFlow
        order={order}
        mobile={toLatinDigits(mobile).replace(/[^\d+]/g, '')}
        merchantId={MERCHANT.merchantId}
        verdicts={order.manage}
        onBack={backToSearch}
      />
    );
  }

  if (screen === 'blocked' && blocked) {
    return (
      <div className="pad">
        <h1>{blocked.title}</h1>
        <p className="lead">{blocked.lead}</p>
        <div className="banner">
          <div className="row">
            <span>رقم الطلب</span>
            <span className="v">{displayOrderNumber}</span>
          </div>
          {blocked.statusLabel && (
            <div className="row" style={{ margin: 0 }}>
              <span>حالة الطلب</span>
              <span className="v" style={{ color: 'var(--brand)' }}>
                {blocked.statusLabel}
              </span>
            </div>
          )}
        </div>
        <div className="card">
          <div className="sect">{blocked.cardTitle}</div>
          <p className="lead" style={{ margin: '8px 0 0' }}>
            {blocked.cardText}
          </p>
        </div>
        {blocked.manageOrder && (
          <a
            className="btn"
            href={whatsappLink(displayOrderNumber, `مرحبًا، أرغب بإلغاء أو تعديل طلبي رقم ${displayOrderNumber}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            إلغاء أو تعديل الطلب عبر واتساب
          </a>
        )}
        <button type="button" className={`btn ${blocked.manageOrder ? 'ghost' : ''}`} onClick={openHelp}>
          التواصل مع خدمة العملاء
        </button>
        <button type="button" className="link" onClick={backToSearch}>
          الرجوع إلى البحث عن الطلب
        </button>
      </div>
    );
  }

  if (screen === 'existing') {
    return (
      <div className="pad">
        <h1>يوجد طلب قيد المعالجة</h1>
        <p className="lead">{existing.length > 1 ? 'هذا الطلب مرتبط بطلبات سابقة.' : 'هذا الطلب مرتبط بطلب سابق.'}</p>
        {existing.map((entry) => {
          const cancellable = ['pending_review', 'approved'].includes(entry.status);
          const refund = entry.type !== 'exchange' ? Number(entry.totalRefundAmount) : 0;
          const credit = entry.type === 'return' ? 0 : Number(entry.couponAmount ?? (entry.type === 'exchange' ? entry.totalRefundAmount : 0));
          return (
            <div key={entry.id} style={{ marginBottom: 18 }}>
              <div className="banner">
                <div className="row">
                  <span>نوع الطلب</span>
                  <span className="v">طلب {typeLabel(entry.type)}</span>
                </div>
                <div className="row">
                  <span>رقم الطلب الأصلي</span>
                  <span className="v">{displayOrderNumber}</span>
                </div>
                <div className="row" style={{ margin: 0 }}>
                  <span>الحالة</span>
                  <span className="v" style={{ color: 'var(--brand)' }}>
                    {STATUS_LABELS[entry.status] || entry.status}
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="sect brand">{entry.items.length > 1 ? 'القطع المرتبطة بالطلب' : 'القطعة المرتبطة بالطلب'}</div>
                {entry.items.map((item) => {
                  const orderItem = order.items.find(
                    (line) => String(line.product?.id ?? line.product_id ?? line.productId ?? '') === String(item.productId ?? '-'),
                  );
                  return (
                    <div key={item.id} style={{ marginBottom: 10 }}>
                      <ProdRow
                        name={item.productName}
                        imageUrl={itemImage(orderItem)}
                        details={[item.variantName || itemDetails(orderItem), item.quantity > 1 ? `الكمية: ${item.quantity}` : ''].filter(Boolean).join(' · ')}
                      />
                    </div>
                  );
                })}
                {entry.smsaTrackingNumber && (
                  <div className="row">
                    <span className="k">رقم تتبع الشحنة</span>
                    <span className="v" style={{ direction: 'ltr' }}>
                      {entry.smsaTrackingNumber}
                    </span>
                  </div>
                )}
                {refund > 0 && (
                  <div className="row">
                    <span className="k">المبلغ المتوقع للاسترداد</span>
                    <span className="v">{formatMoney(refund, entry.currency)}</span>
                  </div>
                )}
                {credit > 0 && (
                  <div className="row">
                    <span className="k">رصيد الاستبدال</span>
                    <span className="v">{formatMoney(credit, entry.currency)}</span>
                  </div>
                )}
              </div>
              {entry.statusUrl && (
                <a className="btn" href={entry.statusUrl}>
                  متابعة الطلب الحالي
                </a>
              )}
              {cancellable &&
                (confirmCancelId === entry.id ? (
                  <>
                    <div className="warn">هل تريدين إلغاء هذا الطلب؟ لا يمكن التراجع عن الإلغاء.</div>
                    <button type="button" className="btn" disabled={cancellingId === entry.id} onClick={() => cancelExisting(entry.id)}>
                      {cancellingId === entry.id && <span className="spin" />}
                      تأكيد إلغاء الطلب
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setConfirmCancelId(null)}>
                      تراجع
                    </button>
                  </>
                ) : (
                  <button type="button" className="link" onClick={() => setConfirmCancelId(entry.id)}>
                    إلغاء هذا الطلب
                  </button>
                ))}
            </div>
          );
        })}
        <div className="banner">
          <b>لا تحتاجين إلى إنشاء طلب آخر</b>
          <p>
            {existing.length > 1 || existing.some((entry) => entry.items.length > 1)
              ? 'تابعي الطلبات الحالية لهذه القطع.'
              : 'تابعي الطلب الحالي لهذه القطعة.'}
            {canCreateNew ? ' يمكنك العودة واختيار قطعة أخرى غير مرتبطة بطلب قائم.' : ''}
          </p>
        </div>
        {canCreateNew && (
          <button type="button" className="btn ghost" onClick={() => setScreen('items')}>
            اختيار قطعة أخرى
          </button>
        )}
        <button type="button" className="link" onClick={backToSearch}>
          الرجوع إلى البحث عن الطلب
        </button>
      </div>
    );
  }

  if (!money) return null;

  if (screen === 'items') {
    return (
      <ItemsStep
        orderNumber={displayOrderNumber}
        views={views}
        states={states}
        onPiece={updatePiece}
        mode={mode}
        onMode={setMode}
        exchangeOrdersEnabled={exchangeOrdersEnabled}
        money={money}
        manualReview={manualReview}
        notice={itemsNotice}
        feeError={order.returnFeeQuoteError}
        onNext={afterItems}
        onBack={backToSearch}
      />
    );
  }

  if (screen === 'alts') {
    return (
      <AltListStep
        merchantId={MERCHANT.merchantId}
        money={money}
        who={creditWho}
        suggestions={suggestions}
        cart={cart}
        onCart={setCart}
        onOpen={(productId) => {
          setOpenProductId(productId);
          setScreen('alt');
        }}
        onUseCoupon={() => {
          setMode('coupon');
          setCart([]);
          toast('تم اختيار الكوبون');
          setScreen('items');
        }}
        onNext={() => setScreen('review')}
        onBack={() => setScreen('items')}
      />
    );
  }

  if (screen === 'alt' && openProductId) {
    return (
      <AltDetailStep
        key={openProductId}
        merchantId={MERCHANT.merchantId}
        productId={openProductId}
        money={money}
        who={creditWho}
        cart={cart}
        onAdd={(line) => {
          setCart((previous) => {
            const found = previous.find((entry) => entry.skuId === line.skuId);
            if (found) {
              return previous.map((entry) =>
                entry.skuId === line.skuId ? { ...entry, quantity: Math.min(entry.quantity + line.quantity, entry.maxQuantity) } : entry,
              );
            }
            return [...previous, line];
          });
          setScreen('review');
        }}
        onBack={() => setScreen('alts')}
      />
    );
  }

  if (screen === 'review') {
    return (
      <ReviewStep
        orderNumber={displayOrderNumber}
        mobile={toLatinDigits(mobile)}
        chosen={chosen}
        cart={cart}
        money={money}
        paymentMethods={paymentMethods}
        paymentMethod={paymentMethod}
        onPaymentMethod={setPaymentMethod}
        agree={agree}
        onAgree={setAgree}
        submitting={submitting}
        redirecting={redirecting}
        error={submitError}
        onSubmit={submit}
        onEdit={() => setScreen('items')}
        onEditAlt={() => setScreen('alts')}
      />
    );
  }

  if (screen === 'sendfail') {
    return (
      <SendFailedStep
        orderNumber={displayOrderNumber}
        money={money}
        flowLabel={flowLabel}
        checking={checking}
        onCheck={checkStatus}
        onBack={() => setScreen('review')}
        onHelp={openHelp}
      />
    );
  }

  if (screen === 'done' && created) {
    return <DoneStep request={created} />;
  }

  return (
    <div className="pad">
      <h1>حدث خطأ</h1>
      <p className="lead">ارجعي إلى البحث عن الطلب وحاولي مرة أخرى.</p>
      <button type="button" className="btn" onClick={backToSearch}>
        الرجوع إلى البحث عن الطلب
      </button>
      <a className="btn ghost" href={STORE_URL}>
        العودة إلى المتجر
      </a>
    </div>
  );
}
