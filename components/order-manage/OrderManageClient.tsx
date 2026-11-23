'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { OrderView } from './OrderView';
import { supportLink, type ManageOrderResponse } from './types';

type Step = 'loading' | 'unavailable' | 'lookup' | 'code' | 'order';

const API = '/api/public/order-manage';

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data: data as Record<string, any> };
}

const GENERIC_ERROR = 'حدث خطأ، يرجى المحاولة مرة أخرى.';

export function OrderManageClient({ initialOrderNumber }: { initialOrderNumber: string }) {
  const [step, setStep] = useState<Step>('loading');
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [data, setData] = useState<ManageOrderResponse | null>(null);

  /** Loads the order behind the session cookie; false when there is no session. */
  const loadOrder = useCallback(async (): Promise<boolean> => {
    const response = await fetch(`${API}/order`, { cache: 'no-store' });
    if (response.status === 503) {
      setStep('unavailable');
      return true;
    }
    if (!response.ok) return false;
    const body = await response.json();
    setData({ order: body.order, actions: body.actions });
    setStep('order');
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetch(`${API}/config`, { cache: 'no-store' }).then((response) => response.json());
        if (cancelled) return;
        if (!config?.enabled) return setStep('unavailable');
        if (!(await loadOrder()) && !cancelled) setStep('lookup');
      } catch {
        if (!cancelled) setStep('lookup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrder]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const requestCode = async (channel?: 'sms') => {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson('start', { orderNumber, mobile, channel });
      if (result.status === 503) return setStep('unavailable');
      if (result.ok) {
        setCode('');
        setResendIn(60);
        setStep('code');
        return;
      }
      if (result.data.code === 'wait') {
        // A code is already on its way: let the customer type it.
        setResendIn(Number(result.data.retryAfterSeconds) || 60);
        setStep('code');
        return;
      }
      setError(result.data.error || GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const submitLookup = (event: FormEvent) => {
    event.preventDefault();
    void requestCode();
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postJson('verify', { orderNumber, mobile, code });
      if (result.status === 503) return setStep('unavailable');
      if (!result.ok) return setError(result.data.error || GENERIC_ERROR);
      if (!(await loadOrder())) setError(GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await postJson('logout', {}).catch(() => undefined);
    setData(null);
    setCode('');
    setError(null);
    setStep('lookup');
  };

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-4">
        <header className="text-center">
          <h1 className="text-2xl font-bold">إدارة طلبي</h1>
          <p className="mt-1 text-sm text-gray-600">إلغاء الطلب أو تعديله قبل البدء في تجهيزه</p>
        </header>

        {step === 'loading' && (
          <Card className="p-8 text-center text-gray-500" aria-busy="true">
            جاري التحميل...
          </Card>
        )}

        {step === 'unavailable' && (
          <Card className="space-y-4 p-6 text-center">
            <p className="font-medium">هذه الخدمة غير متاحة حالياً.</p>
            <p className="text-sm text-gray-600">يمكنك التواصل مع خدمة العملاء لتعديل طلبك أو إلغائه.</p>
            <Button asChild variant="outline" className="w-full py-6 text-base">
              <a href={supportLink(orderNumber || undefined, 'تعديل طلبي')} target="_blank" rel="noopener noreferrer">
                التواصل عبر واتساب
              </a>
            </Button>
          </Card>
        )}

        {step === 'lookup' && (
          <Card className="p-6">
            <form onSubmit={submitLookup} className="space-y-5">
              <div>
                <label htmlFor="om-order" className="mb-2 block text-sm font-medium">
                  رقم الطلب
                </label>
                <input
                  id="om-order"
                  type="text"
                  inputMode="numeric"
                  value={orderNumber}
                  onChange={(event) => setOrderNumber(event.target.value)}
                  placeholder="مثال: 251263484"
                  className="w-full rounded-lg border px-4 py-3 text-lg"
                  required
                  disabled={busy}
                />
              </div>
              <div>
                <label htmlFor="om-mobile" className="mb-2 block text-sm font-medium">
                  رقم الجوال
                </label>
                <input
                  id="om-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value)}
                  placeholder="05XXXXXXXX"
                  className="w-full rounded-lg border px-4 py-3 text-lg"
                  required
                  disabled={busy}
                />
                <p className="mt-2 text-sm text-gray-500">رقم الجوال المستخدم عند إنشاء الطلب. سنرسل إليه رمز تحقق.</p>
              </div>
              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <Button type="submit" disabled={busy || !orderNumber.trim() || !mobile.trim()} className="w-full py-6 text-lg">
                {busy ? 'جاري الإرسال...' : 'إرسال رمز التحقق'}
              </Button>
            </form>
          </Card>
        )}

        {step === 'code' && (
          <Card className="p-6">
            <form onSubmit={submitCode} className="space-y-5">
              <p className="text-sm leading-relaxed text-gray-700">
                إذا كانت البيانات صحيحة فسيصلك رمز تحقق من 6 أرقام على جوال الطلب رقم <span className="font-semibold">{orderNumber}</span>.
              </p>
              <div>
                <label htmlFor="om-code" className="mb-2 block text-sm font-medium">
                  رمز التحقق
                </label>
                <input
                  id="om-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="w-full rounded-lg border px-4 py-3 text-center text-2xl tracking-[0.4em]"
                  required
                  autoFocus
                  disabled={busy}
                />
              </div>
              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <Button type="submit" disabled={busy || code.trim().length < 6} className="w-full py-6 text-lg">
                {busy ? 'جاري التحقق...' : 'تأكيد'}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  className="min-h-11 text-gray-600 underline disabled:no-underline disabled:opacity-50"
                  disabled={busy || resendIn > 0}
                  onClick={() => void requestCode('sms')}
                >
                  {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ثانية` : 'إرسال الرمز برسالة نصية'}
                </button>
                <button
                  type="button"
                  className="min-h-11 text-gray-600 underline"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep('lookup');
                  }}
                >
                  تغيير رقم الطلب
                </button>
              </div>
            </form>
          </Card>
        )}

        {step === 'order' && data && <OrderView data={data} onRefresh={loadOrder} onSignOut={signOut} />}
      </div>
    </main>
  );
}
