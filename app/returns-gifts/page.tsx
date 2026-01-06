'use client';

import { useState, useMemo, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AssignmentSummary = {
  orderId: string;
  orderNumber: string;
  status: string;
  assignedUserName: string;
  assignedAt: string;
  source?: string;
  orderData: any;
};

type GiftFlag = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  reason: string | null;
  notes: string | null;
  createdByName: string | null;
  createdByUsername: string | null;
  createdAt: string;
};

type FeedbackState = {
  type: 'success' | 'error';
  message: string;
} | null;

const formatDate = (value?: string | null) => {
  if (!value) {
    return 'غير متوفر';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'غير متوفر';
  }
  return date.toLocaleString('ar-SA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getCustomerInfo = (orderData: any) => {
  if (!orderData) {
    return { name: 'غير محدد', phone: '—', city: '—' };
  }

  const customer =
    orderData.customer ||
    orderData.customer_info ||
    orderData.customerInfo ||
    {};

  const shipping =
    orderData.shipping_address ||
    orderData.shippingAddress ||
    {};

  const name =
    customer.name ||
    customer.full_name ||
    customer.first_name ||
    shipping.name ||
    'غير محدد';

  const phoneCandidates = [
    customer.phone,
    customer.mobile,
    customer.mobile_number,
    customer.mobileNumber,
    shipping.phone,
    shipping.mobile,
  ];

  const phone =
    phoneCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) ||
    '—';

  const city =
    shipping.city ||
    shipping.city_name ||
    shipping.cityName ||
    customer.city ||
    '—';

  return { name, phone, city };
};

export default function GiftFlagManagerPage() {
  const { data: session, status } = useSession();
  const baseRole = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || (baseRole ? [baseRole] : [])) as string[];
  const hasAccess = roles.includes('admin') || roles.includes('store_manager');

  const [searchQuery, setSearchQuery] = useState('');
  const [assignment, setAssignment] = useState<AssignmentSummary | null>(null);
  const [giftFlag, setGiftFlag] = useState<GiftFlag | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const customerInfo = useMemo(() => getCustomerInfo(assignment?.orderData), [assignment]);

  const resetState = () => {
    setAssignment(null);
    setGiftFlag(null);
    setReason('');
    setNotes('');
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!searchQuery.trim()) {
      setFeedback({ type: 'error', message: 'يرجى إدخال رقم الطلب أو مرجع البحث.' });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/order-assignments/search?query=${encodeURIComponent(searchQuery.trim())}`);
      const data = await response.json();

      if (!response.ok || !data?.assignment) {
        resetState();
        setFeedback({
          type: 'error',
          message: data?.error || 'تعذر العثور على الطلب.',
        });
        return;
      }

      const assignmentPayload: AssignmentSummary = {
        orderId: data.assignment.orderId,
        orderNumber: data.assignment.orderNumber,
        status: data.assignment.status,
        assignedUserName: data.assignment.assignedUserName,
        assignedAt: data.assignment.assignedAt,
        source: data.assignment.source,
        orderData: data.assignment.orderData,
      };

      setAssignment(assignmentPayload);
      const latestFlag: GiftFlag | null = data.assignment.giftFlag || null;
      setGiftFlag(latestFlag);
      setReason(latestFlag?.reason || '');
      setNotes(latestFlag?.notes || '');

      setFeedback({
        type: 'success',
        message: 'تم العثور على الطلب بنجاح.',
      });
    } catch (error) {
      console.error('Failed to search order', error);
      resetState();
      setFeedback({
        type: 'error',
        message: 'حدث خطأ أثناء البحث عن الطلب.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkGift = async () => {
    if (!assignment) return;
    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/order-gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: assignment.orderId,
          orderNumber: assignment.orderNumber,
          reason,
          notes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setFeedback({
          type: 'error',
          message: data?.error || 'تعذر حفظ علامة الهدية.',
        });
        return;
      }

      setGiftFlag(data.giftFlag);
      setFeedback({
        type: 'success',
        message: 'تم حفظ علامة الهدية بنجاح.',
      });
    } catch (error) {
      console.error('Failed to save gift flag', error);
      setFeedback({
        type: 'error',
        message: 'حدث خطأ أثناء حفظ علامة الهدية.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFlag = async () => {
    if (!assignment) return;
    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/order-gifts?orderId=${encodeURIComponent(assignment.orderId)}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!response.ok) {
        setFeedback({
          type: 'error',
          message: data?.error || 'تعذر إزالة علامة الهدية.',
        });
        return;
      }

      setGiftFlag(null);
      setFeedback({
        type: 'success',
        message: data?.message || 'تمت إزالة علامة الهدية.',
      });
    } catch (error) {
      console.error('Failed to remove gift flag', error);
      setFeedback({
        type: 'error',
        message: 'حدث خطأ أثناء إزالة علامة الهدية.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-600">جاري التحقق من الصلاحيات...</div>
      </div>
    );
  }

  if (status === 'authenticated' && !hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppNavbar />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <Card className="border-red-200 bg-red-50 p-6 text-center text-red-700">
            ليس لديك صلاحية الوصول إلى صفحة علامات الهدايا.
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AppNavbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">علامات تغليف الهدايا</h1>
          <p className="mt-2 text-gray-600">
            ابحث عن الطلبات وحدد ما إذا كانت تحتاج إلى إظهار تنبيه تغليف هدية لفريق التحضير.
          </p>
        </div>

        <Card className="mb-6 p-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                رقم الطلب أو رقم المرجع
              </label>
              <div className="flex gap-3 flex-col md:flex-row">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="مثال: 123456 أو #12345"
                  className="flex-1"
                  disabled={loading || saving}
                />
                <Button
                  type="submit"
                  className="shrink-0"
                  disabled={loading || saving}
                >
                  {loading ? 'جاري البحث...' : 'بحث'}
                </Button>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              يمكنك البحث برقم الطلب، المرجع، أو رقم تتبع العميل.
            </p>
          </form>
        </Card>

        {feedback && (
          <div
            className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {assignment && (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
                    الطلب #{assignment.orderNumber}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                    {assignment.source === 'history'
                      ? 'من السجل'
                      : assignment.source === 'salla'
                        ? 'من سلة'
                        : 'تعيين نشط'}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-gray-500">الحالة الحالية</p>
                    <p className="text-lg font-semibold text-gray-900">{assignment.status}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">المستخدم المسؤول</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {assignment.assignedUserName || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">العميل</p>
                    <p className="text-lg font-semibold text-gray-900">{customerInfo.name}</p>
                    <p className="text-sm text-gray-600">{customerInfo.phone}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">المدينة</p>
                    <p className="text-lg font-semibold text-gray-900">{customerInfo.city}</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
                  <span>🎁</span>
                  تنبيه تغليف الهدية
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  يتم عرض هذا التنبيه فور بدء تحضير الطلب في صفحة تحضير الطلبات.
                </p>
              </div>

              {giftFlag && (
                <div className="rounded-lg border border-pink-200 bg-pink-50 p-4">
                  <p className="text-sm font-semibold text-pink-800">
                    تم وضع علامة كهدية بتاريخ {formatDate(giftFlag.createdAt)}
                  </p>
                  <p className="text-sm text-pink-700 mt-1">
                    بواسطة: {giftFlag.createdByName || giftFlag.createdByUsername || 'غير معروف'}
                  </p>
                  {(giftFlag.reason || giftFlag.notes) && (
                    <div className="mt-2 space-y-1 text-sm text-pink-800">
                      {giftFlag.reason && <p>السبب: {giftFlag.reason}</p>}
                      {giftFlag.notes && <p>ملاحظات إضافية: {giftFlag.notes}</p>}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    السبب الرئيسي
                  </label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
                    placeholder="مثال: تعليمات العميل أو حالة المنتج."
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    ملاحظات إضافية
                  </label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
                    placeholder="تفاصيل تساعد فريق التحضير (اختياري)."
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-col gap-3 md:flex-row">
                  <Button
                    type="button"
                    onClick={handleMarkGift}
                    disabled={saving}
                    className="bg-pink-600 hover:bg-pink-700"
                  >
                    {saving ? 'جاري الحفظ...' : 'حفظ علامة الهدية'}
                  </Button>
                  {giftFlag && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRemoveFlag}
                      disabled={saving}
                      className="border-red-200 text-red-700 hover:bg-red-50"
                    >
                      إزالة العلامة
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
