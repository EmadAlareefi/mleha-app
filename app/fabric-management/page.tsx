'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ExternalLink,
  PackagePlus,
  RefreshCw,
  Ruler,
  Scissors,
  Send,
  Shirt,
  UserPlus,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Fabric = {
  id: string;
  name: string;
  sku?: string | null;
  color?: string | null;
  fabricType?: string | null;
  supplier?: string | null;
  unitCost: number;
  stockLength: number;
  minStock: number;
  isLowStock: boolean;
};

type Tailor = {
  id: string;
  name: string;
  workshopName?: string | null;
  phone?: string | null;
  accessCode: string;
  isActive: boolean;
};

type TailorFabricIssue = {
  id: string;
  fabricId: string;
  tailorId: string;
  issuedLength: number;
  unitCostAtIssue: number;
  status: string;
  issueDate: string;
  reference?: string | null;
  deliveredDressCount?: number | null;
  consumedLength: number;
  returnedLength: number;
  tailoringCost: number;
  extraCost: number;
  remainingAtTailor: number;
  totalDressCost: number;
  costPerDress: number | null;
  deliveryDate?: string | null;
  fabric: Fabric;
  tailor: Tailor;
};

type TailorFabricRequest = {
  id: string;
  requestedLength: number;
  status: string;
  notes?: string | null;
  createdAt: string;
  fabric: Fabric;
  tailor: Tailor;
};

type FabricManagementData = {
  fabrics: Fabric[];
  tailors: Tailor[];
  issues: TailorFabricIssue[];
  requests: TailorFabricRequest[];
  summary: {
    fabricsCount: number;
    activeTailorsCount: number;
    stockMeters: number;
    withTailorsMeters: number;
    pendingRequestsCount: number;
  };
};

const numberFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });

const formatNumber = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : numberFormatter.format(value);
const formatMeters = (value?: number | null) => `${formatNumber(value)} م`;
const formatCurrency = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : currencyFormatter.format(value);
const formatDate = (value?: string | null) => (value ? dateFormatter.format(new Date(value)) : '-');

const initialFabricForm = {
  name: '',
  sku: '',
  color: '',
  fabricType: '',
  supplier: '',
  unitCost: '',
  stockLength: '',
  minStock: '',
  notes: '',
};

const initialTailorForm = {
  name: '',
  workshopName: '',
  phone: '',
  accessCode: '',
  notes: '',
};

const initialIssueForm = {
  fabricId: '',
  tailorId: '',
  issuedLength: '',
  issueDate: new Date().toISOString().split('T')[0],
  reference: '',
  notes: '',
};

const initialDeliveryForm = {
  issueId: '',
  deliveredDressCount: '',
  consumedLength: '',
  returnedLength: '',
  tailoringCost: '',
  extraCost: '',
  deliveryDate: new Date().toISOString().split('T')[0],
};

export default function FabricManagementPage() {
  const [data, setData] = useState<FabricManagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fabricForm, setFabricForm] = useState(initialFabricForm);
  const [tailorForm, setTailorForm] = useState(initialTailorForm);
  const [issueForm, setIssueForm] = useState(initialIssueForm);
  const [deliveryForm, setDeliveryForm] = useState(initialDeliveryForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fabric-management');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to fetch fabric data');
      setData(payload);
      setIssueForm((current) => ({
        ...current,
        fabricId: current.fabricId || payload.fabrics[0]?.id || '',
        tailorId: current.tailorId || payload.tailors[0]?.id || '',
      }));
      setDeliveryForm((current) => ({
        ...current,
        issueId: current.issueId || payload.issues[0]?.id || '',
      }));
    } catch (fetchError: any) {
      setError(fetchError.message || 'فشل في جلب بيانات الأقمشة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openIssues = useMemo(
    () => (data?.issues || []).filter((issue) => issue.status !== 'closed'),
    [data?.issues]
  );

  const postAction = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'فشل في الحفظ');
      await fetchData();
      return true;
    } catch (saveError: any) {
      alert(saveError.message || 'فشل في الحفظ');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleFabricSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!fabricForm.name.trim()) {
      alert('اسم القماش مطلوب');
      return;
    }
    const saved = await postAction({ action: 'create-fabric', ...fabricForm });
    if (saved) setFabricForm(initialFabricForm);
  };

  const handleTailorSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tailorForm.name.trim() || !tailorForm.accessCode.trim()) {
      alert('اسم الخياط ورمز الدخول مطلوبان');
      return;
    }
    const saved = await postAction({ action: 'create-tailor', ...tailorForm });
    if (saved) setTailorForm(initialTailorForm);
  };

  const handleIssueSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await postAction({ action: 'issue-fabric', ...issueForm });
    if (saved) setIssueForm({ ...initialIssueForm, fabricId: data?.fabrics[0]?.id || '', tailorId: data?.tailors[0]?.id || '' });
  };

  const handleDeliverySubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await postAction({ action: 'record-delivery', ...deliveryForm });
    if (saved) setDeliveryForm({ ...initialDeliveryForm, issueId: data?.issues[0]?.id || '' });
  };

  const updateRequestStatus = (requestId: string, status: string) =>
    postAction({ action: 'update-request-status', requestId, status });

  const summary = data?.summary;

  return (
    <AppPageShell
      title="إدارة الأقمشة"
      subtitle="تتبع مخزون الأقمشة والكميات لدى الخياطين وتكلفة الفساتين النهائية"
    >
      <div dir="rtl" className="space-y-6 text-right [&_input]:text-right [&_table]:text-right [&_textarea]:text-right">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => void fetchData()} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className="size-4" />
            تحديث
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/tailor-fabric-gate" target="_blank" prefetch={false}>
              <ExternalLink className="size-4" />
              بوابة الخياطين
            </Link>
          </Button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading && !data ? (
          <LoadingState label="جاري تحميل بيانات الأقمشة" />
        ) : (
          <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard title="أنواع الأقمشة" value={formatNumber(summary?.fabricsCount)} icon={<Scissors className="size-4" />} />
            <StatCard title="الخياطون النشطون" value={formatNumber(summary?.activeTailorsCount)} icon={<Shirt className="size-4" />} />
            <StatCard title="المخزون المتاح" value={formatMeters(summary?.stockMeters)} icon={<Ruler className="size-4" />} />
            <StatCard title="لدى الخياطين" value={formatMeters(summary?.withTailorsMeters)} icon={<Send className="size-4" />} />
            <StatCard title="طلبات معلقة" value={formatNumber(summary?.pendingRequestsCount)} icon={<PackagePlus className="size-4" />} />
          </div>

          <Tabs defaultValue="stock" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="stock">المخزون</TabsTrigger>
              <TabsTrigger value="tailors">الخياطون</TabsTrigger>
              <TabsTrigger value="issues">تسليم الأقمشة</TabsTrigger>
              <TabsTrigger value="deliveries">التكلفة والتسليم</TabsTrigger>
              <TabsTrigger value="requests">طلبات الخياطين</TabsTrigger>
            </TabsList>

            <TabsContent value="stock" className="space-y-4">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PackagePlus className="size-4" />
                    إضافة قماش
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleFabricSubmit} className="grid gap-3 md:grid-cols-3">
                    <TextInput label="اسم القماش" value={fabricForm.name} onChange={(name) => setFabricForm({ ...fabricForm, name })} required />
                    <TextInput label="SKU" value={fabricForm.sku} onChange={(sku) => setFabricForm({ ...fabricForm, sku })} />
                    <TextInput label="اللون" value={fabricForm.color} onChange={(color) => setFabricForm({ ...fabricForm, color })} />
                    <TextInput label="نوع القماش" value={fabricForm.fabricType} onChange={(fabricType) => setFabricForm({ ...fabricForm, fabricType })} />
                    <TextInput label="المورد" value={fabricForm.supplier} onChange={(supplier) => setFabricForm({ ...fabricForm, supplier })} />
                    <TextInput label="تكلفة المتر" type="number" value={fabricForm.unitCost} onChange={(unitCost) => setFabricForm({ ...fabricForm, unitCost })} />
                    <TextInput label="الطول في المخزون" type="number" value={fabricForm.stockLength} onChange={(stockLength) => setFabricForm({ ...fabricForm, stockLength })} />
                    <TextInput label="حد التنبيه" type="number" value={fabricForm.minStock} onChange={(minStock) => setFabricForm({ ...fabricForm, minStock })} />
                    <Field className="md:col-span-3">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={fabricForm.notes} onChange={(event) => setFabricForm({ ...fabricForm, notes: event.target.value })} />
                    </Field>
                    <Button className="md:w-fit" type="submit" disabled={saving}>
                      <PackagePlus className="size-4" />
                      حفظ القماش
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <FabricTable fabrics={data?.fabrics || []} />
            </TabsContent>

            <TabsContent value="tailors" className="space-y-4">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserPlus className="size-4" />
                    إضافة خياط
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleTailorSubmit} className="grid gap-3 md:grid-cols-2">
                    <TextInput label="اسم الخياط" value={tailorForm.name} onChange={(name) => setTailorForm({ ...tailorForm, name })} required />
                    <TextInput label="اسم الورشة" value={tailorForm.workshopName} onChange={(workshopName) => setTailorForm({ ...tailorForm, workshopName })} />
                    <TextInput label="الجوال" value={tailorForm.phone} onChange={(phone) => setTailorForm({ ...tailorForm, phone })} />
                    <TextInput label="رمز الدخول للبوابة" value={tailorForm.accessCode} onChange={(accessCode) => setTailorForm({ ...tailorForm, accessCode })} required />
                    <Field className="md:col-span-2">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={tailorForm.notes} onChange={(event) => setTailorForm({ ...tailorForm, notes: event.target.value })} />
                    </Field>
                    <Button className="md:w-fit" type="submit" disabled={saving}>
                      <UserPlus className="size-4" />
                      حفظ الخياط
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <TailorsTable tailors={data?.tailors || []} />
            </TabsContent>

            <TabsContent value="issues" className="space-y-4">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Send className="size-4" />
                    تسليم قماش لخياط
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleIssueSubmit} className="grid gap-3 md:grid-cols-3">
                    <SelectField label="القماش" value={issueForm.fabricId} onChange={(fabricId) => setIssueForm({ ...issueForm, fabricId })}>
                      {(data?.fabrics || []).map((fabric) => (
                        <NativeSelectOption key={fabric.id} value={fabric.id}>
                          {fabric.name} - {formatMeters(fabric.stockLength)}
                        </NativeSelectOption>
                      ))}
                    </SelectField>
                    <SelectField label="الخياط" value={issueForm.tailorId} onChange={(tailorId) => setIssueForm({ ...issueForm, tailorId })}>
                      {(data?.tailors || []).map((tailor) => (
                        <NativeSelectOption key={tailor.id} value={tailor.id}>
                          {tailor.name}
                        </NativeSelectOption>
                      ))}
                    </SelectField>
                    <TextInput label="الطول المسلم بالمتر" type="number" value={issueForm.issuedLength} onChange={(issuedLength) => setIssueForm({ ...issueForm, issuedLength })} required />
                    <TextInput label="تاريخ التسليم" type="date" value={issueForm.issueDate} onChange={(issueDate) => setIssueForm({ ...issueForm, issueDate })} />
                    <TextInput label="مرجع" value={issueForm.reference} onChange={(reference) => setIssueForm({ ...issueForm, reference })} />
                    <Field className="md:col-span-3">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={issueForm.notes} onChange={(event) => setIssueForm({ ...issueForm, notes: event.target.value })} />
                    </Field>
                    <Button className="md:w-fit" type="submit" disabled={saving || !data?.fabrics.length || !data?.tailors.length}>
                      <Send className="size-4" />
                      تسجيل التسليم
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <IssuesTable issues={data?.issues || []} />
            </TabsContent>

            <TabsContent value="deliveries" className="space-y-4">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="size-4" />
                    تسجيل تسليم الفساتين والتكلفة
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleDeliverySubmit} className="grid gap-3 md:grid-cols-3">
                    <SelectField label="سجل القماش" value={deliveryForm.issueId} onChange={(issueId) => setDeliveryForm({ ...deliveryForm, issueId })}>
                      {openIssues.map((issue) => (
                        <NativeSelectOption key={issue.id} value={issue.id}>
                          {issue.fabric.name} - {issue.tailor.name} - {formatMeters(issue.issuedLength)}
                        </NativeSelectOption>
                      ))}
                    </SelectField>
                    <TextInput label="عدد الفساتين" type="number" value={deliveryForm.deliveredDressCount} onChange={(deliveredDressCount) => setDeliveryForm({ ...deliveryForm, deliveredDressCount })} />
                    <TextInput label="المستهلك من القماش" type="number" value={deliveryForm.consumedLength} onChange={(consumedLength) => setDeliveryForm({ ...deliveryForm, consumedLength })} />
                    <TextInput label="المرتجع للمخزون" type="number" value={deliveryForm.returnedLength} onChange={(returnedLength) => setDeliveryForm({ ...deliveryForm, returnedLength })} />
                    <TextInput label="تكلفة الخياطة" type="number" value={deliveryForm.tailoringCost} onChange={(tailoringCost) => setDeliveryForm({ ...deliveryForm, tailoringCost })} />
                    <TextInput label="تكاليف إضافية" type="number" value={deliveryForm.extraCost} onChange={(extraCost) => setDeliveryForm({ ...deliveryForm, extraCost })} />
                    <TextInput label="تاريخ استلام الفساتين" type="date" value={deliveryForm.deliveryDate} onChange={(deliveryDate) => setDeliveryForm({ ...deliveryForm, deliveryDate })} />
                    <Button className="md:w-fit" type="submit" disabled={saving || !openIssues.length}>
                      <CheckCircle2 className="size-4" />
                      حفظ التسليم
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <IssuesTable issues={data?.issues || []} showCost />
            </TabsContent>

            <TabsContent value="requests">
              <RequestsTable requests={data?.requests || []} onStatusChange={(requestId, status) => void updateRequestStatus(requestId, status)} saving={saving} />
            </TabsContent>
          </Tabs>
          </>
        )}
      </div>
    </AppPageShell>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="rounded-lg shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        value={value}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? '0.01' : undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </NativeSelect>
    </Field>
  );
}

function FabricTable({ fabrics }: { fabrics: Fabric[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>القماش</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>اللون</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>المخزون</TableHead>
            <TableHead>تكلفة المتر</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fabrics.map((fabric) => (
            <TableRow key={fabric.id}>
              <TableCell className="font-medium">{fabric.name}</TableCell>
              <TableCell>{fabric.sku || '-'}</TableCell>
              <TableCell>{fabric.color || '-'}</TableCell>
              <TableCell>{fabric.fabricType || '-'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {formatMeters(fabric.stockLength)}
                  {fabric.isLowStock && <Badge variant="secondary">منخفض</Badge>}
                </div>
              </TableCell>
              <TableCell>{formatCurrency(fabric.unitCost)}</TableCell>
            </TableRow>
          ))}
          {!fabrics.length && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                لا توجد أقمشة مسجلة
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TailorsTable({ tailors }: { tailors: Tailor[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الخياط</TableHead>
            <TableHead>الورشة</TableHead>
            <TableHead>الجوال</TableHead>
            <TableHead>رمز الدخول</TableHead>
            <TableHead>الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tailors.map((tailor) => (
            <TableRow key={tailor.id}>
              <TableCell className="font-medium">{tailor.name}</TableCell>
              <TableCell>{tailor.workshopName || '-'}</TableCell>
              <TableCell>{tailor.phone || '-'}</TableCell>
              <TableCell className="font-mono">{tailor.accessCode}</TableCell>
              <TableCell>{tailor.isActive ? <Badge>نشط</Badge> : <Badge variant="secondary">متوقف</Badge>}</TableCell>
            </TableRow>
          ))}
          {!tailors.length && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                لا يوجد خياطون مسجلون
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function IssuesTable({ issues, showCost = false }: { issues: TailorFabricIssue[]; showCost?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>القماش</TableHead>
            <TableHead>الخياط</TableHead>
            <TableHead>المسلم</TableHead>
            <TableHead>المتبقي لدى الخياط</TableHead>
            <TableHead>التاريخ</TableHead>
            {showCost && <TableHead>تكلفة الفستان</TableHead>}
            {showCost && <TableHead>إجمالي التكلفة</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => (
            <TableRow key={issue.id}>
              <TableCell className="font-medium">{issue.fabric.name}</TableCell>
              <TableCell>{issue.tailor.name}</TableCell>
              <TableCell>{formatMeters(issue.issuedLength)}</TableCell>
              <TableCell>{formatMeters(issue.remainingAtTailor)}</TableCell>
              <TableCell>{formatDate(issue.deliveryDate || issue.issueDate)}</TableCell>
              {showCost && <TableCell>{formatCurrency(issue.costPerDress)}</TableCell>}
              {showCost && <TableCell>{formatCurrency(issue.totalDressCost)}</TableCell>}
            </TableRow>
          ))}
          {!issues.length && (
            <TableRow>
              <TableCell colSpan={showCost ? 7 : 5} className="py-8 text-center text-muted-foreground">
                لا توجد كميات مسلمة للخياطين
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function RequestsTable({
  requests,
  onStatusChange,
  saving,
}: {
  requests: TailorFabricRequest[];
  onStatusChange: (requestId: string, status: string) => void;
  saving: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الخياط</TableHead>
            <TableHead>القماش</TableHead>
            <TableHead>الكمية</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>التاريخ</TableHead>
            <TableHead>إجراء</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell className="font-medium">{request.tailor.name}</TableCell>
              <TableCell>{request.fabric.name}</TableCell>
              <TableCell>{formatMeters(request.requestedLength)}</TableCell>
              <TableCell>
                <Badge variant={request.status === 'pending' ? 'secondary' : 'default'}>{request.status}</Badge>
              </TableCell>
              <TableCell>{formatDate(request.createdAt)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" disabled={saving} onClick={() => onStatusChange(request.id, 'approved')}>
                    موافقة
                  </Button>
                  <Button size="xs" variant="outline" disabled={saving} onClick={() => onStatusChange(request.id, 'fulfilled')}>
                    تم التوريد
                  </Button>
                  <Button size="xs" variant="ghost" disabled={saving} onClick={() => onStatusChange(request.id, 'rejected')}>
                    رفض
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!requests.length && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                لا توجد طلبات من الخياطين
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
