'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogProduct, CatalogProductSummary, CatalogSku } from '@/app/lib/returns/exchange-catalog';
import { getItemAttributes } from '@/lib/returns/item-attributes';
import { buildPieceViews, orderCurrency, piecesFromOrder, type OrderItem, type PieceView, type ReturnsOrder } from './model';
import { CalcBox, HelpButton, ProdRow, STORE_URL, StepsBar, Thumb, Timeline, formatMoney, maskPhone, type Calc, type CalcRow } from './ui';

/**
 * Cancel or change a new order in its first 3 hours, one piece at a time
 * (returns prototype screens 29–39). The server re-checks everything at
 * submit under the order-prep claim lock; this screen only collects choices.
 */

export interface ManageVerdicts {
  cancel: boolean;
  swap: boolean;
  items: boolean;
  reason: string | null;
}

type Action = 'cancel' | 'size' | 'product';
type Step = 'items' | 'size' | 'product' | 'review' | 'code' | 'pay' | 'track' | 'result';

interface Choice {
  selected: boolean;
  action: Action;
  reason: string;
  other: string;
  /** size: the new variant of the same product. */
  sizeSku?: CatalogSku;
  sizeName?: string;
  /** product: the new product and variant. */
  product?: CatalogProduct;
  productSku?: CatalogSku;
}

interface ChangeStatus {
  id: string;
  serviceNumber: string;
  kind: string;
  state: string;
  refundStatus: string;
  refundAmount: number | null;
  paymentStatus: string | null;
  paymentUrl: string | null;
  paymentExpiresAt: string | null;
  amountDelta: number | null;
}

const TYPE_NAME: Record<Action, string> = { cancel: 'إلغاء', size: 'تغيير المقاس', product: 'تغيير المنتج' };
const REASONS: Record<Action, string[]> = {
  cancel: ['غيّرت رأيي', 'وجدت سعرًا أفضل', 'طلبت بالخطأ', 'تأخر الشحن', 'سبب آخر'],
  size: ['المقاس غير مناسب', 'أرغب بمقاس مختلف', 'سبب آخر'],
  product: ['أرغب بمنتج آخر', 'اللون مختلف عن توقعي', 'سبب آخر'],
};
const API = '/api/public/order-manage';
const GENERIC = 'حدث خطأ، يرجى المحاولة مرة أخرى.';

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data: data as Record<string, any> };
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`.padEnd(20, '0');

function skuName(product: CatalogProduct, sku: CatalogSku) {
  return product.options
    .map((option) => option.values.find((v) => sku.optionValueIds.includes(v.id))?.name)
    .filter(Boolean)
    .join(' / ');
}

function lineOf(order: ReturnsOrder, view: PieceView): OrderItem | undefined {
  return order.items.find((item) => String(item.id) === view.piece.orderItemId);
}

/** Option value ids on an order line as Salla returns them. */
function lineValueIds(item: OrderItem | undefined): string[] {
  const options = (item as unknown as { options?: Array<{ value?: { id?: unknown } }> })?.options;
  return Array.isArray(options) ? options.map((o) => o?.value?.id).filter((id) => id !== undefined && id !== null).map(String) : [];
}

function useProduct(merchantId: string, productId: string | undefined) {
  const [state, setState] = useState<{ product: CatalogProduct | null; loading: boolean; error: string }>({ product: null, loading: false, error: '' });
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setState({ product: null, loading: true, error: '' });
    fetch(`/api/returns/exchange/product/${productId}?merchantId=${encodeURIComponent(merchantId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل المنتج');
        if (!cancelled) setState({ product: data.product, loading: false, error: '' });
      })
      .catch((error) => !cancelled && setState({ product: null, loading: false, error: error instanceof Error ? error.message : 'تعذر تحميل المنتج' }));
    return () => {
      cancelled = true;
    };
  }, [merchantId, productId]);
  return state;
}

/* ---------------- size buttons ---------------- */

function SkuButtons({
  product,
  chosen,
  current,
  onPick,
}: {
  product: CatalogProduct;
  chosen?: CatalogSku;
  current?: string[];
  onPick: (sku: CatalogSku) => void;
}) {
  return (
    <div className="sizes" style={{ flexWrap: 'wrap' }}>
      {product.skus.map((sku) => {
        const isCurrent = Boolean(current?.length) && sku.optionValueIds.every((id) => current!.includes(id));
        const off = !sku.inStock || isCurrent;
        return (
          <button
            key={sku.id}
            type="button"
            className={`${off ? 'off' : ''} ${chosen?.id === sku.id ? 'on' : ''}`}
            disabled={off}
            onClick={() => onPick(sku)}
            title={isCurrent ? 'المقاس الحالي' : !sku.inStock ? 'غير متوفر حاليًا' : undefined}
          >
            {skuName(product, sku) || '—'}
          </button>
        );
      })}
    </div>
  );
}

function SizeCard({
  merchantId,
  view,
  item,
  choice,
  currency,
  onChange,
}: {
  merchantId: string;
  view: PieceView;
  item: OrderItem | undefined;
  choice: Choice;
  currency: string;
  onChange: (next: Partial<Choice>) => void;
}) {
  const productId = view.piece.productId;
  const { product, loading, error } = useProduct(merchantId, productId);
  const current = lineValueIds(item);
  const { size } = getItemAttributes(item as Parameters<typeof getItemAttributes>[0]);
  const unavailable = product?.skus.filter((sku) => !sku.inStock).length;
  return (
    <div className="card">
      <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
      <label className="f" style={{ marginTop: 14 }}>
        اختاري المقاس الجديد
      </label>
      {loading && <div className="tiny">جارٍ تحميل المقاسات...</div>}
      {error && <div className="err-t">{error}</div>}
      {product && <SkuButtons product={product} chosen={choice.sizeSku} current={current} onPick={(sku) => onChange({ sizeSku: sku, sizeName: skuName(product, sku) })} />}
      <div className="tiny">
        المقاس الحالي: {size || '—'}
        {unavailable ? ' · المقاسات المشطوبة غير متوفرة حاليًا' : ''}
      </div>
    </div>
  );
}

function ProductCard({
  merchantId,
  view,
  choice,
  currency,
  onChange,
}: {
  merchantId: string;
  view: PieceView;
  choice: Choice;
  currency: string;
  onChange: (next: Partial<Choice>) => void;
}) {
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState<CatalogProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | undefined>(choice.product?.id);
  const detail = useProduct(merchantId, openId);

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ merchantId, page: '1' });
    if (keyword) params.set('keyword', keyword);
    fetch(`/api/returns/exchange/catalog?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل المنتجات');
        if (!cancelled) setList((data.products as CatalogProductSummary[]).filter((p) => p.id !== view.piece.productId).slice(0, 8));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل المنتجات'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [merchantId, keyword, view.piece.productId]);

  useEffect(() => {
    if (detail.product && detail.product.id !== choice.product?.id) {
      onChange({ product: detail.product, productSku: detail.product.skus.find((sku) => sku.inStock) });
    }
  }, [detail.product, choice.product?.id, onChange]);

  return (
    <div className="card">
      <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
      <label className="f" style={{ marginTop: 14 }}>
        اختاري المنتج الجديد
      </label>
      <input
        className="inp"
        style={{ direction: 'rtl', marginBottom: 10 }}
        placeholder="ابحثي عن فستان أو لون أو موديل..."
        value={keywordInput}
        onChange={(event) => setKeywordInput(event.target.value)}
      />
      {loading && <div className="tiny">جارٍ تحميل المنتجات...</div>}
      {error && <div className="err-t">{error}</div>}
      {!loading && !error && list.length === 0 && <div className="tiny">لا توجد نتائج مطابقة. جرّبي كلمة أخرى.</div>}
      {list.map((product) => (
        <button key={product.id} type="button" className={`opt ${openId === product.id ? 'on' : ''}`} onClick={() => setOpenId(product.id)}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="thumb" style={{ width: 46, height: 58 }}>
              <Thumb src={product.imageUrl} alt={product.name} />
            </div>
            <div>
              <b>{product.name}</b>
              <span>{formatMoney(product.price, product.currency || currency)}</span>
            </div>
          </div>
          <span className="dot" />
        </button>
      ))}
      {detail.loading && <div className="tiny">جارٍ تحميل المقاسات...</div>}
      {choice.product && (
        <>
          <label className="f">اختاري المقاس</label>
          <SkuButtons product={choice.product} chosen={choice.productSku} onPick={(sku) => onChange({ productSku: sku })} />
        </>
      )}
    </div>
  );
}

/* ---------------- money ---------------- */

function lineUnits(order: ReturnsOrder, itemId: string) {
  return order.items.find((item) => String(item.id) === itemId)?.quantity ?? 1;
}

function buildManageCalc(order: ReturnsOrder, views: PieceView[], choices: Record<string, Choice>, wholeOrder: boolean): Calc & { pay: number; refund: number } {
  const chosen = views.filter((view) => choices[view.key]?.selected);
  if (wholeOrder) {
    const total = Number(order.amounts?.total?.amount) || 0;
    return {
      rows: [{ label: 'إجمالي الطلب المدفوع', value: total }],
      totalLabel: 'المبلغ المسترد',
      totalValue: total,
      note: 'يُسترد إلى وسيلة الدفع الأصلية.',
      pay: 0,
      refund: total,
    };
  }
  let oldValue = 0;
  let newValue = 0;
  let cancelled = 0;
  const perLine = new Map<string, number>();
  for (const view of chosen) perLine.set(view.piece.orderItemId, (perLine.get(view.piece.orderItemId) ?? 0) + 1);
  for (const view of chosen) {
    const choice = choices[view.key];
    if (choice.action === 'cancel') {
      cancelled += view.price;
      continue;
    }
    oldValue += view.price;
    if (choice.action === 'size') {
      // A one-piece line keeps its paid price when only the size changes.
      const inPlace = lineUnits(order, view.piece.orderItemId) === 1 && perLine.get(view.piece.orderItemId) === 1;
      newValue += inPlace ? view.price : choice.sizeSku?.price ?? view.price;
    } else {
      newValue += choice.productSku?.price ?? choice.product?.price ?? 0;
    }
  }
  const rows: CalcRow[] = [];
  const changed = oldValue > 0;
  if (changed) {
    rows.push({ label: 'سعر المنتجات الجديدة', value: newValue }, { label: 'سعر المنتجات الحالية', value: oldValue, minus: true });
  }
  if (cancelled > 0) rows.push({ label: 'قيمة القطع الملغاة', value: cancelled, minus: changed });
  if (!rows.length) rows.push({ label: 'فرق السعر', value: 0 });
  const net = Math.round((newValue - oldValue - cancelled) * 100) / 100;
  const pay = Math.max(0, net);
  const refund = Math.max(0, -net);
  if (pay > 0) return { rows, totalLabel: 'المطلوب دفعه', totalValue: pay, due: true, pay, refund };
  if (refund > 0) {
    return {
      rows,
      totalLabel: cancelled > 0 && !changed ? 'المبلغ المسترد' : 'يُسترد لكِ',
      totalValue: refund,
      note: 'يُسترد إلى وسيلة الدفع الأصلية.',
      pay,
      refund,
    };
  }
  return { rows, totalLabel: 'لا يوجد مبلغ مستحق', totalValue: 0, pay, refund };
}

/* ---------------- piece card (screen 29) ---------------- */

function PieceCard({
  view,
  choice,
  verdicts,
  currency,
  onChange,
}: {
  view: PieceView;
  choice: Choice;
  verdicts: ManageVerdicts;
  currency: string;
  onChange: (next: Partial<Choice>) => void;
}) {
  const on = choice.selected;
  const types: Array<[Action, boolean]> = [
    ['cancel', verdicts.items || verdicts.cancel],
    ['size', verdicts.swap],
    ['product', verdicts.items],
  ];
  const label = choice.action === 'cancel' ? 'الإلغاء' : choice.action === 'size' ? 'تغيير المقاس' : 'تغيير المنتج';
  return (
    <div className={`card ${on ? 'sel' : ''}`}>
      <div className="head">
        <span className={`badge ${on ? 'on' : ''}`}>{on ? 'محددة' : 'غير محددة'}</span>
        <button type="button" className="chk" aria-pressed={on} onClick={() => onChange({ selected: !on })}>
          <span>{on ? 'القطعة المراد إلغاؤها أو تعديلها' : 'حددي القطعة للإلغاء أو التعديل'}</span>
          <span className={`box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
        </button>
      </div>
      <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} listPrice={view.listPrice} currency={currency} />
      {on && (
        <>
          <div className="hr" />
          <div className="sect" style={{ fontSize: 14.5 }}>
            ماذا تودين أن تفعلي؟
          </div>
          <div className="seg">
            {types.map(([type, allowed]) => (
              <button
                key={type}
                type="button"
                className={choice.action === type ? 'on' : ''}
                disabled={!allowed}
                onClick={() => onChange({ action: type, reason: '', other: '' })}
              >
                {TYPE_NAME[type]}
              </button>
            ))}
          </div>
          <label className="f">سبب {label}</label>
          <select className="inp" value={choice.reason} onChange={(event) => onChange({ reason: event.target.value })}>
            <option value="">اختاري السبب</option>
            {REASONS[choice.action].map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
          {choice.reason === 'سبب آخر' && (
            <>
              <label className="f" style={{ marginTop: 12 }}>
                وضحي السبب
              </label>
              <textarea
                className="inp"
                placeholder="اكتبي التفاصيل التي تساعدنا على فهم طلبك."
                value={choice.other}
                maxLength={500}
                onChange={(event) => onChange({ other: event.target.value })}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- the flow ---------------- */

export function ManageFlow({
  order,
  mobile,
  merchantId,
  verdicts,
  onBack,
}: {
  order: ReturnsOrder;
  mobile: string;
  merchantId: string;
  verdicts: ManageVerdicts;
  onBack: () => void;
}) {
  const currency = orderCurrency(order);
  const orderNumber = String(order.reference_id);
  const views = useMemo(() => buildPieceViews(order, piecesFromOrder(order)), [order]);
  const [step, setStepState] = useState<Step>('items');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [agree, setAgree] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [status, setStatus] = useState<ChangeStatus | null>(null);
  const [outcome, setOutcome] = useState<Record<string, any> | null>(null);
  const keyRef = useRef<string>(newKey());

  const setStep = (next: Step) => {
    setError('');
    setStepState(next);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  const choiceOf = useCallback(
    (key: string): Choice => choices[key] ?? { selected: false, action: verdicts.items || verdicts.cancel ? 'cancel' : 'size', reason: '', other: '' },
    [choices, verdicts],
  );
  const update = useCallback(
    (key: string) => (next: Partial<Choice>) => {
      keyRef.current = newKey();
      setChoices((previous) => ({ ...previous, [key]: { ...choiceOf(key), ...next } }));
    },
    [choiceOf],
  );

  const selected = views.filter((view) => choiceOf(view.key).selected);
  const by = (action: Action) => selected.filter((view) => choiceOf(view.key).action === action);
  const wholeOrder = selected.length === views.length && selected.length > 0 && selected.every((view) => choiceOf(view.key).action === 'cancel');
  const calc = buildManageCalc(order, views, Object.fromEntries(views.map((v) => [v.key, choiceOf(v.key)])), wholeOrder);
  const typesLabel = [...new Set(selected.map((view) => TYPE_NAME[choiceOf(view.key).action]))].join(' + ') || '—';

  const nextFrom = (from: Step): Step => {
    if (from === 'items' && by('size').length) return 'size';
    if ((from === 'items' || from === 'size') && by('product').length) return 'product';
    return 'review';
  };
  const prevOf = (at: Step): Step => {
    if (at === 'review') return by('product').length ? 'product' : by('size').length ? 'size' : 'items';
    if (at === 'product') return by('size').length ? 'size' : 'items';
    return 'items';
  };
  const nextLabel = (next: Step) =>
    next === 'size' ? 'متابعة لاختيار المقاس' : next === 'product' ? 'متابعة لاختيار المنتج' : 'متابعة لمراجعة الطلب';

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Tracking: follow the change until it settles.
  const changeId = status?.id ?? (outcome?.changeId as string | undefined);
  const refresh = useCallback(async () => {
    if (!changeId) return;
    const response = await fetch(`${API}/changes/${changeId}`, { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json().catch(() => null);
    if (data?.change) setStatus(data.change as ChangeStatus);
  }, [changeId]);
  useEffect(() => {
    if (step !== 'track' && step !== 'pay') return;
    void refresh();
    if (status && !['awaiting_payment', 'applying', 'held'].includes(status.state)) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [step, refresh, status]);

  // Paid: move from the payment screen to tracking.
  useEffect(() => {
    if (step === 'pay' && status?.state === 'completed') setStepState('track');
  }, [step, status?.state]);

  /* ---- validation per screen ---- */
  const itemsError = (): string => {
    if (!selected.length) return 'حددي قطعة للمتابعة';
    for (const view of selected) {
      const choice = choiceOf(view.key);
      if (!choice.reason) return 'اختاري سبب التعديل لكل قطعة.';
      if (choice.reason === 'سبب آخر' && !choice.other.trim()) return 'وضحي السبب لكل قطعة اخترتِ لها «سبب آخر».';
    }
    if (!verdicts.items && !wholeOrder && selected.some((view) => choiceOf(view.key).action !== 'size')) {
      return verdicts.reason || 'يمكن إلغاء الطلب كاملًا فقط لهذا الطلب.';
    }
    return '';
  };

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await postJson('start', { orderNumber, mobile });
      if (result.status === 503) return setError('هذه الخدمة غير متاحة حالياً.');
      if (result.ok || result.data.code === 'wait') {
        setResendIn(result.ok ? 60 : Number(result.data.retryAfterSeconds) || 60);
        setCode('');
        setStep('code');
        return;
      }
      setError(result.data.error || GENERIC);
    } catch {
      setError(GENERIC);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const verified = await postJson('verify', { orderNumber, mobile, code });
      if (!verified.ok) return setError(verified.data.error || 'الرمز غير صحيح.');
      const pieces = selected.map((view) => {
        const choice = choiceOf(view.key);
        const sku = choice.action === 'size' ? choice.sizeSku : choice.productSku;
        return {
          itemId: view.piece.orderItemId,
          action: choice.action,
          reason: choice.reason,
          note: choice.reason === 'سبب آخر' ? choice.other.trim() : undefined,
          productId: choice.action === 'product' ? choice.product?.id : choice.action === 'size' ? view.piece.productId : undefined,
          optionValueIds: sku?.optionValueIds,
        };
      });
      const result = await postJson('changes', { idempotencyKey: keyRef.current, pieces });
      const data = result.data;
      if (data.status === 'denied' || data.status === 'failed' || (!result.ok && !data.changeId)) {
        setError(data.message || data.error || GENERIC);
        setStep('review');
        return;
      }
      setOutcome(data);
      setStatus(null);
      setStep(data.status === 'awaiting_payment' ? 'pay' : 'track');
    } catch {
      setError(GENERIC);
    } finally {
      setBusy(false);
    }
  };

  /* ---- shared bits ---- */
  const orderBanner = (
    <div className="banner">
      <div className="row" style={{ margin: 0 }}>
        <span>رقم الطلب</span>
        <span className="v">{orderNumber}</span>
      </div>
      <div className="row" style={{ margin: 0 }}>
        <span>رقم الجوال</span>
        <span className="v">{maskPhone(mobile)}</span>
      </div>
    </div>
  );
  const errorBanner = error ? (
    <div className="banner">
      <p>{error}</p>
    </div>
  ) : null;

  /* ---------------- 29 ---------------- */
  if (step === 'items') {
    const next = nextFrom('items');
    const invalid = itemsError();
    return (
      <div className="pad">
        <h1>إلغاء أو تعديل الطلب</h1>
        <p className="lead">اختاري القطع وحددي ما تودين فعله لكل قطعة.</p>
        <StepsBar on={1} />
        <div className="banner neutral">
          <b>طلب جديد</b>
          <p>يمكنك إلغاء الطلب أو تغيير المقاس أو المنتج خلال 3 ساعات من إنشائه وقبل بدء تجهيزه.</p>
        </div>
        <div className="sect">منتجات طلبك · {views.length === 1 ? 'قطعة واحدة' : views.length === 2 ? 'قطعتان' : `${views.length} قطع`}</div>
        <div className="tiny" style={{ margin: '4px 0 12px' }}>
          طلب رقم {orderNumber}
        </div>
        {views.map((view) => (
          <PieceCard key={view.key} view={view} choice={choiceOf(view.key)} verdicts={verdicts} currency={currency} onChange={update(view.key)} />
        ))}
        {selected.length > 0 && selected.every((view) => choiceOf(view.key).action === 'cancel') && (
          <>
            <div className="credit">المبلغ المسترد: {formatMoney(calc.refund, currency)}</div>
            <div className="tiny" style={{ margin: '-6px 0 10px' }}>
              يُسترد إلى وسيلة الدفع الأصلية.
            </div>
          </>
        )}
        {errorBanner}
        <div className="tiny" style={{ margin: '8px 0' }}>
          {!selected.length ? 'لم يتم تحديد أي قطعة بعد.' : selected.length === 1 ? 'قطعة واحدة محددة' : `${selected.length} قطع محددة`}
        </div>
        <button
          type="button"
          className="btn"
          disabled={!selected.length}
          onClick={() => (invalid ? setError(invalid) : setStep(next))}
        >
          {!selected.length ? 'حددي قطعة للمتابعة' : nextLabel(next)}
        </button>
        <button type="button" className="link" onClick={onBack}>
          الرجوع إلى البحث عن الطلب
        </button>
      </div>
    );
  }

  /* ---------------- 30 ---------------- */
  if (step === 'size') {
    const next = nextFrom('size');
    const missing = by('size').some((view) => !choiceOf(view.key).sizeSku);
    return (
      <div className="pad">
        <h1>تغيير المقاس</h1>
        <p className="lead">اختاري المقاس الجديد لكل قطعة.</p>
        <StepsBar on={1} />
        {by('size').map((view) => (
          <SizeCard
            key={view.key}
            merchantId={merchantId}
            view={view}
            item={lineOf(order, view)}
            choice={choiceOf(view.key)}
            currency={currency}
            onChange={update(view.key)}
          />
        ))}
        {errorBanner}
        <button type="button" className="btn" onClick={() => (missing ? setError('اختاري المقاس الجديد لكل قطعة.') : setStep(next))}>
          {nextLabel(next)}
        </button>
        <button type="button" className="btn ghost" onClick={() => setStep('items')}>
          الرجوع إلى تفاصيل الطلب
        </button>
      </div>
    );
  }

  /* ---------------- 31 ---------------- */
  if (step === 'product') {
    const missing = by('product').some((view) => !choiceOf(view.key).productSku);
    return (
      <div className="pad">
        <h1>تغيير المنتج</h1>
        <p className="lead">اختاري المنتج الجديد والمقاس لكل قطعة.</p>
        <StepsBar on={1} />
        {by('product').map((view) => (
          <ProductCard key={view.key} merchantId={merchantId} view={view} choice={choiceOf(view.key)} currency={currency} onChange={update(view.key)} />
        ))}
        <CalcBox calc={calc} currency={currency} />
        {errorBanner}
        <button type="button" className="btn" onClick={() => (missing ? setError('اختاري المنتج والمقاس لكل قطعة.') : setStep('review'))}>
          متابعة لمراجعة الطلب
        </button>
        <button type="button" className="btn ghost" onClick={() => setStep(prevOf('product'))}>
          الرجوع
        </button>
      </div>
    );
  }

  /* ---------------- 32 ---------------- */
  if (step === 'review') {
    return (
      <div className="pad">
        <h1>راجعي طلبك</h1>
        <p className="lead">تأكدي من القطع والتفاصيل قبل الإرسال.</p>
        <StepsBar on={2} />
        {orderBanner}
        {selected.map((view) => {
          const choice = choiceOf(view.key);
          const reason = choice.reason === 'سبب آخر' && choice.other ? choice.other : choice.reason;
          const reasonRow = (
            <div className="row" style={{ marginTop: 12 }}>
              <span style={{ color: 'var(--muted)' }}>السبب</span>
              <span className="v">{reason}</span>
            </div>
          );
          if (choice.action === 'cancel') {
            return (
              <div key={view.key} className="card">
                <div className="sect" style={{ color: 'var(--brand)', fontSize: 14.5, marginBottom: 10 }}>
                  قطعة للإلغاء
                </div>
                <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
                {reasonRow}
              </div>
            );
          }
          if (choice.action === 'size') {
            return (
              <div key={view.key} className="card">
                <div className="sect" style={{ color: 'var(--brand)', fontSize: 14.5, marginBottom: 10 }}>
                  تغيير المقاس
                </div>
                <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
                <div className="row" style={{ marginTop: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>المقاس الجديد</span>
                  <span className="v">{skuLabelFromView(choice)}</span>
                </div>
                {reasonRow}
              </div>
            );
          }
          return (
            <div key={view.key}>
              <div className="card">
                <div className="sect" style={{ color: 'var(--brand)', fontSize: 14.5, marginBottom: 10 }}>
                  المنتج الحالي
                </div>
                <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
              </div>
              <div className="card">
                <div className="sect" style={{ color: 'var(--brand)', fontSize: 14.5, marginBottom: 10 }}>
                  المنتج الجديد
                </div>
                <ProdRow
                  name={choice.product?.name ?? ''}
                  imageUrl={choice.product?.imageUrl}
                  details={choice.product && choice.productSku ? `المقاس: ${skuName(choice.product, choice.productSku)}` : ''}
                  price={choice.productSku?.price ?? choice.product?.price}
                  currency={currency}
                />
                {reasonRow}
              </div>
            </div>
          );
        })}
        <CalcBox calc={calc} currency={currency} />
        {calc.pay > 0 && (
          <div className="tiny" style={{ margin: '-4px 0 12px' }}>
            يصلك رابط دفع الفرق بعد الإرسال، ولديك 30 دقيقة لإتمامه، وإلا يبقى طلبك كما هو دون تعديل.
          </div>
        )}
        {errorBanner}
        <button type="button" className="chk" style={{ margin: '12px 0', color: 'var(--brown)', fontSize: 13.5 }} onClick={() => setAgree(!agree)}>
          <span className={`box ${agree ? 'on' : ''}`}>{agree ? '✓' : ''}</span>
          <span>أوافق على الشروط وأؤكد صحة البيانات.</span>
        </button>
        <button type="button" className="btn" disabled={!agree || busy} onClick={sendCode}>
          {busy ? 'جارٍ الإرسال...' : calc.pay > 0 ? `متابعة لدفع ${formatMoney(calc.pay, currency)}` : 'إرسال الطلب'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setStep(prevOf('review'))}>
          تعديل تفاصيل الطلب
        </button>
      </div>
    );
  }

  /* ---------------- one-time code ---------------- */
  if (step === 'code') {
    return (
      <div className="pad">
        <h1>تأكيد الطلب</h1>
        <p className="lead">أرسلنا رمز تحقق إلى جوالك {maskPhone(mobile)} عبر واتساب. أدخليه لتأكيد التعديل.</p>
        <StepsBar on={2} />
        <div className="card">
          <label className="f" htmlFor="manage-code">
            رمز التحقق
          </label>
          <input
            id="manage-code"
            className="inp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <div className="help-t">الرمز صالح لمدة 10 دقائق.</div>
        </div>
        {errorBanner}
        <button type="button" className="btn" disabled={busy || code.length < 6} onClick={submit}>
          {busy ? 'جارٍ تنفيذ طلبك...' : 'تأكيد وإرسال الطلب'}
        </button>
        <button type="button" className="btn ghost" disabled={busy || resendIn > 0} onClick={sendCode}>
          {resendIn > 0 ? `إعادة إرسال الرمز بعد ${resendIn} ثانية` : 'إعادة إرسال الرمز'}
        </button>
        <button type="button" className="link" onClick={() => setStep('review')}>
          الرجوع إلى المراجعة
        </button>
      </div>
    );
  }

  const serviceNo = status?.serviceNumber ?? (outcome?.serviceNumber as string | undefined) ?? '';
  const state = status?.state ?? (outcome?.status === 'awaiting_payment' ? 'awaiting_payment' : outcome?.status === 'completed' ? 'completed' : outcome?.status === 'pending_review' ? 'needs_staff' : 'applying');
  const payUrl = status?.paymentUrl ?? (outcome?.paymentUrl as string | undefined) ?? null;
  const payAmount = status?.amountDelta ?? (outcome?.amount as number | undefined) ?? calc.pay;

  /* ---------------- 35 ---------------- */
  if (step === 'pay') {
    return (
      <div className="pad">
        <h1>دفع فرق السعر</h1>
        <p className="lead">تأكدي من المبلغ ثم أكملي الدفع لتنفيذ التعديل.</p>
        <StepsBar on={2} />
        <CalcBox calc={calc} currency={currency} />
        {state === 'failed' ? (
          <div className="banner">
            <b>انتهت مهلة الدفع</b>
            <p>لم يكتمل الدفع خلال 30 دقيقة، فأُعيد طلبك كما كان دون تعديل.</p>
          </div>
        ) : (
          <div className="banner neutral">
            <p>أرسلنا رابط الدفع أيضًا عبر واتساب. أكملي الدفع خلال 30 دقيقة، وإلا يبقى طلبك كما هو دون تعديل.</p>
          </div>
        )}
        {payUrl && state === 'awaiting_payment' && (
          <a className="btn" href={payUrl} style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}>
            دفع {formatMoney(payAmount, currency)}
          </a>
        )}
        <button type="button" className="btn ghost" onClick={() => setStep('track')}>
          متابعة حالة الطلب
        </button>
        <div className="tiny" style={{ textAlign: 'center', marginTop: 10 }}>
          سيظهر تأكيد مستقل عند اكتمال الدفع وتنفيذ الطلب.
        </div>
      </div>
    );
  }

  /* ---------------- 36 ---------------- */
  if (step === 'track') {
    const done = state === 'completed';
    const current = done ? 3 : state === 'awaiting_payment' || state === 'applying' ? 2 : 1;
    const label =
      state === 'awaiting_payment' ? 'بانتظار دفع الفرق' : state === 'needs_staff' ? 'يراجعه فريق خدمة العملاء' : state === 'failed' ? 'لم يُنفذ' : undefined;
    return (
      <div className="pad">
        <h1>{done ? 'تم تنفيذ طلبك' : 'تم استلام طلبك'}</h1>
        <p className="lead">{done ? 'تم تحديث طلبك.' : 'سنُحدّثك عند تنفيذ الطلب.'}</p>
        <div className="banner">
          <div className="row">
            <span>رقم طلب الخدمة</span>
            <span className="v">{serviceNo}</span>
          </div>
          <div className="row">
            <span>رقم الطلب الأصلي</span>
            <span className="v">{orderNumber}</span>
          </div>
          <div className="row" style={{ margin: 0 }}>
            <span>نوع الطلب</span>
            <span className="v" style={{ color: 'var(--brand)' }}>
              {outcome?.wholeOrder ? 'إلغاء الطلب' : typesLabel}
            </span>
          </div>
        </div>
        <Timeline names={['مراجعة الطلب', 'تنفيذ الطلب', 'اكتمال الطلب']} current={current} allDone={done} currentLabel={label} />
        {state === 'needs_staff' && (
          <div className="banner neutral">
            <p>استلمنا طلبك ويتأكد منه فريق خدمة العملاء الآن، وسنتواصل معك إن لزم الأمر.</p>
          </div>
        )}
        {state === 'failed' && (
          <div className="banner">
            <p>{status?.paymentStatus === 'expired' ? 'انتهت مهلة دفع الفرق، فبقي طلبك كما كان دون تعديل.' : 'لم نتمكن من تنفيذ طلبك، ولم يتغير شيء في الطلب.'}</p>
          </div>
        )}
        {state === 'awaiting_payment' && payUrl && (
          <a className="btn" href={payUrl} style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}>
            دفع {formatMoney(payAmount, currency)}
          </a>
        )}
        {done ? (
          <button type="button" className="btn" onClick={() => setStep('result')}>
            عرض النتيجة النهائية
          </button>
        ) : (
          <button type="button" className="btn ghost" onClick={() => void refresh()}>
            تحديث حالة الطلب
          </button>
        )}
        <HelpButton orderNumber={orderNumber} />
      </div>
    );
  }

  /* ---------------- 37–39 ---------------- */
  const types = [...new Set(selected.map((view) => choiceOf(view.key).action))];
  const title = outcome?.wholeOrder
    ? 'تم إلغاء الطلب'
    : types.length === 1
      ? { cancel: 'تم إلغاء القطع المحددة', size: 'تم تغيير المقاس', product: 'تم تغيير المنتج' }[types[0]]
      : 'تم تنفيذ طلبك';
  const lead = outcome?.wholeOrder
    ? 'تم إلغاء طلبك بالكامل.'
    : types.length === 1
      ? { cancel: 'تم إلغاء القطع المحددة من طلبك.', size: 'تم تعديل طلبك بالمقاس الجديد.', product: 'تم تعديل طلبك بالمنتج الجديد.' }[types[0]]
      : 'تم تنفيذ التعديلات على القطع المحددة.';
  const refundAmount = status?.refundAmount ?? (outcome?.refundAmount as number | undefined) ?? calc.refund;
  return (
    <div className="pad">
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      <div className="banner">
        <div className="row">
          <span>رقم طلب الخدمة</span>
          <span className="v">{serviceNo}</span>
        </div>
        <div className="row">
          <span>رقم الطلب الأصلي</span>
          <span className="v">{orderNumber}</span>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <span>حالة الطلب</span>
          <span className="v" style={{ color: 'var(--brand)' }}>
            مكتمل
          </span>
        </div>
      </div>
      {refundAmount > 0 && (
        <div className="card">
          <div className="tiny" style={{ fontSize: 14 }}>
            المبلغ المسترد
          </div>
          <div className="big">{formatMoney(refundAmount, currency)}</div>
          <div className="tiny">
            {status?.refundStatus === 'manual' ? 'يُسترد إلى وسيلة الدفع الأصلية بعد مراجعة فريقنا.' : 'يُسترد إلى وسيلة الدفع الأصلية.'}
          </div>
        </div>
      )}
      {selected.map((view) => {
        const choice = choiceOf(view.key);
        const heading = choice.action === 'cancel' ? 'قطعة ملغاة' : choice.action === 'size' ? 'قطعة بمقاس جديد' : 'المنتج الجديد';
        return (
          <div key={view.key} className="card">
            <div className="sect" style={{ color: 'var(--brand)', fontSize: 14.5, marginBottom: 10 }}>
              {heading}
            </div>
            {choice.action === 'product' && choice.product ? (
              <ProdRow
                name={choice.product.name}
                imageUrl={choice.product.imageUrl}
                details={choice.productSku ? `المقاس: ${skuName(choice.product, choice.productSku)}` : ''}
                price={choice.productSku?.price ?? choice.product.price}
                currency={currency}
              />
            ) : (
              <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} currency={currency} />
            )}
            {choice.action === 'size' && (
              <div className="row" style={{ marginTop: 12 }}>
                <span style={{ color: 'var(--muted)' }}>المقاس الجديد</span>
                <span className="v">{skuLabelFromView(choice)}</span>
              </div>
            )}
          </div>
        );
      })}
      <CalcBox calc={calc} currency={currency} />
      <a className="btn" href={STORE_URL} style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}>
        العودة إلى المتجر
      </a>
    </div>
  );
}

/** Size name of the chosen size variant (the product is loaded inside SizeCard). */
function skuLabelFromView(choice: Choice): string {
  return choice.sizeName || '—';
}
