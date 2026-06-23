'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { LockKeyhole, PackagePlus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { PublicPageShell } from '@/components/dashboard/public-page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type GateFabric = {
  id: string;
  name: string;
  sku?: string | null;
  color?: string | null;
  fabricType?: string | null;
  stockLength: number;
  isLowStock: boolean;
};

type GateRequest = {
  id: string;
  requestedLength: number;
  requestType: string;
  purchaseName?: string | null;
  purchaseSku?: string | null;
  purchaseColor?: string | null;
  purchaseFabricType?: string | null;
  purchaseSupplier?: string | null;
  purchaseUnitCost?: number | null;
  status: string;
  notes?: string | null;
  createdAt: string;
  fabric?: GateFabric | null;
};

type GateRepeatRequest = {
  id: string;
  sku: string;
  stage: number;
  modelCount: number;
  totalCount: number;
  repeatDate?: string | null;
  sizes: { id: string; label: string; count: number }[];
};

type GateData = {
  tailor: {
    id: string;
    name: string;
    workshopName?: string | null;
  };
  fabrics: GateFabric[];
  requests: GateRequest[];
  repeatRequests: GateRepeatRequest[];
};

const REPEAT_STAGES = ['—', 'مطلوب', 'تم الطلب', 'تم الصنع', 'تم الشحن', 'متوفر'];

const numberFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });
const currencyFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 2,
});
const METER_TO_YARD = 1.0936132983;
const formatDualLength = (meters: number) =>
  `${numberFormatter.format(meters)} م / ${numberFormatter.format(meters * METER_TO_YARD)} ياردة`;
const formatDate = (value: string) => dateFormatter.format(new Date(value));
const formatCurrency = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : currencyFormatter.format(value);

export default function TailorFabricGatePage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as { role?: string; roles?: string[] } | undefined;
  const isAdmin = (sessionUser?.roles || (sessionUser?.role ? [sessionUser.role] : [])).includes('admin');

  const [accessCode, setAccessCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [data, setData] = useState<GateData | null>(null);
  const [fabricId, setFabricId] = useState('');
  const [requestedLength, setRequestedLength] = useState('');
  const [lengthUnit, setLengthUnit] = useState<'meter' | 'yard'>('meter');
  const [notes, setNotes] = useState('');
  const [purchaseName, setPurchaseName] = useState('');
  const [purchaseSku, setPurchaseSku] = useState('');
  const [purchaseColor, setPurchaseColor] = useState('');
  const [purchaseFabricType, setPurchaseFabricType] = useState('');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseLength, setPurchaseLength] = useState('');
  const [purchaseLengthUnit, setPurchaseLengthUnit] = useState<'meter' | 'yard'>('meter');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFabric = useMemo(
    () => data?.fabrics.find((fabric) => fabric.id === fabricId),
    [data?.fabrics, fabricId]
  );

  const loadGate = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tailor-fabric-gate?accessCode=${encodeURIComponent(code)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل في الدخول');
      setData(payload);
      setActiveCode(code);
      setFabricId(payload.fabrics[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError.message || 'فشل في الدخول');
      setData(null);
      setActiveCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    if (!accessCode.trim()) {
      setError('رمز الدخول مطلوب');
      return;
    }
    void loadGate(accessCode.trim());
  };

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tailor-fabric-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: activeCode,
          fabricId,
          requestedLength,
          lengthUnit,
          notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل في إرسال الطلب');
      setRequestedLength('');
      setNotes('');
      await loadGate(activeCode);
    } catch (requestError: any) {
      setError(requestError.message || 'فشل في إرسال الطلب');
    } finally {
      setSaving(false);
    }
  };

  const handlePurchase = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tailor-fabric-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'purchase-fabric',
          accessCode: activeCode,
          purchaseName,
          purchaseSku,
          purchaseColor,
          purchaseFabricType,
          purchaseSupplier,
          requestedLength: purchaseLength,
          lengthUnit: purchaseLengthUnit,
          purchaseUnitCost,
          notes: purchaseNotes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل في إرسال شراء القماش');
      setPurchaseName('');
      setPurchaseSku('');
      setPurchaseColor('');
      setPurchaseFabricType('');
      setPurchaseSupplier('');
      setPurchaseLength('');
      setPurchaseUnitCost('');
      setPurchaseNotes('');
      await loadGate(activeCode);
    } catch (purchaseError: any) {
      setError(purchaseError.message || 'فشل في إرسال شراء القماش');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkMade = async (repeatRequestId: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tailor-fabric-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'repeat-mark-made', accessCode: activeCode, repeatRequestId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل تحديث المرحلة');
      await loadGate(activeCode);
    } catch (markError: any) {
      setError(markError.message || 'فشل تحديث المرحلة');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminDelete = async (type: 'request' | 'repeat', id: string) => {
    if (!window.confirm('حذف هذا السجل نهائياً من قاعدة البيانات؟')) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tailor-fabric-gate?type=${type}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل في الحذف');
      await loadGate(activeCode);
    } catch (deleteError: any) {
      setError(deleteError.message || 'فشل في الحذف');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PublicPageShell title="بوابة الخياطين" subtitle="عرض الأقمشة المتوفرة وطلب كميات جديدة" showHomeLink={false}>
      <div className="w-full space-y-4">
        {!data ? (
          <Card className="mx-auto max-w-md rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LockKeyhole className="size-4" />
                دخول الخياط
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-3">
                <Field>
                  <FieldLabel>رمز الدخول</FieldLabel>
                  <Input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoFocus />
                </Field>
                {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
                <Button type="submit" className="w-full" disabled={loading}>
                  <LockKeyhole className="size-4" />
                  دخول
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{data.tailor.name}</h2>
                {data.tailor.workshopName && <p className="text-sm text-muted-foreground">{data.tailor.workshopName}</p>}
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadGate(activeCode)} disabled={loading}>
                <RefreshCw className="size-4" />
                تحديث
              </Button>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="overflow-hidden rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>القماش</TableHead>
                      <TableHead>رمز القماش</TableHead>
                      <TableHead>اللون</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>المتوفر</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.fabrics.map((fabric) => (
                      <TableRow key={fabric.id}>
                        <TableCell className="font-medium">{fabric.name}</TableCell>
                        <TableCell>{fabric.sku || '-'}</TableCell>
                        <TableCell>{fabric.color || '-'}</TableCell>
                        <TableCell>{fabric.fabricType || '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {formatDualLength(fabric.stockLength)}
                            {fabric.isLowStock && <Badge variant="secondary">كمية محدودة</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!data.fabrics.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          لا توجد أقمشة متاحة حالياً
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-4">
                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PackagePlus className="size-4" />
                      طلب قماش من المخزون
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleRequest} className="space-y-3">
                      <Field>
                        <FieldLabel>القماش</FieldLabel>
                        <NativeSelect value={fabricId} onChange={(event) => setFabricId(event.target.value)}>
                          {data.fabrics.map((fabric) => (
                            <NativeSelectOption key={fabric.id} value={fabric.id}>
                              {fabric.name} - {formatDualLength(fabric.stockLength)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      {selectedFabric && (
                        <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                          المتوفر الآن: {formatDualLength(selectedFabric.stockLength)}
                        </div>
                      )}
                      <Field>
                        <FieldLabel>وحدة الطلب</FieldLabel>
                        <NativeSelect value={lengthUnit} onChange={(event) => setLengthUnit(event.target.value as 'meter' | 'yard')}>
                          <NativeSelectOption value="meter">متر</NativeSelectOption>
                          <NativeSelectOption value="yard">ياردة</NativeSelectOption>
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel>{lengthUnit === 'yard' ? 'الكمية المطلوبة بالياردة' : 'الكمية المطلوبة بالمتر'}</FieldLabel>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={requestedLength}
                          onChange={(event) => setRequestedLength(event.target.value)}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel>ملاحظات</FieldLabel>
                        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                      </Field>
                      <Button type="submit" className="w-full" disabled={saving || !data.fabrics.length}>
                        <Send className="size-4" />
                        إرسال الطلب
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PackagePlus className="size-4" />
                      تسجيل شراء قماش
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handlePurchase} className="space-y-3">
                      <Field>
                        <FieldLabel>اسم القماش</FieldLabel>
                        <Input value={purchaseName} onChange={(event) => setPurchaseName(event.target.value)} required />
                      </Field>
                      <Field>
                        <FieldLabel>رمز القماش</FieldLabel>
                        <Input value={purchaseSku} onChange={(event) => setPurchaseSku(event.target.value)} />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel>اللون</FieldLabel>
                          <Input value={purchaseColor} onChange={(event) => setPurchaseColor(event.target.value)} />
                        </Field>
                        <Field>
                          <FieldLabel>نوع القماش</FieldLabel>
                          <Input value={purchaseFabricType} onChange={(event) => setPurchaseFabricType(event.target.value)} />
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel>المورد</FieldLabel>
                        <Input value={purchaseSupplier} onChange={(event) => setPurchaseSupplier(event.target.value)} />
                      </Field>
                      <Field>
                        <FieldLabel>وحدة التكلفة والطول</FieldLabel>
                        <NativeSelect value={purchaseLengthUnit} onChange={(event) => setPurchaseLengthUnit(event.target.value as 'meter' | 'yard')}>
                          <NativeSelectOption value="meter">متر</NativeSelectOption>
                          <NativeSelectOption value="yard">ياردة</NativeSelectOption>
                        </NativeSelect>
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel>{purchaseLengthUnit === 'yard' ? 'الطول المشترى بالياردة' : 'الطول المشترى بالمتر'}</FieldLabel>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={purchaseLength}
                            onChange={(event) => setPurchaseLength(event.target.value)}
                            required
                          />
                        </Field>
                        <Field>
                          <FieldLabel>{purchaseLengthUnit === 'yard' ? 'تكلفة الياردة' : 'تكلفة المتر'}</FieldLabel>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={purchaseUnitCost}
                            onChange={(event) => setPurchaseUnitCost(event.target.value)}
                          />
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel>ملاحظات الشراء</FieldLabel>
                        <Textarea value={purchaseNotes} onChange={(event) => setPurchaseNotes(event.target.value)} />
                      </Field>
                      <Button type="submit" className="w-full" disabled={saving}>
                        <Send className="size-4" />
                        إرسال للاعتماد
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>طلباتي الأخيرة</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>التكلفة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    {isAdmin && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.requestType === 'purchase'
                          ? request.purchaseName || request.fabric?.name || '-'
                          : request.fabric?.name || '-'}
                        {request.requestType === 'purchase' && (
                          <Badge className="ms-2" variant="secondary">شراء</Badge>
                        )}
                      </TableCell>
                      <TableCell>{formatDualLength(request.requestedLength)}</TableCell>
                      <TableCell>{formatCurrency(request.purchaseUnitCost)}</TableCell>
                      <TableCell>
                        <Badge variant={request.status === 'pending' ? 'secondary' : 'default'}>{request.status}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-red-600 hover:text-red-700"
                            disabled={saving}
                            title="حذف من قاعدة البيانات"
                            onClick={() => void handleAdminDelete('request', request.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!data.requests.length && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 6 : 5} className="py-8 text-center text-muted-foreground">
                        لم يتم إرسال طلبات بعد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {data.repeatRequests.length > 0 && (
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PackagePlus className="size-4" />
                    طلبات التكرار المسندة إليك
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الموديل</TableHead>
                          <TableHead>الكمية المطلوبة</TableHead>
                          <TableHead>المرحلة</TableHead>
                          <TableHead>الإجراء</TableHead>
                          {isAdmin && <TableHead className="w-12"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.repeatRequests.map((rr) => (
                          <TableRow key={rr.id}>
                            <TableCell className="font-medium">{rr.sku}</TableCell>
                            <TableCell>
                              {rr.totalCount}
                              {rr.sizes.some((s) => s.count > 0) && (
                                <span className="text-muted-foreground">
                                  {' '}({rr.sizes.filter((s) => s.count > 0).map((s) => `${s.label}:${s.count}`).join('، ')})
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={rr.stage >= 3 ? 'default' : 'secondary'}>
                                {REPEAT_STAGES[rr.stage] || '—'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {rr.stage === 2 ? (
                                <Button size="sm" disabled={saving} onClick={() => void handleMarkMade(rr.id)}>
                                  ⚙️ تم الصنع
                                </Button>
                              ) : rr.stage >= 3 ? (
                                <span className="text-sm text-muted-foreground">✓ تم الصنع</span>
                              ) : (
                                <span className="text-sm text-muted-foreground">بانتظار طلب المسؤول</span>
                              )}
                            </TableCell>
                            {isAdmin && (
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-red-600 hover:text-red-700"
                                  disabled={saving}
                                  title="حذف من قاعدة البيانات"
                                  onClick={() => void handleAdminDelete('repeat', rr.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PublicPageShell>
  );
}
