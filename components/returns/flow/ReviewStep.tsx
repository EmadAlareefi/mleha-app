'use client';

import type { ExchangeCartLine } from '@/components/returns/ExchangePicker';
import { buildCalc, reasonLabel, type Money, type PieceState, type PieceView } from './model';
import { CalcBox, formatMoney, maskPhone, ProdRow, StepsBar } from './ui';

export function ReviewStep({
  orderNumber,
  mobile,
  chosen,
  cart,
  money,
  paymentMethods,
  paymentMethod,
  onPaymentMethod,
  agree,
  onAgree,
  submitting,
  redirecting,
  error,
  onSubmit,
  onEdit,
  onEditAlt,
}: {
  orderNumber: string;
  mobile: string;
  chosen: Array<{ view: PieceView; state: PieceState }>;
  cart: ExchangeCartLine[];
  money: Money;
  paymentMethods: Array<{ slug: string; label: string }>;
  paymentMethod: string;
  onPaymentMethod: (slug: string) => void;
  agree: boolean;
  onAgree: (agree: boolean) => void;
  submitting: boolean;
  redirecting: boolean;
  error: string;
  onSubmit: () => void;
  onEdit: () => void;
  onEditAlt: () => void;
}) {
  const { hasExchange, hasReturn, replacing, settlement, currency } = money;
  const due = replacing && settlement.needsPayment;
  const needsMethod = due && paymentMethods.length > 1;

  let label: string;
  if (redirecting) label = 'جارٍ تحويلك لصفحة الدفع...';
  else if (submitting) label = 'جارٍ إرسال الطلب...';
  else if (due) label = `متابعة لدفع ${formatMoney(settlement.amountDue, currency)}`;
  else if (!hasExchange) label = 'إرسال طلب الاسترجاع';
  else if (!replacing && !hasReturn) label = 'إرسال طلب الكوبون';
  else label = 'إرسال الطلب';

  const pieceTitle = (state: PieceState) =>
    state.type === 'return' ? 'قطعة للاسترجاع' : replacing ? 'قطعة للاستبدال' : 'قطعة للاستبدال بكوبون';
  const reasonText = (state: PieceState) => (state.reason === 'other' && state.other.trim() ? state.other.trim() : reasonLabel(state.type, state.reason));

  const exchanges = chosen.filter(({ state }) => state.type === 'exchange');
  const returns = chosen.filter(({ state }) => state.type === 'return');

  const pieceCard = ({ view, state }: { view: PieceView; state: PieceState }) => (
    <div key={view.key} className="card">
      <div className="sect brand">{pieceTitle(state)}</div>
      <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} listPrice={view.listPrice} currency={currency} />
      <div className="row" style={{ marginTop: 12 }}>
        <span className="k">السبب</span>
        <span className="v">{reasonText(state)}</span>
      </div>
      <div className="tiny">شريط الحماية لم يُزل.</div>
    </div>
  );

  return (
    <div className="pad">
      <h1>راجعي طلبك</h1>
      <p className="lead">تأكدي من القطع والتفاصيل قبل الإرسال.</p>
      <StepsBar on={2} />
      <div className="banner">
        <div className="row" style={{ margin: 0 }}>
          <span>رقم الطلب</span>
          <span className="v">{orderNumber}</span>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <span>رقم الجوال</span>
          <span className="v" style={{ direction: 'ltr' }}>
            {maskPhone(mobile)}
          </span>
        </div>
      </div>

      {exchanges.map(pieceCard)}
      {replacing && cart.length > 0 && (
        <div className="card">
          <div className="sect brand">{cart.length > 1 ? 'البدائل المختارة' : 'البديل المختار'}</div>
          {cart.map((line) => (
            <div key={line.skuId} style={{ marginBottom: 8 }}>
              <ProdRow
                name={line.name}
                imageUrl={line.imageUrl}
                details={[line.variantName, line.quantity > 1 ? `الكمية: ${line.quantity}` : ''].filter(Boolean).join(' · ')}
                price={line.unitPrice}
                currency={currency}
              />
            </div>
          ))}
          <button type="button" className="link" style={{ paddingBottom: 0 }} onClick={onEditAlt}>
            تغيير البديل
          </button>
        </div>
      )}
      {returns.map(pieceCard)}

      <CalcBox calc={buildCalc(money)} currency={currency} />
      {hasExchange && !replacing && (
        <div className="tiny" style={{ margin: '-4px 0 12px' }}>
          يصلك الكوبون عبر واتساب بعد فحص القطعة وقبولها، لتستخدميه لاحقًا.
        </div>
      )}
      {hasExchange && hasReturn && (
        <div className="tiny" style={{ margin: '-4px 0 12px' }}>
          رسوم الشحن تُخصم مرة واحدة للطلب كله.
        </div>
      )}
      {replacing && (
        <div className="tiny" style={{ margin: '-4px 0 12px' }}>
          شحن البديل مجاني، ونرسله بعد وصول قطعتك وفحصها.
        </div>
      )}

      {needsMethod && (
        <div className="card">
          <div className="sect" style={{ marginBottom: 10 }}>
            طريقة دفع الفرق
          </div>
          {paymentMethods.map((method) => (
            <button
              key={method.slug}
              type="button"
              className={`opt ${paymentMethod === method.slug ? 'on' : ''}`}
              onClick={() => onPaymentMethod(method.slug)}
            >
              <div>
                <b>{method.label}</b>
              </div>
              <span className="dot" />
            </button>
          ))}
          <div className="tiny">بعد الإرسال ننقلك لصفحة الدفع الآمنة في المتجر لإكمال الدفع.</div>
        </div>
      )}
      {due && !needsMethod && (
        <div className="tiny" style={{ margin: '-4px 0 12px' }}>
          بعد الإرسال ننقلك لصفحة الدفع الآمنة في المتجر لدفع الفرق.
        </div>
      )}

      <div className="banner">
        <b style={{ color: 'var(--brown)' }}>الطلب يخضع لفحص القطعة</b>
        <p>ستتمكنين من متابعة حالة الطلب وتعليمات إعادة القطعة بعد الإرسال.</p>
      </div>

      {error && (
        <div className="banner">
          <b>لم يتم إرسال الطلب</b>
          <p>{error}</p>
        </div>
      )}

      <button type="button" className="chk" style={{ margin: '12px 0', color: 'var(--brown)', fontSize: 13.5 }} aria-pressed={agree} onClick={() => onAgree(!agree)}>
        <span className={`box ${agree ? 'on' : ''}`}>{agree ? '✓' : ''}</span>
        <span>أوافق على شروط الإرجاع والاستبدال وأؤكد صحة البيانات.</span>
      </button>
      <button
        type="button"
        className="btn"
        disabled={!agree || submitting || redirecting || (needsMethod && !paymentMethod)}
        onClick={onSubmit}
      >
        {(submitting || redirecting) && <span className="spin" />}
        {label}
      </button>
      <button type="button" className="btn ghost" disabled={submitting || redirecting} onClick={onEdit}>
        تعديل تفاصيل الطلب
      </button>
    </div>
  );
}

/* ---------------- 21: send not confirmed ---------------- */

export function SendFailedStep({
  orderNumber,
  money,
  flowLabel,
  checking,
  onCheck,
  onBack,
  onHelp,
}: {
  orderNumber: string;
  money: Money;
  flowLabel: string;
  checking: boolean;
  onCheck: () => void;
  onBack: () => void;
  onHelp: () => void;
}) {
  const calc = buildCalc(money);
  return (
    <div className="pad">
      <h1>لم يتأكد إرسال الطلب</h1>
      <p className="lead">تحققي من حالة الطلب قبل إعادة المحاولة.</p>
      <StepsBar on={2} />
      <div className="banner">
        <b style={{ fontSize: 16 }}>تعذر تأكيد الإرسال</b>
        <p>حدث انقطاع أثناء الإرسال. تحققي أولًا من وجود الطلب لتجنّب إنشائه مرتين.</p>
      </div>
      <div className="card">
        <div className="row">
          <span className="k">رقم الطلب الأصلي</span>
          <span className="v">{orderNumber}</span>
        </div>
        <div className="row">
          <span className="k">المسار</span>
          <span className="v">{flowLabel}</span>
        </div>
        <div className="row">
          <span className="k">{calc.totalLabel}</span>
          <span className="v">{formatMoney(calc.totalValue, money.currency)}</span>
        </div>
        <div className="tiny">يمكنك العودة للمراجعة دون تغيير تفاصيل القطعة.</div>
      </div>
      <button type="button" className="btn" disabled={checking} onClick={onCheck}>
        {checking && <span className="spin" />}
        التحقق من حالة الطلب
      </button>
      <button type="button" className="btn ghost" onClick={onBack}>
        العودة إلى المراجعة
      </button>
      <button type="button" className="link" onClick={onHelp}>
        التواصل مع خدمة العملاء
      </button>
    </div>
  );
}
