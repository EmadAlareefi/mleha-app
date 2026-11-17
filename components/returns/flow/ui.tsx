'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const STORE_URL = 'https://mleha.com/ar';
const SUPPORT_WHATSAPP = '966531349631';

export function formatMoney(value: number | string | { toString(): string } | null | undefined, currency?: string | null) {
  const amount = Number(value);
  const code = currency?.trim().toUpperCase() || 'SAR';
  return `${(Number.isFinite(amount) ? amount : 0).toFixed(2)} ${code === 'SAR' ? 'ر.س' : code}`;
}

export function whatsappLink(orderNumber?: string, message?: string) {
  const text =
    message || (orderNumber ? `مرحبًا، أحتاج مساعدة بخصوص طلبي رقم ${orderNumber}` : 'مرحبًا، أحتاج مساعدة بخصوص طلب إرجاع أو استبدال');
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

/* ---------------- shell: top bar, help sheet, toast ---------------- */

interface ShellContextValue {
  openHelp: () => void;
  toast: (message: string) => void;
  setOrderNumber: (orderNumber: string) => void;
}

const ShellContext = createContext<ShellContextValue>({ openHelp: () => {}, toast: () => {}, setOrderNumber: () => {} });
export const useReturnsShell = () => useContext(ShellContext);

export function ReturnsShell({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [toastText, setToastText] = useState<string | null>(null);

  useEffect(() => {
    if (!toastText) return;
    const timer = setTimeout(() => setToastText(null), 1800);
    return () => clearTimeout(timer);
  }, [toastText]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setHelpOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [helpOpen]);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const value = useMemo(() => ({ openHelp, toast: setToastText, setOrderNumber }), [openHelp]);

  return (
    <ShellContext.Provider value={value}>
      <div className="rf" dir="rtl" lang="ar">
        <header className="topbar">
          <div className="topbar-in">
            <a className="logo" href="/returns" aria-label="مليحة">
              <span className="ar">مليحة</span>
              <span className="en">Mleha</span>
            </a>
            <button type="button" className="help" onClick={openHelp}>
              مساعدة
            </button>
          </div>
        </header>
        <main className="screen">{children}</main>

        {helpOpen && (
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rf-help-title"
            onClick={(event) => event.target === event.currentTarget && setHelpOpen(false)}
          >
            <div className="sheet">
              <button type="button" className="x" aria-label="إغلاق" onClick={() => setHelpOpen(false)}>
                ✕
              </button>
              <h2 id="rf-help-title">نحن هنا لمساعدتك</h2>
              <p>تواصلي مع خدمة العملاء عبر واتساب.</p>
              <a className="btn wa" href={whatsappLink(orderNumber)} target="_blank" rel="noopener noreferrer">
                التواصل عبر واتساب
              </a>
            </div>
          </div>
        )}
        {toastText && (
          <div className="toast" role="status">
            {toastText}
          </div>
        )}
      </div>
    </ShellContext.Provider>
  );
}

/* ---------------- building blocks ---------------- */

export function StepsBar({ on }: { on: 1 | 2 }) {
  return (
    <div className="steps">
      <div className={on === 1 ? 'on' : ''}>١ تفاصيل الطلب</div>
      <div className={on === 2 ? 'on' : ''}>٢ المراجعة والإرسال</div>
    </div>
  );
}

export function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  return <div className="thumb">{src ? <Image src={src} alt={alt} fill sizes="92px" /> : null}</div>;
}

export function ProdRow({
  name,
  imageUrl,
  details,
  price,
  listPrice,
  currency,
  children,
}: {
  name: string;
  imageUrl?: string | null;
  details?: string;
  price?: number;
  /** Shown struck through when a discount brought `price` below it. */
  listPrice?: number;
  currency?: string;
  children?: ReactNode;
}) {
  const discounted = price !== undefined && listPrice !== undefined && listPrice - price >= 0.01;
  return (
    <div className="prod">
      <Thumb src={imageUrl} alt={name} />
      <div className="info">
        <div className="nm">{name}</div>
        {details ? <div className="sz">{details}</div> : null}
        {price !== undefined ? (
          <div className="pr">
            {formatMoney(price, currency)}
            {discounted ? <s>{formatMoney(listPrice, currency)}</s> : null}
          </div>
        ) : null}
        {discounted ? <div className="tiny">المبلغ المدفوع بعد الخصم</div> : null}
        {children}
      </div>
    </div>
  );
}

export interface CalcRow {
  label: string;
  value: number;
  minus?: boolean;
  sub?: string;
  strong?: boolean;
}

export interface Calc {
  rows: CalcRow[];
  totalLabel: string;
  totalValue: number;
  due?: boolean;
  note?: string;
}

export function CalcBox({ calc, title = 'الحساب', currency }: { calc: Calc; title?: string; currency?: string }) {
  return (
    <div className="card calc">
      <div className="ttl">{title}</div>
      {calc.rows.map((row) => (
        <div key={row.label} className={`crow ${row.strong ? 'strong' : ''}`}>
          <span>
            {row.label}
            {row.sub ? <small>{row.sub}</small> : null}
          </span>
          <span className="v">
            {row.minus ? '−' : ''}
            {formatMoney(row.value, currency)}
          </span>
        </div>
      ))}
      <div className={`ctot ${calc.due ? 'due' : ''}`}>
        <span>{calc.totalLabel}</span>
        <span className="v">{formatMoney(calc.totalValue, currency)}</span>
      </div>
      {calc.note ? (
        <div className="tiny" style={{ marginTop: 8 }}>
          {calc.note}
        </div>
      ) : null}
    </div>
  );
}

export function Timeline({
  names,
  current,
  allDone,
  currentLabel,
}: {
  names: string[];
  current: number;
  allDone?: boolean;
  /** Text under the current step; defaults to "المرحلة الحالية". */
  currentLabel?: string;
}) {
  return (
    <div className="card timeline">
      <div className="sect" style={{ marginBottom: 14 }}>
        حالة الطلب
      </div>
      {names.map((name, index) => {
        const step = index + 1;
        const done = allDone || step < current;
        const isCurrent = !allDone && step === current;
        return (
          <div key={name} className={`st ${isCurrent ? 'cur' : ''}`}>
            <span className={`c ${done || isCurrent ? 'done' : ''}`}>{step}</span>
            <div>
              <b>{name}</b>
              <span>{done ? 'مكتمل' : isCurrent ? currentLabel || 'المرحلة الحالية' : 'بانتظار المرحلة السابقة'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RulesBlock() {
  return (
    <div className="rules">
      <h3>شروط الإرجاع والاستبدال</h3>
      <div className="card" style={{ padding: '6px 16px' }}>
        <div className="r">
          <b>فساتين السهرة</b>
          <p>يتم الاسترجاع والاستبدال خلال (24) ساعة فقط لفساتين السهرات من تاريخ استلام الطلبية.</p>
        </div>
        <div className="r">
          <b>الفساتين غير فساتين السهرة</b>
          <p>يتم الاسترجاع خلال (3) أيام للفساتين غير فساتين السهرة من تاريخ استلام الطلبية.</p>
        </div>
        <div className="r">
          <b>الاستبدال</b>
          <p>يتم الاستبدال خلال (3) أيام من تاريخ استلام الطلبية.</p>
        </div>
      </div>
    </div>
  );
}

/** 05XXXXXXXX form of a Saudi mobile typed as 05…, 9665…, +9665… or 009665…. */
export function toLocalMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, '');
  const local = digits.replace(/^(?:00)?966/, '');
  return local.startsWith('5') && local.length === 9 ? `0${local}` : digits;
}

export function maskPhone(mobile: string) {
  const digits = toLocalMobile(mobile);
  if (digits.length < 4) return '05••••••••';
  return `${digits.slice(0, 2)}${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}

/* ---------------- small client pieces for server pages ---------------- */

export function HelpButton({ label = 'التواصل مع خدمة العملاء', className = 'btn ghost', orderNumber }: { label?: string; className?: string; orderNumber?: string | null }) {
  const { openHelp, setOrderNumber } = useReturnsShell();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (orderNumber) setOrderNumber(orderNumber);
        openHelp();
      }}
    >
      {label}
    </button>
  );
}

export function CopyCode({ code }: { code: string }) {
  const { toast } = useReturnsShell();
  return (
    <>
      <div className="code">{code}</div>
      <button
        type="button"
        className="btn"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(
            () => toast('تم نسخ الكوبون'),
            () => toast('تعذر النسخ، انسخيه يدويًا'),
          );
        }}
      >
        نسخ الكوبون
      </button>
    </>
  );
}

/** Re-renders a server page every `seconds`, while it is on screen. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
