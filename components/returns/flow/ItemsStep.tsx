'use client';

import { useState } from 'react';
import { CUSTOMER_REASONS } from '@/lib/returns/reasons';
import type { PieceType } from '@/lib/returns/pieces';
import { formatMoney, ProdRow, StepsBar, useReturnsShell } from './ui';
import type { ExchangeMode, Money, PieceState, PieceView } from './model';

interface ItemsStepProps {
  orderNumber: string;
  views: PieceView[];
  states: Record<string, PieceState>;
  onPiece: (key: string, next: Partial<PieceState>) => void;
  mode: ExchangeMode;
  onMode: (mode: ExchangeMode) => void;
  /** null while loading the setting; false = coupons only. */
  exchangeOrdersEnabled: boolean | null;
  money: Money;
  manualReview: boolean;
  /** One-off message, e.g. after cancelling an earlier request. */
  notice?: string | null;
  feeError?: string;
  onNext: () => void;
  onBack: () => void;
}

const TYPE_LABEL: Record<PieceType, string> = { exchange: 'استبدال', return: 'استرجاع' };

export function pieceComplete(state: PieceState | undefined) {
  return Boolean(state && state.ribbonRemoved === false && state.reason && (state.reason !== 'other' || state.other.trim()));
}

export function ItemsStep({
  orderNumber,
  views,
  states,
  onPiece,
  mode,
  onMode,
  exchangeOrdersEnabled,
  money,
  manualReview,
  notice,
  feeError,
  onNext,
  onBack,
}: ItemsStepProps) {
  const { openHelp } = useReturnsShell();
  const [showErrors, setShowErrors] = useState(false);

  const selected = views.filter((view) => states[view.key]?.selected);
  const eligible = selected.filter((view) => states[view.key]?.ribbonRemoved !== true);
  const none = selected.length === 0;
  const allBad = !none && eligible.length === 0;
  const { hasExchange, hasReturn } = money;
  const mixed = hasExchange && hasReturn;
  const canChooseMode = hasExchange && exchangeOrdersEnabled === true;
  const replacing = canChooseMode && mode === 'order';

  const countLabel = none
    ? 'لم يتم تحديد أي قطعة بعد.'
    : mixed
      ? `${eligible.length} قطع محددة · استبدال واسترجاع`
      : eligible.length > 1
        ? `${eligible.length} قطع محددة ${hasExchange ? 'للاستبدال' : 'للاسترجاع'}`
        : `قطعة واحدة ${hasExchange ? 'محددة للاستبدال' : 'للاسترجاع'}`;

  let cta: string;
  let disabled = false;
  if (none) {
    cta = 'حددي قطعة للمتابعة';
    disabled = true;
  } else if (allBad) {
    cta = 'لا توجد قطع مؤهلة للمتابعة';
    disabled = true;
  } else if (feeError) {
    cta = 'تعذر حساب الرسوم';
    disabled = true;
  } else if (replacing) {
    cta = 'متابعة لاختيار البديل';
  } else {
    cta = 'متابعة لمراجعة الطلب';
  }

  const next = () => {
    if (eligible.some((view) => !pieceComplete(states[view.key]))) {
      setShowErrors(true);
      const first = eligible.find((view) => !pieceComplete(states[view.key]));
      if (first) document.getElementById(`piece-${first.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    onNext();
  };

  const exchangeNames = eligible.filter((view) => states[view.key]?.type === 'exchange').length;

  return (
    <div className="pad">
      <h1>الاستبدال والاسترجاع</h1>
      <p className="lead">اختاري القطع وحددي طلبك لكل قطعة.</p>
      <StepsBar on={1} />
      {notice && (
        <div className="banner neutral" role="status">
          <b>تم الإلغاء</b>
          <p>{notice}</p>
        </div>
      )}
      {manualReview && (
        <div className="banner">
          <b>تعذر التحقق من الطلب تلقائيًا</b>
          <p>يمكنك متابعة تقديم الطلب وسيراجعه فريق خدمة العملاء يدويًا.</p>
        </div>
      )}
      <div className="sect">منتجات طلبك · {views.length === 1 ? 'قطعة واحدة' : views.length === 2 ? 'قطعتان' : `${views.length} قطع`}</div>
      <div className="tiny" style={{ margin: '4px 0 12px' }}>
        طلب رقم {orderNumber}
      </div>

      {views.length === 0 && (
        <div className="card">
          <p className="lead" style={{ margin: 0 }}>
            لا توجد منتجات في هذا الطلب.
          </p>
        </div>
      )}

      {views.map((view) => (
        <PieceCard
          key={view.key}
          view={view}
          state={states[view.key]}
          currency={money.currency}
          showErrors={showErrors}
          onChange={(next) => onPiece(view.key, next)}
        />
      ))}

      {!none && !allBad && hasExchange && (
        <>
          {canChooseMode && (
            <>
              <div className="sect">كيف تفضلين الاستبدال؟</div>
              <button type="button" className={`opt ${mode === 'order' ? 'on' : ''}`} onClick={() => onMode('order')} style={{ marginTop: 8 }}>
                <div>
                  <b>اختيار البديل الآن</b>
                  <span>اختاري قطعة جديدة في الخطوة التالية.</span>
                </div>
                <span className="dot" />
              </button>
              <button type="button" className={`opt ${mode === 'coupon' ? 'on' : ''}`} onClick={() => onMode('coupon')}>
                <div>
                  <b>كوبون لاستخدامه لاحقًا</b>
                  <span>يصلك على واتساب بعد فحص القطعة.</span>
                </div>
                <span className="dot" />
              </button>
            </>
          )}
          <Preview money={money} replacing={replacing} />
          {!replacing && (
            <div className="banner neutral">
              <p>يُرسل الكوبون عبر واتساب بعد فحص القطعة وقبولها.</p>
            </div>
          )}
          {mixed && replacing && (
            <div className="tiny" style={{ marginBottom: 8 }}>
              اختيار البديل مطلوب {exchangeNames > 1 ? 'لقطع' : 'لقطعة'} الاستبدال فقط.
            </div>
          )}
        </>
      )}
      {!none && !allBad && !hasExchange && hasReturn && <Preview money={money} replacing={false} />}

      {feeError && (
        <div className="banner">
          <p>{feeError}</p>
        </div>
      )}

      <div className="tiny" style={{ margin: '8px 0' }}>
        {countLabel}
      </div>
      <button type="button" className="btn" disabled={disabled} onClick={next}>
        {cta}
      </button>
      {allBad && (
        <button type="button" className="btn ghost" onClick={openHelp}>
          التواصل مع خدمة العملاء
        </button>
      )}
      <button type="button" className="link" onClick={onBack}>
        الرجوع إلى البحث عن الطلب
      </button>
    </div>
  );
}

function Preview({ money, replacing }: { money: Money; replacing: boolean }) {
  const { split, hasExchange, hasReturn, currency } = money;
  const fee = formatMoney(split.processingFee, currency);
  // Same parts as the review screen, so the two never seem to disagree.
  const plusShipping = split.originalShipping > 0 ? `يشمل شحن الطلب الأصلي ${formatMoney(split.originalShipping, currency)}، ` : '';
  let main: string;
  let sub: string;
  if (hasExchange && hasReturn) {
    main = replacing
      ? `رصيد الاستبدال: ${formatMoney(split.couponAmount, currency)} · المسترد: ${formatMoney(split.refundAmount, currency)}`
      : `رصيد الكوبون: ${formatMoney(split.couponAmount, currency)} · المسترد: ${formatMoney(split.refundAmount, currency)}`;
    sub = `رسوم الشحن ${fee} تُخصم مرة واحدة من المبلغ المسترد. يتحدد المبلغ النهائي بعد فحص القطعة.`;
  } else if (hasExchange) {
    main = `${replacing ? 'رصيد الاستبدال' : 'رصيد الكوبون'}: ${formatMoney(split.couponAmount, currency)}`;
    sub = `${plusShipping}بعد خصم رسوم الشحن ${fee}`;
  } else {
    main = `المبلغ المتوقع للاسترداد: ${formatMoney(split.refundAmount, currency)}`;
    sub = `${plusShipping}بعد خصم رسوم الشحن ${fee}. يتحدد المبلغ النهائي بعد فحص القطعة.`;
  }
  return (
    <>
      <div className="credit">{main}</div>
      <div className="tiny" style={{ margin: '-6px 0 10px' }}>
        {sub}
      </div>
    </>
  );
}

function PieceCard({
  view,
  state,
  currency,
  showErrors,
  onChange,
}: {
  view: PieceView;
  state: PieceState | undefined;
  currency: string;
  showErrors: boolean;
  onChange: (next: Partial<PieceState>) => void;
}) {
  const { piece } = view;
  const blocked = piece.allowedTypes.length === 0;
  const on = Boolean(state?.selected) && !blocked;
  const type = state?.type ?? piece.allowedTypes[0] ?? 'exchange';
  const reasons = CUSTOMER_REASONS[type];
  const reason = state?.reason ?? '';
  const limit = piece.exchangeOnlyReason || piece.returnOnlyReason;

  return (
    <div id={`piece-${view.key}`} className={`card ${on ? 'sel' : ''} ${blocked ? 'off' : ''}`}>
      <div className="head">
        <span className={`badge ${on ? 'on' : ''}`}>{blocked ? 'غير مؤهلة' : on ? 'محددة' : 'غير محددة'}</span>
        <button
          type="button"
          className="chk"
          disabled={blocked}
          aria-pressed={on}
          onClick={() => onChange({ selected: !on, ...(on ? { ribbonRemoved: undefined } : {}) })}
        >
          <span>{on ? 'القطعة المراد استبدالها أو استرجاعها' : 'حددي القطعة للاستبدال أو الاسترجاع'}</span>
          <span className={`box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
        </button>
      </div>
      <ProdRow name={view.name} imageUrl={view.imageUrl} details={view.details} price={view.price} listPrice={view.listPrice} currency={currency} />
      {blocked && <div className="warn">{piece.blockedReason || 'هذه القطعة غير قابلة للإرجاع أو الاستبدال.'}</div>}

      {on && state && (
        <>
          <div className="hr" />
          <div className="sect" style={{ fontSize: 14.5 }}>
            ماذا تودين أن تفعلي؟
          </div>
          <div className="seg">
            {(['exchange', 'return'] as PieceType[]).map((value) => (
              <button
                key={value}
                type="button"
                className={type === value ? 'on' : ''}
                disabled={!piece.allowedTypes.includes(value)}
                onClick={() => onChange({ type: value, reason: '', other: '' })}
              >
                {TYPE_LABEL[value]}
              </button>
            ))}
          </div>
          {limit && <div className="warn" style={{ marginTop: -6 }}>{limit}</div>}

          <label className="f" htmlFor={`reason-${view.key}`}>
            سبب {type === 'exchange' ? 'الاستبدال' : 'الاسترجاع'}
          </label>
          <select
            id={`reason-${view.key}`}
            className={`inp ${showErrors && !reason ? 'err' : ''}`}
            value={reason}
            onChange={(event) => onChange({ reason: event.target.value })}
          >
            <option value="">اختاري السبب</option>
            {reasons.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {showErrors && !reason && <div className="err-t">اختاري السبب للمتابعة.</div>}
          {reason === 'other' && (
            <>
              <label className="f" style={{ marginTop: 12 }} htmlFor={`other-${view.key}`}>
                وضحي السبب
              </label>
              <textarea
                id={`other-${view.key}`}
                className={`inp ${showErrors && !state.other.trim() ? 'err' : ''}`}
                placeholder="المقاس أضيق من المتوقع عند الخصر."
                value={state.other}
                maxLength={500}
                onChange={(event) => onChange({ other: event.target.value })}
              />
              {showErrors && !state.other.trim() ? (
                <div className="err-t">اكتبي سبب {type === 'exchange' ? 'الاستبدال' : 'الاسترجاع'} للمتابعة.</div>
              ) : (
                <div className="tiny">يمكنك كتابة التفاصيل التي تساعدنا على فهم طلبك.</div>
              )}
            </>
          )}

          <div className="f" style={{ marginTop: 12 }}>
            هل أزلتِ شريط الحماية من الفستان؟
          </div>
          <div className="yn" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={state.ribbonRemoved === false}
              className={state.ribbonRemoved === false ? 'on' : ''}
              onClick={() => onChange({ ribbonRemoved: false })}
            >
              <span className="dot" />
              لا، لم أزله
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={state.ribbonRemoved === true}
              className={state.ribbonRemoved === true ? 'on' : ''}
              onClick={() => onChange({ ribbonRemoved: true })}
            >
              <span className="dot" />
              نعم
            </button>
          </div>
          {showErrors && state.ribbonRemoved === undefined && <div className="err-t">أجيبي عن سؤال شريط الحماية.</div>}
          <div className="warn">لا يُقبل الاستبدال أو الاسترجاع في حال إزالة شريط الحماية.</div>
          {state.ribbonRemoved === true && (
            <div className="warn">لا يمكن متابعة الطلب لهذه القطعة بعد إزالة شريط الحماية. يمكنك إلغاء تحديدها واختيار قطعة مؤهلة.</div>
          )}
        </>
      )}
    </div>
  );
}
