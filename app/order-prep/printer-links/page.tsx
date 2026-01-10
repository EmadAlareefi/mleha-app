'use client';

import { useEffect, useMemo, useState } from 'react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Link2, Unlink, Printer } from 'lucide-react';

interface PrinterLink {
  printerId: number;
  printerName?: string | null;
  computerId?: number | null;
  computerName?: string | null;
  paperName?: string | null;
}

interface OrderPrepUser {
  id: string;
  name: string;
  username: string;
  printerLink: PrinterLink | null;
}

interface PrintNodePrinterSummary {
  id: number;
  name: string;
  state?: string;
  description?: string;
  paperName?: string | null;
  computerId?: number | null;
  computerName?: string | null;
  computerState?: string | null;
  computerDescription?: string | null;
}

interface PrinterLinksResponse {
  success: boolean;
  users: OrderPrepUser[];
  printers: PrintNodePrinterSummary[];
  error?: string;
}

export default function PrinterLinksPage() {
  const [users, setUsers] = useState<OrderPrepUser[]>([]);
  const [printers, setPrinters] = useState<PrintNodePrinterSummary[]>([]);
  const [selectedPrinters, setSelectedPrinters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [unlinkingUserId, setUnlinkingUserId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLinkingData();
  }, []);

  const loadLinkingData = async () => {
    setLoading(true);
    setAccessDenied(false);
    setError(null);
    try {
      const response = await fetch('/api/order-prep/printer-links');
      if (response.status === 403) {
        setAccessDenied(true);
        setUsers([]);
        setPrinters([]);
        return;
      }

      const data: PrinterLinksResponse = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحميل بيانات الطابعات');
      }

      setUsers(data.users || []);
      setPrinters(data.printers || []);

      const selections: Record<string, string> = {};
      (data.users || []).forEach((user) => {
        if (user.printerLink?.printerId) {
          selections[user.id] = String(user.printerLink.printerId);
        }
      });
      setSelectedPrinters(selections);
    } catch (err) {
      console.error('Failed to load printer linking data', err);
      setError((err as Error)?.message || 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLink = async (userId: string) => {
    const printerId = selectedPrinters[userId];
    if (!printerId) {
      setError('يرجى اختيار الطابعة أولاً');
      return;
    }

    const printer = printers.find((p) => String(p.id) === printerId);
    if (!printer) {
      setError('الطابعة المختارة غير موجودة');
      return;
    }

    setSavingUserId(userId);
    setError(null);
    try {
      const response = await fetch('/api/order-prep/printer-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          printerId: Number(printerId),
          printerName: printer.name,
          paperName: printer.paperName,
          computerId: printer.computerId,
          computerName: printer.computerName,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'فشل حفظ ارتباط الطابعة');
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId
            ? {
                ...user,
                printerLink: {
                  printerId: Number(printerId),
                  printerName: printer.name,
                  paperName: printer.paperName ?? null,
                  computerId: printer.computerId ?? null,
                  computerName: printer.computerName ?? null,
                },
              }
            : user,
        ),
      );
    } catch (err) {
      console.error('Failed to link printer to user', err);
      setError((err as Error)?.message || 'حدث خطأ أثناء حفظ الربط');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleUnlink = async (userId: string) => {
    setUnlinkingUserId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/order-prep/printer-links?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'فشل إزالة ربط الطابعة');
      }

      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId
            ? {
                ...user,
                printerLink: null,
              }
            : user,
        ),
      );
      setSelectedPrinters((prev) => {
        const updated = { ...prev };
        delete updated[userId];
        return updated;
      });
    } catch (err) {
      console.error('Failed to unlink printer', err);
      setError((err as Error)?.message || 'حدث خطأ أثناء إزالة الربط');
    } finally {
      setUnlinkingUserId(null);
    }
  };

  const availablePrintersLabel = useMemo(() => {
    if (printers.length === 0) {
      return 'لم يتم العثور على طابعات متاحة في PrintNode';
    }
    return `تم العثور على ${printers.length} طابعة مفعّلة في PrintNode`;
  }, [printers.length]);

  const renderAccessDenied = () => (
    <Card className="p-6 text-center text-red-600 font-medium">
      لا تملك الصلاحيات لعرض هذه الصفحة. يجب أن تكون مسؤول النظام.
    </Card>
  );

  const renderTable = () => {
    if (loading) {
      return (
        <div className="py-10 text-center text-gray-500">
          جاري تحميل البيانات...
        </div>
      );
    }

    if (users.length === 0) {
      return (
        <div className="py-10 text-center text-gray-500">
          لا يوجد مستخدمون في فريق تحضير الطلبات حالياً.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-right font-semibold text-gray-600">المستخدم</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-600">اختيار الطابعة</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-600">الطابعة المرتبطة</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-600">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-4">
                  <div className="font-medium text-gray-900">{user.name}</div>
                  <div className="text-xs text-gray-500">@{user.username}</div>
                </td>
                <td className="px-4 py-4">
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none text-sm"
                    value={selectedPrinters[user.id] ?? ''}
                    onChange={(event) =>
                      setSelectedPrinters((prev) => ({
                        ...prev,
                        [user.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">اختر الطابعة من PrintNode</option>
                    {printers.map((printer) => (
                      <option key={printer.id} value={printer.id}>
                        {printer.name} — {printer.computerName || 'جهاز غير معروف'} #{printer.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4 text-sm text-gray-700">
                  {user.printerLink ? (
                    <div className="space-y-1">
                      <div className="font-semibold text-gray-900">
                        {user.printerLink.printerName || `طابعة رقم ${user.printerLink.printerId}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        المعرف: #{user.printerLink.printerId}
                      </div>
                      {user.printerLink.computerName && (
                        <div className="text-xs text-gray-500">
                          الجهاز: {user.printerLink.computerName}
                        </div>
                      )}
                      {user.printerLink.paperName && (
                        <div className="text-xs text-gray-500">
                          الورق: {user.printerLink.paperName}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">لم يتم ربط طابعة بعد</span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="default"
                      className="flex items-center gap-2"
                      onClick={() => handleSaveLink(user.id)}
                      disabled={!selectedPrinters[user.id] || savingUserId === user.id}
                    >
                      <Link2 className="h-4 w-4" />
                      {savingUserId === user.id ? 'جاري الحفظ...' : 'ربط الطابعة'}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex items-center gap-2 text-red-600 hover:text-red-700"
                      onClick={() => handleUnlink(user.id)}
                      disabled={!user.printerLink || unlinkingUserId === user.id}
                    >
                      <Unlink className="h-4 w-4" />
                      {unlinkingUserId === user.id ? 'جاري الإزالة...' : 'إزالة الربط'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <AppNavbar
        title="ربط مستخدمي التحضير بالطابعات"
        subtitle="اربط كل مستخدم في فريق تجهيز الطلبات بطابعة PrintNode"
      />

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <Card className="p-4 border-red-200 bg-red-50 text-red-600 text-sm">
            {error}
          </Card>
        )}

        <Card className="p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">الطابعات المتاحة</h2>
            <p className="text-sm text-gray-600 mt-1">{availablePrintersLabel}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="flex items-center gap-2" onClick={loadLinkingData}>
              <RefreshCw className="h-4 w-4" />
              تحديث القائمة من PrintNode
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {printers.map((printer) => (
              <div key={printer.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-gray-900 font-medium">
                  <Printer className="h-4 w-4" />
                  {printer.name}
                </div>
                <div className="mt-2 text-xs text-gray-500 space-y-1">
                  <div>رقم الطابعة: #{printer.id}</div>
                  {printer.computerName && (
                    <div>الجهاز: {printer.computerName}{printer.computerId ? ` (#${printer.computerId})` : ''}</div>
                  )}
                  {printer.paperName && <div>الورق الافتراضي: {printer.paperName}</div>}
                  <div className="capitalize">
                    حالة الطابعة: {printer.state || 'غير معروفة'}
                  </div>
                </div>
              </div>
            ))}
            {printers.length === 0 && !loading && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                لا توجد طابعات مفعلة في PrintNode. يرجى التأكد من تثبيت التطبيق على أجهزة الطباعة.
              </div>
            )}
          </div>
        </Card>

        {accessDenied ? (
          renderAccessDenied()
        ) : (
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">مستخدمو تحضير الطلبات</h2>
                <p className="text-sm text-gray-500 mt-1">
                  اختر الطابعة المناسبة لكل مستخدم وسيتم استخدامها عند إرسال طلبات الطباعة من صفحة التحضير.
                </p>
              </div>
            </div>
            {renderTable()}
          </Card>
        )}
      </main>
    </div>
  );
}
