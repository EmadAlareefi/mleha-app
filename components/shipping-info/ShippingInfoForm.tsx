'use client';

import { useState, type FormEvent } from 'react';

type Language = 'ar' | 'en';
type PageState = 'open' | 'done' | 'closed' | 'invalid';

type Values = {
  firstName: string;
  middleName: string;
  lastName: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  addressLine2: string;
};

const EMPTY: Values = {
  firstName: '',
  middleName: '',
  lastName: '',
  district: '',
  street: '',
  buildingNumber: '',
  postalCode: '',
  addressLine2: '',
};

const SUPPORT_WHATSAPP = '966531349631';

const TEXT = {
  ar: {
    brand: 'مليحة',
    switchTo: 'English',
    title: 'استكمال بيانات الشحن',
    intro: (order: string) =>
      `لشحن طلبك الدولي رقم ${order} نحتاج الاسم الثلاثي والعنوان كاملًا كما سيظهر على بوليصة الشحن. يرجى كتابتها بدقة.`,
    nameSection: 'الاسم الثلاثي للمستلم',
    firstName: 'الاسم الأول',
    middleName: 'اسم الأب',
    lastName: 'اسم العائلة',
    addressSection: 'العنوان',
    countryCity: 'الدولة / المدينة',
    district: 'الحي / المنطقة',
    street: 'اسم الشارع',
    buildingNumber: 'رقم المبنى / الفيلا',
    postalCode: 'الرمز البريدي',
    addressLine2: 'تفاصيل إضافية (شقة، علامة مميزة…)',
    optional: 'اختياري',
    required: 'هذا الحقل مطلوب',
    missingHint: 'الحقول المميزة ناقصة في طلبك',
    submit: 'إرسال البيانات',
    submitting: 'جارٍ الإرسال…',
    error: 'تعذر الإرسال، حاولي مرة أخرى بعد قليل أو تواصلي معنا.',
    doneTitle: 'شكرًا لك! 🌷',
    doneBody: 'وصلتنا بياناتك وسيتم تجهيز طلبك وشحنه في أقرب وقت.',
    closedTitle: 'لم يعد هذا الرابط مطلوبًا',
    closedBody: 'تمت معالجة طلبك من قبل فريقنا. إن كان لديك أي استفسار تواصلي معنا.',
    invalidTitle: 'الرابط غير صالح أو منتهي',
    invalidBody: 'يرجى التواصل معنا عبر واتساب وسنساعدك في استكمال بيانات الشحن.',
    contact: 'تواصلي معنا عبر واتساب',
    latinHint: 'يمكن الكتابة بالعربية أو الإنجليزية',
  },
  en: {
    brand: 'Mleha',
    switchTo: 'العربية',
    title: 'Complete your shipping details',
    intro: (order: string) =>
      `To ship your international order #${order} we need the recipient's full name (3 parts) and complete address, exactly as they should appear on the shipping label.`,
    nameSection: "Recipient's full name",
    firstName: 'First name',
    middleName: "Father's / middle name",
    lastName: 'Last name',
    addressSection: 'Address',
    countryCity: 'Country / City',
    district: 'District / Area',
    street: 'Street name',
    buildingNumber: 'Building / Villa no.',
    postalCode: 'Postal / ZIP code',
    addressLine2: 'Extra details (apartment, landmark…)',
    optional: 'optional',
    required: 'This field is required',
    missingHint: 'Highlighted fields are missing from your order',
    submit: 'Submit details',
    submitting: 'Submitting…',
    error: 'We could not submit your details. Please try again shortly or contact us.',
    doneTitle: 'Thank you! 🌷',
    doneBody: 'We received your details. Your order will be prepared and shipped shortly.',
    closedTitle: 'This link is no longer needed',
    closedBody: 'Our team has already handled your order. Contact us if you have any questions.',
    invalidTitle: 'This link is invalid or has expired',
    invalidBody: 'Please contact us on WhatsApp and we will help you complete your shipping details.',
    contact: 'Contact us on WhatsApp',
    latinHint: 'You can write in Arabic or English',
  },
} as const;

type FieldKey = keyof Values;
const REQUIRED: FieldKey[] = ['firstName', 'middleName', 'lastName', 'district', 'street'];
const ERROR_TO_FIELD: Record<string, FieldKey> = {
  first_name: 'firstName',
  middle_name: 'middleName',
  last_name: 'lastName',
  district: 'district',
  street: 'street',
};

export function ShippingInfoForm(props: {
  initialLanguage: Language;
  state: PageState;
  merchantId: string;
  orderId: string;
  exp: number;
  sig: string;
  orderNumber: string;
  country: string;
  city: string;
  missingFields: string[];
  initialValues: Values | null;
}) {
  const [language, setLanguage] = useState<Language>(props.initialLanguage);
  const [values, setValues] = useState<Values>(props.initialValues ?? EMPTY);
  const [errors, setErrors] = useState<Set<FieldKey>>(new Set());
  const [state, setState] = useState<PageState>(props.state);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const t = TEXT[language];
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  const missingName = props.missingFields.includes('name');
  const highlighted = (field: FieldKey) =>
    (missingName && (field === 'firstName' || field === 'middleName' || field === 'lastName')) ||
    (props.missingFields.includes('district') && field === 'district') ||
    (props.missingFields.includes('street') && field === 'street');

  const contactLink = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
    language === 'ar' ? `بيانات الشحن للطلب ${props.orderNumber}` : `Shipping details for order ${props.orderNumber}`,
  )}`;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const missing = new Set(REQUIRED.filter((field) => !values[field].trim()));
    setErrors(missing);
    if (missing.size > 0) return;

    setSubmitting(true);
    setSubmitError(false);
    try {
      const response = await fetch(
        `/api/public/shipping-info/${encodeURIComponent(props.merchantId)}/${encodeURIComponent(props.orderId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, exp: props.exp, sig: props.sig }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (result?.ok) {
        setState('done');
      } else if (result?.code === 'invalid' && Array.isArray(result.errors)) {
        setErrors(new Set(result.errors.map((e: string) => ERROR_TO_FIELD[e]).filter(Boolean)));
      } else if (result?.code === 'expired') {
        setState('invalid');
      } else if (result?.code === 'closed') {
        setState('closed');
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const field = (key: FieldKey, label: string, options: { optional?: boolean; autoComplete?: string } = {}) => {
    const invalid = errors.has(key);
    const mark = highlighted(key) && !values[key].trim();
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">
          {label}
          {options.optional ? <span className="text-neutral-400"> ({t.optional})</span> : <span className="text-rose-600"> *</span>}
        </span>
        <input
          value={values[key]}
          onChange={(e) => {
            const next = e.target.value;
            setValues((prev) => ({ ...prev, [key]: next }));
            if (invalid) setErrors((prev) => { const copy = new Set(prev); copy.delete(key); return copy; });
          }}
          autoComplete={options.autoComplete}
          maxLength={150}
          aria-invalid={invalid}
          className={`w-full rounded-xl border px-3 py-3 text-base outline-none transition focus:ring-2 focus:ring-rose-300 ${
            invalid ? 'border-rose-500 bg-rose-50' : mark ? 'border-amber-400 bg-amber-50' : 'border-neutral-300 bg-white'
          }`}
        />
        {invalid ? <span className="mt-1 block text-xs text-rose-600">{t.required}</span> : null}
      </label>
    );
  };

  const message = (title: string, body: string, withContact: boolean) => (
    <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
      <h1 className="mb-2 text-xl font-bold text-neutral-900">{title}</h1>
      <p className="text-neutral-600">{body}</p>
      {withContact ? (
        <a href={contactLink} className="mt-5 inline-block rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white">
          {t.contact}
        </a>
      ) : null}
    </div>
  );

  return (
    <div dir={dir} lang={language} className="min-h-screen bg-neutral-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <header className="mb-5 flex items-center justify-between">
          <span className="text-lg font-bold text-neutral-900">{t.brand}</span>
          <button
            type="button"
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-sm text-neutral-700"
          >
            {t.switchTo}
          </button>
        </header>

        {state === 'invalid' ? message(t.invalidTitle, t.invalidBody, true) : null}
        {state === 'closed' ? message(t.closedTitle, t.closedBody, true) : null}
        {state === 'done' ? message(t.doneTitle, t.doneBody, false) : null}

        {state === 'open' ? (
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h1 className="mb-2 text-xl font-bold text-neutral-900">{t.title}</h1>
              <p className="text-sm leading-6 text-neutral-600">{t.intro(props.orderNumber)}</p>
              {props.missingFields.length > 0 ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t.missingHint}</p>
              ) : null}
            </div>

            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-neutral-900">{t.nameSection}</h2>
              <p className="text-xs text-neutral-500">{t.latinHint}</p>
              {field('firstName', t.firstName, { autoComplete: 'given-name' })}
              {field('middleName', t.middleName, { autoComplete: 'additional-name' })}
              {field('lastName', t.lastName, { autoComplete: 'family-name' })}
            </section>

            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-neutral-900">{t.addressSection}</h2>
              <div>
                <span className="mb-1 block text-sm font-medium text-neutral-700">{t.countryCity}</span>
                <div className="rounded-xl border border-neutral-200 bg-neutral-100 px-3 py-3 text-neutral-700">
                  {[props.country, props.city].filter(Boolean).join(' / ') || '—'}
                </div>
              </div>
              {field('district', t.district, { autoComplete: 'address-level3' })}
              {field('street', t.street, { autoComplete: 'address-line1' })}
              {field('buildingNumber', t.buildingNumber, { optional: true })}
              {field('postalCode', t.postalCode, { optional: true, autoComplete: 'postal-code' })}
              {field('addressLine2', t.addressLine2, { optional: true, autoComplete: 'address-line2' })}
            </section>

            {submitError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{t.error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-neutral-900 py-3.5 text-base font-semibold text-white disabled:opacity-60"
            >
              {submitting ? t.submitting : t.submit}
            </button>
            <a href={contactLink} className="block text-center text-sm text-emerald-700 underline">
              {t.contact}
            </a>
          </form>
        ) : null}
      </div>
    </div>
  );
}
