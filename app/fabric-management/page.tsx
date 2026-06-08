'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Check,
  ChevronsUpDown,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
const METER_TO_YARD = 1.0936132983;

const formatNumber = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : numberFormatter.format(value);
const formatDualLength = (meters?: number | null) =>
  `${formatNumber(meters)} م / ${formatNumber((meters || 0) * METER_TO_YARD)} ياردة`;
const formatCurrency = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : currencyFormatter.format(value);
const formatDate = (value?: string | null) => (value ? dateFormatter.format(new Date(value)) : '-');

type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

const EMPTY_OPTION: SelectOption = { value: '', label: 'غير محدد' };

const LENGTH_UNIT_OPTIONS: SelectOption[] = [
  { value: 'meter', label: 'متر' },
  { value: 'yard', label: 'ياردة' },
];

const FABRIC_COLOR_OPTIONS: SelectOption[] = [
  'أبيض',
  'أوف وايت',
  'عاجي',
  'بيج',
  'ذهبي',
  'فضي',
  'أسود',
  'رمادي',
  'وردي فاتح',
  'وردي',
  'فوشيا',
  'أحمر',
  'عنابي',
  'بنفسجي',
  'لافندر',
  'أزرق فاتح',
  'أزرق ملكي',
  'كحلي',
  'تركواز',
  'أخضر فاتح',
  'زيتي',
  'أخضر زمردي',
  'بني',
  'نحاسي',
  'متعدد الألوان',
].map((value) => ({ value, label: value }));

const FABRIC_TYPE_OPTIONS: SelectOption[] = [
  'ساتان',
  'شيفون',
  'تول',
  'دانتيل',
  'كريب',
  'حرير',
  'مخمل',
  'ترتر',
  'جاكار',
  'أورجانزا',
  'بطانة',
  'قطن',
  'كتان',
  'ليكرا',
  'مطرز',
  'مشجر',
  'مخلوط',
].map((value) => ({ value, label: value }));

const SUPPLIER_OPTIONS: SelectOption[] = [
  'مخزون سابق',
  'مورد محلي',
  'سوق الجملة',
  'استيراد',
  'طلب خاص',
  'تحويل من فرع',
].map((value) => ({ value, label: value }));

const WORKSHOP_OPTIONS: SelectOption[] = [
  'ورشة داخلية',
  'ورشة خارجية',
  'خياط مستقل',
  'فرع الإنتاج',
  'تطريز خارجي',
  'تعديل ومقاسات',
].map((value) => ({ value, label: value }));

const initialFabricForm = {
  name: '',
  sku: '',
  color: '',
  fabricType: '',
  supplier: '',
  unitCost: '',
  stockLength: '',
  lengthUnit: 'meter',
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
  lengthUnit: 'meter',
  issueDate: new Date().toISOString().split('T')[0],
  reference: '',
  notes: '',
};

const initialStockForm = {
  fabricId: '',
  purchasedLength: '',
  lengthUnit: 'meter',
  unitCost: '',
  supplier: '',
  notes: '',
};

const initialDeliveryForm = {
  issueId: '',
  deliveredDressCount: '',
  consumedLength: '',
  returnedLength: '',
  lengthUnit: 'meter',
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
  const [stockForm, setStockForm] = useState(initialStockForm);
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
      setStockForm((current) => ({
        ...current,
        fabricId: current.fabricId || payload.fabrics[0]?.id || '',
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

  const fabricColorOptions = useMemo(
    () => mergeOptions(FABRIC_COLOR_OPTIONS, data?.fabrics.map((fabric) => fabric.color) || [], true),
    [data?.fabrics]
  );
  const fabricTypeOptions = useMemo(
    () => mergeOptions(FABRIC_TYPE_OPTIONS, data?.fabrics.map((fabric) => fabric.fabricType) || [], true),
    [data?.fabrics]
  );
  const supplierOptions = useMemo(
    () => mergeOptions(SUPPLIER_OPTIONS, data?.fabrics.map((fabric) => fabric.supplier) || [], true),
    [data?.fabrics]
  );
  const workshopOptions = useMemo(
    () => mergeOptions(WORKSHOP_OPTIONS, data?.tailors.map((tailor) => tailor.workshopName) || [], true),
    [data?.tailors]
  );
  const fabricOptions = useMemo(
    () =>
      (data?.fabrics || []).map((fabric) => ({
        value: fabric.id,
        label: fabric.name,
        description: `${fabric.color || 'بدون لون'} - ${formatDualLength(fabric.stockLength)}`,
      })),
    [data?.fabrics]
  );
  const tailorOptions = useMemo(
    () =>
      (data?.tailors || []).map((tailor) => ({
        value: tailor.id,
        label: tailor.name,
        description: tailor.workshopName || tailor.phone || undefined,
      })),
    [data?.tailors]
  );
  const issueOptions = useMemo(
    () =>
      openIssues.map((issue) => ({
        value: issue.id,
        label: `${issue.fabric.name} - ${issue.tailor.name}`,
        description: `${formatDualLength(issue.issuedLength)} مسلم | ${formatDualLength(issue.remainingAtTailor)} لدى الخياط`,
      })),
    [openIssues]
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

  const handleStockSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await postAction({ action: 'add-fabric-stock', ...stockForm });
    if (saved) {
      setStockForm({
        ...initialStockForm,
        fabricId: data?.fabrics[0]?.id || '',
      });
    }
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
            <StatCard title="المخزون المتاح" value={formatDualLength(summary?.stockMeters)} icon={<Ruler className="size-4" />} />
            <StatCard title="لدى الخياطين" value={formatDualLength(summary?.withTailorsMeters)} icon={<Send className="size-4" />} />
            <StatCard title="طلبات معلقة" value={formatNumber(summary?.pendingRequestsCount)} icon={<PackagePlus className="size-4" />} />
          </div>

          <Tabs defaultValue="stock" className="w-full">
            <TabsList
              dir="rtl"
              style={{ direction: 'rtl' }}
              className="flex h-auto w-full flex-row flex-wrap justify-start"
            >
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
                  <form onSubmit={handleFabricSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                    <TextInput label="اسم القماش" value={fabricForm.name} onChange={(name) => setFabricForm({ ...fabricForm, name })} required />
                    <TextInput label="SKU" value={fabricForm.sku} onChange={(sku) => setFabricForm({ ...fabricForm, sku })} />
                    <SearchableSelect label="اللون" value={fabricForm.color} options={fabricColorOptions} onChange={(color) => setFabricForm({ ...fabricForm, color })} />
                    <SearchableSelect label="نوع القماش" value={fabricForm.fabricType} options={fabricTypeOptions} onChange={(fabricType) => setFabricForm({ ...fabricForm, fabricType })} />
                    <SearchableSelect label="المورد" value={fabricForm.supplier} options={supplierOptions} onChange={(supplier) => setFabricForm({ ...fabricForm, supplier })} />
                    <TextInput label={fabricForm.lengthUnit === 'yard' ? 'تكلفة الياردة' : 'تكلفة المتر'} type="number" value={fabricForm.unitCost} onChange={(unitCost) => setFabricForm({ ...fabricForm, unitCost })} />
                    <TextInput label={fabricForm.lengthUnit === 'yard' ? 'الطول في المخزون بالياردة' : 'الطول في المخزون بالمتر'} type="number" value={fabricForm.stockLength} onChange={(stockLength) => setFabricForm({ ...fabricForm, stockLength })} />
                    <SearchableSelect label="وحدة الطول والتكلفة" value={fabricForm.lengthUnit} options={LENGTH_UNIT_OPTIONS} onChange={(lengthUnit) => setFabricForm({ ...fabricForm, lengthUnit })} required />
                    <TextInput label={fabricForm.lengthUnit === 'yard' ? 'حد التنبيه بالياردة' : 'حد التنبيه بالمتر'} type="number" value={fabricForm.minStock} onChange={(minStock) => setFabricForm({ ...fabricForm, minStock })} />
                    <Field className="md:col-span-3">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={fabricForm.notes} onChange={(event) => setFabricForm({ ...fabricForm, notes: event.target.value })} />
                    </Field>
                    <Button className="justify-self-start md:w-fit" type="submit" disabled={saving}>
                      <PackagePlus className="size-4" />
                      حفظ القماش
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Ruler className="size-4" />
                    إضافة كمية لمخزون موجود
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleStockSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                    <SearchableSelect
                      label="القماش"
                      value={stockForm.fabricId}
                      options={fabricOptions}
                      onChange={(fabricId) => setStockForm({ ...stockForm, fabricId })}
                      placeholder="اختر القماش"
                      required
                    />
                    <TextInput
                      label={stockForm.lengthUnit === 'yard' ? 'الكمية المشتراة بالياردة' : 'الكمية المشتراة بالمتر'}
                      type="number"
                      value={stockForm.purchasedLength}
                      onChange={(purchasedLength) => setStockForm({ ...stockForm, purchasedLength })}
                      required
                    />
                    <SearchableSelect
                      label="وحدة الكمية والتكلفة"
                      value={stockForm.lengthUnit}
                      options={LENGTH_UNIT_OPTIONS}
                      onChange={(lengthUnit) => setStockForm({ ...stockForm, lengthUnit })}
                      required
                    />
                    <TextInput
                      label={stockForm.lengthUnit === 'yard' ? 'تكلفة الياردة الجديدة' : 'تكلفة المتر الجديدة'}
                      type="number"
                      value={stockForm.unitCost}
                      onChange={(unitCost) => setStockForm({ ...stockForm, unitCost })}
                    />
                    <SearchableSelect
                      label="المورد"
                      value={stockForm.supplier}
                      options={supplierOptions}
                      onChange={(supplier) => setStockForm({ ...stockForm, supplier })}
                    />
                    <Field className="md:col-span-2">
                      <FieldLabel>مرجع أو ملاحظات الشراء</FieldLabel>
                      <Textarea value={stockForm.notes} onChange={(event) => setStockForm({ ...stockForm, notes: event.target.value })} />
                    </Field>
                    <Button className="justify-self-start md:w-fit" type="submit" disabled={saving || !data?.fabrics.length}>
                      <Ruler className="size-4" />
                      إضافة للمخزون
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
                  <form onSubmit={handleTailorSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-2">
                    <TextInput label="اسم الخياط" value={tailorForm.name} onChange={(name) => setTailorForm({ ...tailorForm, name })} required />
                    <SearchableSelect label="الورشة / نوع العمل" value={tailorForm.workshopName} options={workshopOptions} onChange={(workshopName) => setTailorForm({ ...tailorForm, workshopName })} />
                    <TextInput label="الجوال" value={tailorForm.phone} onChange={(phone) => setTailorForm({ ...tailorForm, phone })} />
                    <TextInput label="رمز الدخول للبوابة" value={tailorForm.accessCode} onChange={(accessCode) => setTailorForm({ ...tailorForm, accessCode })} required />
                    <Field className="md:col-span-2">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={tailorForm.notes} onChange={(event) => setTailorForm({ ...tailorForm, notes: event.target.value })} />
                    </Field>
                    <Button className="justify-self-start md:w-fit" type="submit" disabled={saving}>
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
                  <form onSubmit={handleIssueSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                    <SearchableSelect label="القماش" value={issueForm.fabricId} options={fabricOptions} onChange={(fabricId) => setIssueForm({ ...issueForm, fabricId })} placeholder="اختر القماش" required />
                    <SearchableSelect label="الخياط" value={issueForm.tailorId} options={tailorOptions} onChange={(tailorId) => setIssueForm({ ...issueForm, tailorId })} placeholder="اختر الخياط" required />
                    <TextInput label={issueForm.lengthUnit === 'yard' ? 'الطول المسلم بالياردة' : 'الطول المسلم بالمتر'} type="number" value={issueForm.issuedLength} onChange={(issuedLength) => setIssueForm({ ...issueForm, issuedLength })} required />
                    <SearchableSelect label="وحدة الطول المسلم" value={issueForm.lengthUnit} options={LENGTH_UNIT_OPTIONS} onChange={(lengthUnit) => setIssueForm({ ...issueForm, lengthUnit })} required />
                    <TextInput label="تاريخ التسليم" type="date" value={issueForm.issueDate} onChange={(issueDate) => setIssueForm({ ...issueForm, issueDate })} />
                    <TextInput label="مرجع" value={issueForm.reference} onChange={(reference) => setIssueForm({ ...issueForm, reference })} />
                    <Field className="md:col-span-3">
                      <FieldLabel>ملاحظات</FieldLabel>
                      <Textarea value={issueForm.notes} onChange={(event) => setIssueForm({ ...issueForm, notes: event.target.value })} />
                    </Field>
                    <Button className="justify-self-start md:w-fit" type="submit" disabled={saving || !data?.fabrics.length || !data?.tailors.length}>
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
                  <form onSubmit={handleDeliverySubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                    <SearchableSelect label="سجل القماش" value={deliveryForm.issueId} options={issueOptions} onChange={(issueId) => setDeliveryForm({ ...deliveryForm, issueId })} placeholder="اختر سجل القماش" required />
                    <TextInput label="عدد الفساتين" type="number" value={deliveryForm.deliveredDressCount} onChange={(deliveredDressCount) => setDeliveryForm({ ...deliveryForm, deliveredDressCount })} />
                    <TextInput label={deliveryForm.lengthUnit === 'yard' ? 'المستهلك من القماش بالياردة' : 'المستهلك من القماش بالمتر'} type="number" value={deliveryForm.consumedLength} onChange={(consumedLength) => setDeliveryForm({ ...deliveryForm, consumedLength })} />
                    <TextInput label={deliveryForm.lengthUnit === 'yard' ? 'المرتجع للمخزون بالياردة' : 'المرتجع للمخزون بالمتر'} type="number" value={deliveryForm.returnedLength} onChange={(returnedLength) => setDeliveryForm({ ...deliveryForm, returnedLength })} />
                    <SearchableSelect label="وحدة المستهلك والمرتجع" value={deliveryForm.lengthUnit} options={LENGTH_UNIT_OPTIONS} onChange={(lengthUnit) => setDeliveryForm({ ...deliveryForm, lengthUnit })} required />
                    <TextInput label="تكلفة الخياطة" type="number" value={deliveryForm.tailoringCost} onChange={(tailoringCost) => setDeliveryForm({ ...deliveryForm, tailoringCost })} />
                    <TextInput label="تكاليف إضافية" type="number" value={deliveryForm.extraCost} onChange={(extraCost) => setDeliveryForm({ ...deliveryForm, extraCost })} />
                    <TextInput label="تاريخ استلام الفساتين" type="date" value={deliveryForm.deliveryDate} onChange={(deliveryDate) => setDeliveryForm({ ...deliveryForm, deliveryDate })} />
                    <Button className="justify-self-start md:w-fit" type="submit" disabled={saving || !openIssues.length}>
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

function mergeOptions(baseOptions: SelectOption[], values: Array<string | null | undefined>, includeEmpty = false) {
  const optionMap = new Map<string, SelectOption>();
  if (includeEmpty) {
    optionMap.set(EMPTY_OPTION.value, EMPTY_OPTION);
  }
  baseOptions.forEach((option) => optionMap.set(option.value, option));
  values.forEach((rawValue) => {
    const value = rawValue?.trim();
    if (value && !optionMap.has(value)) {
      optionMap.set(value, { value, label: value });
    }
  });
  return Array.from(optionMap.values());
}

function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'اختر',
  required,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
            className={cn(
              'h-9 w-full justify-between px-3 text-right font-normal',
              !selectedOption && 'text-muted-foreground'
            )}
          >
            <span className="min-w-0 flex-1 truncate text-right">
              {selectedOption?.label || placeholder}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0" dir="rtl">
          <Command dir="rtl" className="text-right">
            <CommandInput className="text-right" placeholder="بحث..." />
            <CommandList>
              <CommandEmpty>لا توجد نتائج</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value || '__empty__'}
                    value={`${option.label} ${option.description || ''}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="justify-between text-right"
                  >
                    <Check className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex min-w-0 flex-1 flex-col items-end">
                      <span className="truncate">{option.label}</span>
                      {option.description && (
                        <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
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
                  {formatDualLength(fabric.stockLength)}
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
              <TableCell>{formatDualLength(issue.issuedLength)}</TableCell>
              <TableCell>{formatDualLength(issue.remainingAtTailor)}</TableCell>
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
              <TableCell>{formatDualLength(request.requestedLength)}</TableCell>
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
