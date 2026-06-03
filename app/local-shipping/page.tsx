'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useReactToPrint } from 'react-to-print';
import ShippingLabel from '@/components/local-shipping/ShippingLabel';

// Configuration
const MERCHANT_CONFIG = {
  merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876',
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر سلة',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0501234567',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'شارع الملك فهد، الرياض',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
  logoUrl: process.env.NEXT_PUBLIC_MERCHANT_LOGO || '/logo.png',
};

const todayIso = () => new Date().toISOString().split('T')[0];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(
    Number.isFinite(value) ? value : 0
  );

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: 'تم الإسناد',
  picked_up: 'مستلمة من المتجر',
  in_transit: 'قيد التوصيل',
  delivered: 'تم التسليم',
  failed: 'فشل التسليم',
  cancelled: 'ألغيت',
};

const getAssignmentStatusLabel = (status?: string | null) =>
  status ? ASSIGNMENT_STATUS_LABELS[status] || status : '';

interface DeliveryAgentOption {
  id: string;
  name: string;
  username: string;
  phone?: string | null;
  isActive?: boolean;
}

const normalizeAgentText = (value: string | null | undefined): string => {
  if (!value) return '';
  return value.toString().replace(/\s+/g, '').toLowerCase();
};

const PREFERRED_AGENT_ID = '11';
const PREFERRED_AGENT_USERNAME = '11';
const PREFERRED_AGENT_NAME_NORMALIZED = normalizeAgentText('سعيد');

const isPreferredDeliveryAgent = (agent: DeliveryAgentOption): boolean => {
  const normalizedName = normalizeAgentText(agent.name);
  return (
    agent.id === PREFERRED_AGENT_ID ||
    agent.username === PREFERRED_AGENT_USERNAME ||
    (normalizedName ? normalizedName.includes(PREFERRED_AGENT_NAME_NORMALIZED) : false)
  );
};

export default function LocalShippingPage() {
  const [orderNumber, setOrderNumber] = useState('');
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [dateRange, setDateRange] = useState({
    start: todayIso(),
    end: todayIso(),
  });
  const labelRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: labelRef,
    documentTitle: `Shipping-Label-${shipment?.orderNumber || orderNumber || 'local'}`,
  });

  const handlePrintClick = () => {
    if (!labelRef.current) {
      setError('لا يوجد ملصق متاح للطباعة بعد');
      return;
    }

    try {
      handlePrint?.();
    } catch {
      setError('حدث خطأ أثناء محاولة الطباعة، جرّب مرة أخرى.');
    }
  };

  const fetchDeliveryAgents = useCallback(async () => {
    try {
      setAgentsLoading(true);
      setAgentsError('');
      const response = await fetch('/api/delivery-agents');
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'تعذر تحميل قائمة المناديب');
      }

      const agents = Array.isArray(data.deliveryAgents)
        ? data.deliveryAgents.filter((agent: DeliveryAgentOption) => agent?.isActive !== false)
        : [];
      setDeliveryAgents(agents);
      const preferredAgent = agents.find(isPreferredDeliveryAgent) ?? agents[0];
      setSelectedAgentId((current) => current || preferredAgent?.id || '');
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المناديب');
      setDeliveryAgents([]);
      setSelectedAgentId('');
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const handleGenerateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!selectedAgentId) {
      setError('اختر مندوب التوصيل قبل إنشاء الملصق حتى تظهر الشحنة في صفحة المندوب.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/local-shipping/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_CONFIG.merchantId,
          orderNumber: orderNumber.trim(),
          generatedBy: 'admin',
          deliveryAgentId: selectedAgentId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في إنشاء ملصق الشحن');
      }

      setShipment(data.shipment);
      setInfo(
        data.reused
          ? 'تم العثور على ملصق سابق لهذا الطلب وتم تأكيد تعيينه للمندوب.'
          : 'تم إنشاء الملصق وتعيينه للمندوب.'
      );
      fetchHistory(dateRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOrderNumber('');
    setShipment(null);
    setError('');
    setInfo('');
  };

  async function fetchHistory(range = dateRange) {
    try {
      setHistoryLoading(true);
      setHistoryError('');

      const params = new URLSearchParams({
        merchantId: MERCHANT_CONFIG.merchantId,
        startDate: range.start,
        endDate: range.end,
      });

      const response = await fetch(`/api/local-shipping/list?${params.toString()}`);
      const contentType = response.headers.get('content-type') || '';

      const parseJson = async () => {
        try {
          return await response.json();
        } catch {
          return null;
        }
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('لا تملك صلاحية للوصول إلى سجل الشحنات. يرجى تسجيل الدخول بحساب مخوّل.');
        }
        const data = contentType.includes('application/json') ? await parseJson() : null;
        const text = !contentType.includes('application/json') ? await response.text() : null;
        throw new Error(data?.error || text || 'تعذر تحميل الشحنات');
      }

      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'استجابة غير متوقعة من الخادم، يرجى إعادة المحاولة.');
      }

      const data = await response.json();
      setHistory(data.shipments || []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل السجل');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    fetchDeliveryAgents();
    fetchHistory({ start: todayIso(), end: todayIso() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchDeliveryAgents]);

  const handleHistorySubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchHistory();
  };

  const handleRangeChange = (key: 'start' | 'end', value: string) => {
    setDateRange((prev) => ({ ...prev, [key]: value }));
  };

  const handleHistorySelect = (record: any) => {
    setShipment(record);
    setInfo('تم تحميل الملصق من سجل الشحنات.');
    setTimeout(() => {
      labelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <AppPageShell title="إنشاء ملصق شحن محلي" subtitle="أدخل رقم الطلب لإنشاء ملصق شحن للمنطقة المحلية">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <nav className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/warehouse" prefetch={false}>المستودع</Link>
          </Button>
          <Button asChild>
            <Link href="/local-shipping" prefetch={false}>شحن محلي</Link>
          </Button>
        </nav>

        {!shipment && (
          <Card>
            <CardHeader>
              <CardTitle>بيانات الطلب</CardTitle>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleGenerateLabel} className="space-y-6">
              <Field>
                <FieldLabel htmlFor="orderNumber">رقم الطلب</FieldLabel>
                <Input
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="أدخل رقم الطلب (مثال: 2095468130)"
                  required
                  disabled={loading}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="deliveryAgentId">مندوب التوصيل</FieldLabel>
                <NativeSelect
                  id="deliveryAgentId"
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  disabled={loading || agentsLoading || deliveryAgents.length === 0}
                  required
                >
                  <NativeSelectOption value="">
                    {agentsLoading ? 'جاري تحميل المناديب...' : 'اختر المندوب'}
                  </NativeSelectOption>
                  {deliveryAgents.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name || agent.username}
                      {isPreferredDeliveryAgent(agent) ? ' - الافتراضي' : ''}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              {(error || info || agentsError) && (
                <Alert variant={error ? 'destructive' : 'default'}>
                  <AlertDescription>{error || info || agentsError}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || agentsLoading || !orderNumber.trim() || !selectedAgentId}
              >
                {loading ? 'جاري الإنشاء...' : 'إنشاء ملصق الشحن'}
              </Button>
            </form>
            </CardContent>
          </Card>
        )}

        {shipment && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-8">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-green-600 mb-2">
                  تم إنشاء ملصق الشحن بنجاح
                </h2>
                <p className="text-gray-600">
                  رقم التتبع: <span className="font-mono font-bold">{shipment.trackingNumber}</span>
                </p>
                {typeof shipment.collectionAmount === 'number' && (
                  <p className="text-sm text-gray-500 mt-2">
                    مبلغ التحصيل:
                    <span className="font-semibold text-gray-800 ml-1">
                      {formatCurrency(shipment.collectionAmount)}
                    </span>
                  </p>
                )}
                {shipment.assignedAgentName && (
                  <p className="text-sm text-gray-600 mt-3">
                    المندوب المسؤول:
                    <span className="font-semibold text-gray-900 ml-1">
                      {shipment.assignedAgentName}
                    </span>
                    {shipment.assignedAgentPhone && (
                      <span className="ml-1 text-xs text-gray-500" dir="ltr">
                        {shipment.assignedAgentPhone}
                      </span>
                    )}
                    {shipment.assignmentStatus && (
                      <Badge variant="secondary" className="ml-2">
                        {getAssignmentStatusLabel(shipment.assignmentStatus)}
                      </Badge>
                    )}
                  </p>
                )}
              </div>

              <div className="flex gap-4 justify-center mb-6">
                <Button onClick={handlePrintClick} className="flex items-center gap-2" type="button">
                  <Printer className="h-5 w-5" />
                  طباعة الملصق
                </Button>

                <Button onClick={handleReset} variant="outline">
                  إنشاء ملصق جديد
                </Button>
              </div>
              </CardContent>
            </Card>

            <div className="bg-white shadow-lg rounded-lg p-4">
              <ShippingLabel ref={labelRef} shipment={shipment} merchant={MERCHANT_CONFIG} />
            </div>
          </div>
        )}

        <section>
          <Card>
            <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <CardTitle>سجل الشحنات المحلية</CardTitle>
                <p className="text-sm text-gray-500">استعرض الشحنات حسب التاريخ</p>
              </div>
              <form
                onSubmit={handleHistorySubmit}
                className="flex flex-col gap-3 md:flex-row md:items-center"
              >
                <Field>
                  <FieldLabel>من تاريخ</FieldLabel>
                  <Input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => handleRangeChange('start', e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>إلى تاريخ</FieldLabel>
                  <Input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => handleRangeChange('end', e.target.value)}
                    required
                  />
                </Field>
                <Button type="submit" disabled={historyLoading}>
                  {historyLoading ? 'جاري التحميل...' : 'عرض الشحنات'}
                </Button>
              </form>
            </div>
            </CardHeader>
            <CardContent className="space-y-6">

            {historyError && (
              <Alert variant="destructive">
                <AlertDescription>{historyError}</AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>المدينة</TableHead>
                    <TableHead>المندوب</TableHead>
                    <TableHead>مبلغ التحصيل</TableHead>
                    <TableHead>رقم التتبع</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 && !historyLoading && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <EmptyState title="لا توجد شحنات في هذا التاريخ" />
                      </TableCell>
                    </TableRow>
                  )}
                  {history.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(record.createdAt)}</TableCell>
                      <TableCell className="font-mono">{record.orderNumber}</TableCell>
                      <TableCell>{record.customerName}</TableCell>
                      <TableCell>{record.shippingCity}</TableCell>
                      <TableCell>
                        {record.assignedAgentName ? (
                          <div className="space-y-1 text-sm">
                            <p className="font-semibold text-gray-900">{record.assignedAgentName}</p>
                            {record.assignedAgentPhone && (
                              <p className="text-xs text-gray-500" dir="ltr">
                                {record.assignedAgentPhone}
                              </p>
                            )}
                            {record.assignmentStatus && (
                              <Badge variant="secondary">
                                {getAssignmentStatusLabel(record.assignmentStatus)}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">لم يُحدد</span>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(record.collectionAmount ?? 0)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{record.trackingNumber}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" type="button" onClick={() => handleHistorySelect(record)}>
                          عرض الملصق
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppPageShell>
  );
}
