'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface CODCollection {
  id: string;
  collectionAmount: number;
  collectedAmount?: number;
  currency: string;
  status: string;
  collectedAt?: string;
  depositedAt?: string;
  reconciledAt?: string;
  collectedBy?: string;
  depositedBy?: string;
  reconciledBy?: string;
  depositMethod?: string;
  depositReference?: string;
  discrepancyAmount?: number;
  notes?: string;
  createdAt: string;
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
    shippingCity: string;
    assignment?: {
      deliveryAgent: {
        id: string;
        name: string;
        username: string;
        phone?: string;
      };
    };
  };
}

export default function CODTrackerPage() {
  const { data: session } = useSession();
  const [collections, setCollections] = useState<CODCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<CODCollection | null>(null);
  const [updating, setUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Form fields
  const [newStatus, setNewStatus] = useState('');
  const [depositMethod, setDepositMethod] = useState('');
  const [depositReference, setDepositReference] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [reconciliationNotes, setReconciliationNotes] = useState('');
  const [discrepancyAmount, setDiscrepancyAmount] = useState('');
  const [discrepancyReason, setDiscrepancyReason] = useState('');

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);

      const response = await fetch(`/api/cod-collections?${params.toString()}`);

      if (!response.ok) {
        throw new Error('فشل في تحميل بيانات التحصيل');
      }

      const data = await response.json();
      setCollections(data.collections || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const handleUpdateStatus = async () => {
    if (!selectedCollection || !newStatus) {
      setError('يرجى اختيار الحالة الجديدة');
      return;
    }

    try {
      setUpdating(true);
      setError('');

      const body: any = { status: newStatus };

      if (newStatus === 'deposited') {
        body.depositMethod = depositMethod;
        body.depositReference = depositReference;
        body.depositNotes = depositNotes;
      } else if (newStatus === 'reconciled') {
        body.reconciliationNotes = reconciliationNotes;
        if (discrepancyAmount) {
          body.discrepancyAmount = parseFloat(discrepancyAmount);
          body.discrepancyReason = discrepancyReason;
        }
      }

      const response = await fetch(`/api/cod-collections/${selectedCollection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في تحديث الحالة');
      }

      // Reset form
      setSelectedCollection(null);
      resetForm();

      // Refresh data
      await fetchCollections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    } finally {
      setUpdating(false);
    }
  };

  const resetForm = () => {
    setNewStatus('');
    setDepositMethod('');
    setDepositReference('');
    setDepositNotes('');
    setReconciliationNotes('');
    setDiscrepancyAmount('');
    setDiscrepancyReason('');
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(value);

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: 'قيد الانتظار', className: 'bg-gray-100 text-gray-800' },
      collected: { label: 'تم التحصيل', className: 'bg-green-100 text-green-800' },
      deposited: { label: 'تم الإيداع', className: 'bg-blue-100 text-blue-800' },
      reconciled: { label: 'تمت التسوية', className: 'bg-purple-100 text-purple-800' },
      failed: { label: 'فشل', className: 'bg-red-100 text-red-800' },
    };

    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  // Calculate totals
  const totals = {
    total: collections.reduce((sum, c) => sum + Number(c.collectionAmount), 0),
    collected: collections
      .filter((c) => c.status === 'collected' || c.status === 'deposited' || c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    deposited: collections
      .filter((c) => c.status === 'deposited' || c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    reconciled: collections
      .filter((c) => c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    pending: collections
      .filter((c) => c.status === 'pending')
      .reduce((sum, c) => sum + Number(c.collectionAmount), 0),
  };

  const user = session?.user as any;
  const isWarehouse = user?.roles?.includes('warehouse') || user?.role === 'admin';
  const isAccountant = user?.roles?.includes('accountant') || user?.role === 'admin';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Navigation */}
        <nav className="flex justify-center gap-3 mb-8">
          <Link
            href="/warehouse"
            prefetch={false}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            المستودع
          </Link>
          <Link
            href="/local-shipping"
            prefetch={false}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            شحن محلي
          </Link>
          {isWarehouse && (
            <Link
              href="/shipment-assignments"
              prefetch={false}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
            >
              تعيين الشحنات
            </Link>
          )}
          <Link
            href="/cod-tracker"
            prefetch={false}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            تتبع التحصيل
          </Link>
        </nav>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">متابعة تحصيل المبالغ (COD)</h1>
          <p className="text-gray-600">تتبع وإدارة مبالغ الدفع عند الاستلام</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            {error}
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-gray-800">{formatCurrency(totals.total)}</div>
            <div className="text-sm text-gray-600">الإجمالي</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-orange-600">{formatCurrency(totals.pending)}</div>
            <div className="text-sm text-gray-600">قيد الانتظار</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-green-600">{formatCurrency(totals.collected)}</div>
            <div className="text-sm text-gray-600">تم التحصيل</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-blue-600">{formatCurrency(totals.deposited)}</div>
            <div className="text-sm text-gray-600">تم الإيداع</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-purple-600">{formatCurrency(totals.reconciled)}</div>
            <div className="text-sm text-gray-600">تمت التسوية</div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm font-medium text-gray-700">تصفية حسب الحالة:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">الكل</option>
              <option value="pending">قيد الانتظار</option>
              <option value="collected">تم التحصيل</option>
              <option value="deposited">تم الإيداع</option>
              <option value="reconciled">تمت التسوية</option>
              <option value="failed">فشل</option>
            </select>
          </div>
        </Card>

        {/* Collections Table */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">سجل التحصيل</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-right bg-gray-100">
                  <th className="px-3 py-2">رقم الطلب</th>
                  <th className="px-3 py-2">العميل</th>
                  <th className="px-3 py-2">المندوب</th>
                  <th className="px-3 py-2">المبلغ المطلوب</th>
                  <th className="px-3 py-2">المبلغ المحصّل</th>
                  <th className="px-3 py-2">الحالة</th>
                  <th className="px-3 py-2">تاريخ التحصيل</th>
                  <th className="px-3 py-2">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {collections.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-gray-500 py-6">
                      لا توجد مبالغ للتحصيل
                    </td>
                  </tr>
                ) : (
                  collections.map((collection) => (
                    <tr key={collection.id} className="border-b">
                      <td className="px-3 py-2 font-mono">{collection.shipment.orderNumber}</td>
                      <td className="px-3 py-2">{collection.shipment.customerName}</td>
                      <td className="px-3 py-2">
                        {collection.shipment.assignment?.deliveryAgent.name || '-'}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {formatCurrency(collection.collectionAmount)}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {collection.collectedAmount
                          ? formatCurrency(collection.collectedAmount)
                          : '-'}
                      </td>
                      <td className="px-3 py-2">{getStatusBadge(collection.status)}</td>
                      <td className="px-3 py-2 text-xs">
                        {collection.collectedAt ? formatDate(collection.collectedAt) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {collection.status === 'collected' && isWarehouse && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedCollection(collection);
                              setNewStatus('deposited');
                            }}
                          >
                            تسجيل إيداع
                          </Button>
                        )}
                        {collection.status === 'deposited' && isAccountant && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedCollection(collection);
                              setNewStatus('reconciled');
                            }}
                          >
                            تسوية
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Update Status Modal */}
        {selectedCollection && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-semibold mb-4">
                {newStatus === 'deposited' ? 'تسجيل الإيداع' : 'تسوية المبلغ'}
              </h3>

              <div className="mb-4 bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600 mb-1">
                  الطلب: <span className="font-mono font-semibold">{selectedCollection.shipment.orderNumber}</span>
                </div>
                <div className="text-sm text-gray-600 mb-1">
                  المبلغ: <span className="font-semibold">{formatCurrency(selectedCollection.collectionAmount)}</span>
                </div>
                {selectedCollection.collectedAmount && (
                  <div className="text-sm text-gray-600">
                    المحصّل: <span className="font-semibold">{formatCurrency(selectedCollection.collectedAmount)}</span>
                  </div>
                )}
              </div>

              {newStatus === 'deposited' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      طريقة الإيداع *
                    </label>
                    <select
                      value={depositMethod}
                      onChange={(e) => setDepositMethod(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="">اختر طريقة الإيداع</option>
                      <option value="cash">نقدي</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                      <option value="mobile_wallet">محفظة إلكترونية</option>
                    </select>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      رقم المرجع (اختياري)
                    </label>
                    <input
                      type="text"
                      value={depositReference}
                      onChange={(e) => setDepositReference(e.target.value)}
                      placeholder="رقم المرجع أو رقم العملية"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ملاحظات (اختياري)
                    </label>
                    <textarea
                      value={depositNotes}
                      onChange={(e) => setDepositNotes(e.target.value)}
                      placeholder="ملاحظات الإيداع"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      rows={2}
                    />
                  </div>
                </>
              )}

              {newStatus === 'reconciled' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ملاحظات التسوية (اختياري)
                    </label>
                    <textarea
                      value={reconciliationNotes}
                      onChange={(e) => setReconciliationNotes(e.target.value)}
                      placeholder="ملاحظات التسوية"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      rows={2}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      فرق المبلغ (اختياري)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={discrepancyAmount}
                      onChange={(e) => setDiscrepancyAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {discrepancyAmount && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        سبب الفرق
                      </label>
                      <textarea
                        value={discrepancyReason}
                        onChange={(e) => setDiscrepancyReason(e.target.value)}
                        placeholder="سبب فرق المبلغ"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        rows={2}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handleUpdateStatus}
                  disabled={updating || (newStatus === 'deposited' && !depositMethod)}
                  className="flex-1"
                >
                  {updating ? 'جاري التحديث...' : 'تأكيد'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedCollection(null);
                    resetForm();
                  }}
                  disabled={updating}
                  className="flex-1"
                >
                  إلغاء
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
