'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface ReturnItem {
  id: string;
  productName: string;
  productSku?: string;
  variantName?: string;
  quantity: number;
  price: number;
}

interface ReturnRequest {
  id: string;
  orderNumber: string;
  type: 'return' | 'exchange';
  status: string;
  reason: string;
  reasonDetails?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  smsaTrackingNumber?: string;
  totalRefundAmount?: number;
  returnFee?: number;
  couponCode?: string;
  couponId?: string;
  adminNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  items: ReturnItem[];
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved: 'bg-blue-100 text-blue-800 border-blue-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  shipped: 'bg-purple-100 text-purple-800 border-purple-300',
  delivered: 'bg-green-100 text-green-800 border-green-300',
  completed: 'bg-gray-100 text-gray-800 border-gray-300',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-300',
};

const gregorianDateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

export default function ReturnsManagementPage() {
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'return' | 'exchange'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Selected request for modal
  const [selectedRequest, setSelectedRequest] = useState<ReturnRequest | null>(null);

  useEffect(() => {
    loadReturnRequests();
  }, [typeFilter, statusFilter, searchQuery, page]);

  const loadReturnRequests = async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      });

      if (typeFilter !== 'all') {
        params.append('type', typeFilter);
      }

      if (statusFilter) {
        params.append('status', statusFilter);
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      const response = await fetch(`/api/returns/list?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل جلب طلبات الإرجاع');
      }

      setReturnRequests(data.data);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (requestId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/returns/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: requestId,
          status: newStatus,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديث الحالة');
      }

      // Reload data
      loadReturnRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const createCoupon = async (requestId: string, amount: number) => {
    try {
      const response = await fetch('/api/returns/create-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: requestId,
          amount,
          expiryDays: 30,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's a permission error
        if (data.error?.includes('صلاحيات') || data.error?.includes('marketing')) {
          // Show manual coupon entry option
          const manualCode = prompt(
            'لا يمكن إنشاء الكوبون تلقائياً بسبب صلاحيات غير كافية.\n\n' +
            'يرجى إنشاء الكوبون يدوياً من لوحة تحكم سلة ثم إدخال رمز الكوبون هنا:\n\n' +
            `المبلغ المقترح: ${amount.toFixed(2)} ر.س`
          );

          if (manualCode && manualCode.trim()) {
            await assignManualCoupon(requestId, manualCode.trim());
            return;
          }
        }

        throw new Error(data.error || 'فشل إنشاء الكوبون');
      }

      alert(`تم إنشاء الكوبون بنجاح: ${data.coupon.code}`);
      loadReturnRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const assignManualCoupon = async (requestId: string, couponCode: string) => {
    try {
      const response = await fetch('/api/returns/manual-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: requestId,
          couponCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تعيين الكوبون');
      }

      alert(`تم تعيين الكوبون بنجاح: ${couponCode}`);
      loadReturnRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">إدارة طلبات الإرجاع والاستبدال</h1>
            <p className="text-gray-600">
              إجمالي الطلبات: {total}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/returns-priority">
              <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                ⚡ الطلبات عالية الأولوية
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-2">بحث</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="رقم الطلب، اسم العميل، رقم التتبع..."
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">النوع</label>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full px-4 py-2 border rounded-lg"
              >
                <option value="all">الكل</option>
                <option value="return">إرجاع</option>
                <option value="exchange">استبدال</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">الحالة</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-4 py-2 border rounded-lg"
              >
                <option value="">الكل</option>
                <option value="pending_review">قيد المراجعة</option>
                <option value="approved">مقبول</option>
                <option value="rejected">مرفوض</option>
                <option value="shipped">تم الشحن</option>
                <option value="delivered">تم التسليم</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        ) : returnRequests.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-gray-500 text-lg">لا توجد طلبات</p>
          </Card>
        ) : (
          <>
            {/* Return Requests List */}
            <div className="space-y-4">
              {returnRequests.map((request) => (
                <Card key={request.id} className="p-6 hover:shadow-lg transition-shadow">
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Request Info */}
                    <div className="lg:col-span-2">
                      <div className="flex items-start gap-3 mb-3">
                        <div
                          className={`px-3 py-1 rounded-full text-sm font-medium border ${
                            request.type === 'return'
                              ? 'bg-orange-100 text-orange-800 border-orange-300'
                              : 'bg-blue-100 text-blue-800 border-blue-300'
                          }`}
                        >
                          {request.type === 'return' ? 'إرجاع' : 'استبدال'}
                        </div>
                        <div
                          className={`px-3 py-1 rounded-full text-sm font-medium border ${
                            STATUS_COLORS[request.status] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {STATUS_LABELS[request.status] || request.status}
                        </div>
                      </div>

                      <h3 className="font-semibold text-lg mb-2">
                        طلب #{request.orderNumber}
                      </h3>

                      <div className="text-sm text-gray-600 space-y-1">
                        <p><strong>العميل:</strong> {request.customerName}</p>
                        <p><strong>الهاتف:</strong> {request.customerPhone}</p>
                        {request.smsaTrackingNumber && (
                          <p><strong>رقم التتبع:</strong> {request.smsaTrackingNumber}</p>
                        )}
                        <p>
                          <strong>التاريخ:</strong> {gregorianDateFormatter.format(new Date(request.createdAt))}
                        </p>
                        <p><strong>السبب:</strong> {request.reason}</p>
                        {request.reasonDetails && (
                          <p className="text-gray-500 text-xs mt-1">{request.reasonDetails}</p>
                        )}
                      </div>
                    </div>

                    {/* Items */}
                    <div className="lg:col-span-2">
                      <h4 className="font-medium mb-2">المنتجات:</h4>
                      <div className="space-y-1 text-sm">
                        {request.items.map((item) => (
                          <div key={item.id} className="flex justify-between">
                            <span>{item.productName} {item.variantName ? `(${item.variantName})` : ''}</span>
                            <span className="text-gray-600">x{item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {request.totalRefundAmount !== null && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="flex justify-between font-semibold">
                            <span>المبلغ المسترد:</span>
                            <span className="text-green-600">{Number(request.totalRefundAmount).toFixed(2)} ر.س</span>
                          </div>
                        </div>
                      )}

                      {request.couponCode && (
                        <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                          <p className="text-sm font-medium text-green-800">
                            كود الكوبون: {request.couponCode}
                          </p>
                        </div>
                      )}

                      {request.adminNotes && (
                        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                          <p className="text-xs font-medium text-blue-800 mb-1">ملاحظات الإدارة:</p>
                          <p className="text-sm text-blue-900">{request.adminNotes}</p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="space-y-2">
                      <select
                        value={request.status}
                        onChange={(e) => updateStatus(request.id, e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="pending_review">قيد المراجعة</option>
                        <option value="approved">مقبول</option>
                        <option value="rejected">مرفوض</option>
                        <option value="shipped">تم الشحن</option>
                        <option value="delivered">تم التسليم</option>
                        <option value="completed">مكتمل</option>
                        <option value="cancelled">ملغي</option>
                      </select>

                      {request.type === 'exchange' && !request.couponCode && request.totalRefundAmount && (
                        <Button
                          onClick={() => createCoupon(request.id, Number(request.totalRefundAmount))}
                          className="w-full"
                          variant="outline"
                        >
                          إنشاء كوبون
                        </Button>
                      )}

                      <Button
                        onClick={() => setSelectedRequest(request)}
                        variant="outline"
                        className="w-full"
                      >
                        التفاصيل
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                <Button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  variant="outline"
                >
                  السابق
                </Button>
                <div className="flex items-center gap-2 px-4">
                  <span className="text-sm">
                    صفحة {page} من {totalPages}
                  </span>
                </div>
                <Button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  variant="outline"
                >
                  التالي
                </Button>
              </div>
            )}
          </>
        )}

        {/* Details Modal */}
        {selectedRequest && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">تفاصيل الطلب #{selectedRequest.orderNumber}</h2>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">معلومات العميل</h3>
                  <div className="text-sm space-y-1">
                    <p><strong>الاسم:</strong> {selectedRequest.customerName}</p>
                    <p><strong>الهاتف:</strong> {selectedRequest.customerPhone}</p>
                    <p><strong>البريد:</strong> {selectedRequest.customerEmail}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">السبب</h3>
                  <p className="text-sm">{selectedRequest.reason}</p>
                  {selectedRequest.reasonDetails && (
                    <p className="text-sm text-gray-600 mt-1">{selectedRequest.reasonDetails}</p>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold mb-2">المنتجات</h3>
                  {selectedRequest.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm py-2 border-b">
                      <span>{item.productName}</span>
                      <span>x{item.quantity} - {Number(item.price).toFixed(2)} ر.س</span>
                    </div>
                  ))}
                </div>

                {selectedRequest.adminNotes && (
                  <div>
                    <h3 className="font-semibold mb-2">ملاحظات الإدارة</h3>
                    <p className="text-sm">{selectedRequest.adminNotes}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-3">
                <Button onClick={() => setSelectedRequest(null)} className="flex-1">
                  إغلاق
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
