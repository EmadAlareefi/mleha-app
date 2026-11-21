import type { Metadata } from 'next';
import { verifyShippingInfoLink } from '@/app/lib/shipping-info/links';
import { defaultLanguageFor, initialFormValues } from '@/app/lib/shipping-info/rules';
import { loadRequestForCustomer } from '@/app/lib/shipping-info/service';
import { ShippingInfoForm } from '@/components/shipping-info/ShippingInfoForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Mleha · Shipping details | مليحة · بيانات الشحن',
  robots: { index: false },
};

/**
 * Public page from the WhatsApp link: the customer completes the shipping info
 * of an international order (3-part name, district, street). The signed link
 * is the only credential.
 */
export default async function ShippingInfoPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string; orderId: string }>;
  searchParams: Promise<{ exp?: string; sig?: string; lang?: string }>;
}) {
  const { merchantId, orderId } = await params;
  const { exp, sig, lang } = await searchParams;
  const expiresAt = Number(exp);
  const signature = typeof sig === 'string' ? sig : '';
  const valid = verifyShippingInfoLink({ merchantId, orderId, expiresAt, signature });
  const view = valid ? await loadRequestForCustomer(merchantId, orderId) : null;

  const language = lang === 'en' || lang === 'ar' ? lang : defaultLanguageFor(view?.countryCode ?? '');
  const state = !valid || !view ? 'invalid' : view.state;

  return (
    <ShippingInfoForm
      initialLanguage={language}
      state={state}
      merchantId={merchantId}
      orderId={orderId}
      exp={expiresAt}
      sig={signature}
      orderNumber={view?.orderNumber ?? ''}
      country={view?.country ?? ''}
      city={view?.city ?? ''}
      missingFields={view?.missingFields ?? []}
      initialValues={view ? initialFormValues(view.rawOrder) : null}
    />
  );
}
