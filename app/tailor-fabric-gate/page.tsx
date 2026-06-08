'use client';

import { FormEvent, useMemo, useState } from 'react';
import { LockKeyhole, PackagePlus, RefreshCw, Send } from 'lucide-react';
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
  status: string;
  notes?: string | null;
  createdAt: string;
  fabric: GateFabric;
};

type GateData = {
  tailor: {
    id: string;
    name: string;
    workshopName?: string | null;
  };
  fabrics: GateFabric[];
  requests: GateRequest[];
};

const numberFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });
const formatMeters = (value: number) => `${numberFormatter.format(value)} م`;
const formatDate = (value: string) => dateFormatter.format(new Date(value));

export default function TailorFabricGatePage() {
  const [accessCode, setAccessCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [data, setData] = useState<GateData | null>(null);
  const [fabricId, setFabricId] = useState('');
  const [requestedLength, setRequestedLength] = useState('');
  const [notes, setNotes] = useState('');
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
                      <TableHead>SKU</TableHead>
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
                            {formatMeters(fabric.stockLength)}
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

              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PackagePlus className="size-4" />
                    طلب قماش
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRequest} className="space-y-3">
                    <Field>
                      <FieldLabel>القماش</FieldLabel>
                      <NativeSelect value={fabricId} onChange={(event) => setFabricId(event.target.value)}>
                        {data.fabrics.map((fabric) => (
                          <NativeSelectOption key={fabric.id} value={fabric.id}>
                            {fabric.name} - {formatMeters(fabric.stockLength)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    {selectedFabric && (
                      <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                        المتوفر الآن: {formatMeters(selectedFabric.stockLength)}
                      </div>
                    )}
                    <Field>
                      <FieldLabel>الكمية المطلوبة بالمتر</FieldLabel>
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
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>طلباتي الأخيرة</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">{request.fabric.name}</TableCell>
                      <TableCell>{formatMeters(request.requestedLength)}</TableCell>
                      <TableCell>
                        <Badge variant={request.status === 'pending' ? 'secondary' : 'default'}>{request.status}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {!data.requests.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        لم يتم إرسال طلبات بعد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </PublicPageShell>
  );
}
