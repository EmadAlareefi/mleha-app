'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Check,
  ChevronsUpDown,
  ExternalLink,
  FileText,
  PackagePlus,
  Plus,
  RefreshCw,
  Ruler,
  Scissors,
  Send,
  Shirt,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ModelsTabSpec, type DesignModel } from './models-tab-spec';

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
  notes?: string | null;
  isLowStock: boolean;
};

type Accessory = {
  id: string;
  name: string;
  sku?: string | null;
  unitPrice: number;
  stockQty: number;
  minStock: number;
  isActive: boolean;
  notes?: string | null;
  isLowStock: boolean;
};

type AuditLog = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  createdAt: string;
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
  designModelId?: string | null;
  plannedDressCount?: number | null;
  componentsIssued?: {
    fabrics?: Array<{ fabricId: string; name: string; meters: number }>;
    accessories?: Array<{ accessoryId: string; name: string; qty: number }>;
  } | null;
  fabric: Fabric;
  tailor: Tailor;
};

type TailorFabricRequest = {
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
  approvedBy?: string | null;
  approvedAt?: string | null;
  fabric?: Fabric | null;
  tailor: Tailor;
};

type FabricManagementData = {
  fabrics: Fabric[];
  accessories: Accessory[];
  tailors: Tailor[];
  issues: TailorFabricIssue[];
  requests: TailorFabricRequest[];
  models: DesignModel[];
  summary: {
    fabricsCount: number;
    accessoriesCount: number;
    activeTailorsCount: number;
    stockMeters: number;
    withTailorsMeters: number;
    pendingRequestsCount: number;
    modelsCount: number;
    lowStockFabricsCount: number;
    lowStockAccessoriesCount: number;
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
  sku?: string;
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

const SUPPLIER_OPTIONS: SelectOption[] = [
  'جملة بفاتورة',
  'استيراد الصين',
  'مخزون سابق',
  'مكتب محلي',
  'طلب خاص',
].map((value) => ({ value, label: value }));

const WORKSHOP_OPTIONS: SelectOption[] = [
  'ورشة داخلية',
  'ورشة خارجية',
  'خياط مستقل',
  'فرع الإنتاج',
  'تطريز خارجي',
  'تعديل ومقاسات',
].map((value) => ({ value, label: value }));

const initialTailorForm = {
  name: '',
  workshopName: '',
  phone: '',
  accessCode: '',
  notes: '',
};

const initialStockForm = {
  fabricId: '',
  purchasedLength: '',
  unitCost: '',
  supplier: '',
  purchaseBill: '',
  notes: '',
};

type PurchaseBillForm = {
  billNumber: string;
  purchaseDate: string;
  supplier: string;
  notes: string;
};

type PurchaseBillItem = {
  id: string;
  fabricId: string;
  purchasedLength: string;
  unitCost: string;
  minStock: string;
  notes: string;
};

type CreateFabricDialogState = {
  open: boolean;
  rowId: string | null;
  name: string;
  sku: string;
  color: string;
};

const todayInputValue = () => new Date().toISOString().split('T')[0];

const initialPurchaseBillForm = (): PurchaseBillForm => ({
  billNumber: '',
  purchaseDate: todayInputValue(),
  supplier: '',
  notes: '',
});

const createPurchaseBillItem = (): PurchaseBillItem => ({
  id: Math.random().toString(36).slice(2),
  fabricId: '',
  purchasedLength: '',
  unitCost: '',
  minStock: '',
  notes: '',
});

const initialCreateFabricDialog: CreateFabricDialogState = {
  open: false,
  rowId: null,
  name: '',
  sku: '',
  color: '',
};

const looksLikeSku = (value: string) => /[0-9]/.test(value) || /^[A-Za-z0-9_-]+$/.test(value);

const initialDeliveryForm = {
  issueId: '',
  deliveredDressCount: '',
  consumedLength: '',
  returnedLength: '',
  tailoringCost: '',
  extraCost: '',
  deliveryDate: new Date().toISOString().split('T')[0],
};

// Model-driven delivery: pick a dress model + count, deduct its full BOM.
const initialModelIssueForm = {
  designModelId: '',
  tailorId: '',
  plannedDressCount: '1',
  issueDate: new Date().toISOString().split('T')[0],
  reference: '',
  notes: '',
};

type AccessoryBillItem = {
  id: string;
  accessoryId: string;
  name: string;
  sku: string;
  purchasedQty: string;
  unitPrice: string;
  minStock: string;
};

const createAccessoryBillItem = (): AccessoryBillItem => ({
  id: Math.random().toString(36).slice(2),
  accessoryId: '',
  name: '',
  sku: '',
  purchasedQty: '',
  unitPrice: '',
  minStock: '',
});

type EditDrawerState =
  | { open: false; kind: null; entity: null }
  | { open: true; kind: 'fabric'; entity: Fabric }
  | { open: true; kind: 'accessory'; entity: Accessory };

const closedDrawer: EditDrawerState = { open: false, kind: null, entity: null };

export default function FabricManagementPage() {
  const [data, setData] = useState<FabricManagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lengthUnit, setLengthUnit] = useState('meter');
  const [tailorForm, setTailorForm] = useState(initialTailorForm);
  const [stockForm, setStockForm] = useState(initialStockForm);
  const [purchaseBillForm, setPurchaseBillForm] = useState<PurchaseBillForm>(() => initialPurchaseBillForm());
  const [purchaseBillItems, setPurchaseBillItems] = useState<PurchaseBillItem[]>(() => [createPurchaseBillItem()]);
  const [createFabricDialog, setCreateFabricDialog] = useState<CreateFabricDialogState>(initialCreateFabricDialog);
  const [deliveryForm, setDeliveryForm] = useState(initialDeliveryForm);
  const [modelIssueForm, setModelIssueForm] = useState(initialModelIssueForm);
  const [accessoryBillForm, setAccessoryBillForm] = useState<PurchaseBillForm>(() => initialPurchaseBillForm());
  const [accessoryBillItems, setAccessoryBillItems] = useState<AccessoryBillItem[]>(() => [createAccessoryBillItem()]);
  const [editDrawer, setEditDrawer] = useState<EditDrawerState>(closedDrawer);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fabric-management');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to fetch fabric data');
      setData(payload);
      setStockForm((current) => ({
        ...current,
        fabricId: current.fabricId || payload.fabrics[0]?.id || '',
      }));
      setDeliveryForm((current) => ({
        ...current,
        issueId: current.issueId || payload.issues[0]?.id || '',
      }));
      setModelIssueForm((current) => ({
        ...current,
        designModelId: current.designModelId || payload.models[0]?.id || '',
        tailorId: current.tailorId || payload.tailors[0]?.id || '',
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
  const supplierOptions = useMemo(() => SUPPLIER_OPTIONS, []);
  const workshopOptions = useMemo(
    () => mergeOptions(WORKSHOP_OPTIONS, data?.tailors.map((tailor) => tailor.workshopName) || [], true),
    [data?.tailors]
  );
  const fabricOptions = useMemo(
    () =>
      (data?.fabrics || []).map((fabric) => ({
        value: fabric.id,
        label: fabric.name,
        sku: fabric.sku || undefined,
        description: [
          fabric.sku ? `رمز: ${fabric.sku}` : null,
          fabric.color || 'بدون لون',
          formatDualLength(fabric.stockLength),
        ].filter(Boolean).join(' - '),
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
  const accessoryOptions = useMemo(
    () =>
      (data?.accessories || []).map((accessory) => ({
        value: accessory.id,
        label: accessory.name,
        sku: accessory.sku || undefined,
        description: [accessory.sku ? `رمز: ${accessory.sku}` : null, `${formatNumber(accessory.stockQty)} متاح`, formatCurrency(accessory.unitPrice)]
          .filter(Boolean)
          .join(' - '),
      })),
    [data?.accessories]
  );
  const modelOptions = useMemo(
    () =>
      (data?.models || []).map((model) => ({
        value: model.id,
        label: `${model.sku}${model.fabrics?.[0] ? ` — ${(data?.fabrics || []).find((f) => f.id === model.fabrics[0].fabricId)?.name || ''}` : ''}`,
        description: `قابل للإنتاج: ${formatNumber(model.producibleCount)} | تكلفة: ${formatCurrency(model.totalCost)}`,
      })),
    [data?.models, data?.fabrics]
  );
  const selectedIssueModel = useMemo(
    () => (data?.models || []).find((model) => model.id === modelIssueForm.designModelId) || null,
    [data?.models, modelIssueForm.designModelId]
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

  const updatePurchaseBillItem = (itemId: string, changes: Partial<PurchaseBillItem>) => {
    setPurchaseBillItems((currentItems) =>
      currentItems.map((item) => (item.id === itemId ? { ...item, ...changes } : item))
    );
  };

  const selectPurchaseBillFabric = (itemId: string, fabricId: string) => {
    const selectedFabric = data?.fabrics.find((fabric) => fabric.id === fabricId);
    updatePurchaseBillItem(itemId, {
      fabricId,
      unitCost: selectedFabric?.unitCost ? String(selectedFabric.unitCost) : '',
    });
  };

  const openCreateFabricDialog = (rowId: string, searchValue: string) => {
    const value = searchValue.trim();
    setCreateFabricDialog({
      open: true,
      rowId,
      name: looksLikeSku(value) ? '' : value,
      sku: looksLikeSku(value) ? value : '',
      color: '',
    });
  };

  const closeCreateFabricDialog = () => {
    setCreateFabricDialog(initialCreateFabricDialog);
  };

  const handleCreateFabricFromDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!createFabricDialog.name.trim()) {
      alert('اسم القماش مطلوب');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-fabric',
          name: createFabricDialog.name,
          sku: createFabricDialog.sku,
          color: createFabricDialog.color,
          supplier: purchaseBillForm.supplier,
          lengthUnit,
          stockLength: '',
          minStock: '',
          unitCost: '',
          notes: 'تم إنشاؤه من فاتورة شراء',
        }),
      });
      const createdFabric = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(createdFabric.error || 'فشل في إنشاء القماش');

      await fetchData();
      if (createFabricDialog.rowId && createdFabric.id) {
        updatePurchaseBillItem(createFabricDialog.rowId, {
          fabricId: createdFabric.id,
          unitCost: createdFabric.unitCost ? String(createdFabric.unitCost) : '',
        });
      }
      closeCreateFabricDialog();
    } catch (createError: any) {
      alert(createError.message || 'فشل في إنشاء القماش');
    } finally {
      setSaving(false);
    }
  };

  const addPurchaseBillItem = () => {
    setPurchaseBillItems((currentItems) => [...currentItems, createPurchaseBillItem()]);
  };

  const removePurchaseBillItem = (itemId: string) => {
    setPurchaseBillItems((currentItems) =>
      currentItems.length > 1 ? currentItems.filter((item) => item.id !== itemId) : currentItems
    );
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

  const handleStockSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await postAction({ action: 'add-fabric-stock', ...stockForm, lengthUnit });
    if (saved) {
      setStockForm({
        ...initialStockForm,
        fabricId: data?.fabrics[0]?.id || '',
      });
    }
  };

  const handlePurchaseBillSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (purchaseBillItems.some((item) => !item.fabricId)) {
      alert('اختر القماش لكل سطر أو أنشئ قماشاً جديداً من حقل القماش');
      return;
    }
    const saved = await postAction({
      action: 'create-purchase-bill',
      ...purchaseBillForm,
      lengthUnit,
      items: purchaseBillItems,
    });
    if (saved) {
      setPurchaseBillForm(initialPurchaseBillForm());
      setPurchaseBillItems([createPurchaseBillItem()]);
    }
  };

  const handleDeliverySubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await postAction({ action: 'record-delivery', ...deliveryForm, lengthUnit });
    if (saved) setDeliveryForm({ ...initialDeliveryForm, issueId: data?.issues[0]?.id || '' });
  };

  const handleModelIssueSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!modelIssueForm.designModelId || !modelIssueForm.tailorId) {
      alert('اختر الفستان والخياط');
      return;
    }
    const saved = await postAction({ action: 'issue-fabric', ...modelIssueForm });
    if (saved) {
      setModelIssueForm({
        ...initialModelIssueForm,
        designModelId: data?.models[0]?.id || '',
        tailorId: data?.tailors[0]?.id || '',
      });
    }
  };

  const updateAccessoryBillItem = (itemId: string, changes: Partial<AccessoryBillItem>) => {
    setAccessoryBillItems((items) => items.map((item) => (item.id === itemId ? { ...item, ...changes } : item)));
  };
  const selectAccessoryBillItem = (itemId: string, accessoryId: string) => {
    const accessory = data?.accessories.find((item) => item.id === accessoryId);
    updateAccessoryBillItem(itemId, {
      accessoryId,
      name: accessory?.name || '',
      sku: accessory?.sku || '',
      unitPrice: accessory?.unitPrice ? String(accessory.unitPrice) : '',
    });
  };
  const addAccessoryBillItem = () => setAccessoryBillItems((items) => [...items, createAccessoryBillItem()]);
  const removeAccessoryBillItem = (itemId: string) =>
    setAccessoryBillItems((items) => (items.length > 1 ? items.filter((item) => item.id !== itemId) : items));

  const handleAccessoryBillSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (accessoryBillItems.some((item) => !item.accessoryId && !item.name.trim())) {
      alert('اختر مستلزماً موجوداً أو اكتب اسم مستلزم جديد لكل سطر');
      return;
    }
    const saved = await postAction({
      action: 'create-accessory-purchase-bill',
      ...accessoryBillForm,
      items: accessoryBillItems,
    });
    if (saved) {
      setAccessoryBillForm(initialPurchaseBillForm());
      setAccessoryBillItems([createAccessoryBillItem()]);
    }
  };

  const handleDeleteFabric = async (fabric: Fabric) => {
    if (!confirm(`حذف القماش «${fabric.name}»؟`)) return;
    await postAction({ action: 'delete-fabric', fabricId: fabric.id });
  };
  const handleDeleteAccessory = async (accessory: Accessory) => {
    if (!confirm(`حذف المستلزم «${accessory.name}»؟`)) return;
    await postAction({ action: 'delete-accessory', accessoryId: accessory.id });
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

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-semibold">وحدة القياس</p>
              <p className="text-xs text-muted-foreground">تُطبّق على كل التبويبات: الكميات والتكاليف والاستهلاك</p>
            </div>
            <UnitToggle value={lengthUnit} onChange={setLengthUnit} />
          </div>

          <Tabs defaultValue="stock" className="w-full">
            <TabsList
              dir="rtl"
              style={{ direction: 'rtl' }}
              className="grid h-auto w-full grid-cols-2 items-stretch gap-1.5 overflow-visible rounded-lg bg-muted p-[3px] group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-4 lg:flex lg:flex-row lg:flex-wrap lg:justify-start"
            >
              <TabsTrigger value="stock" className="h-auto min-h-9 w-full whitespace-normal py-1.5 text-center leading-tight lg:min-w-[120px]">المخزون</TabsTrigger>
              <TabsTrigger value="tailors" className="relative h-auto min-h-9 w-full whitespace-normal py-1.5 text-center leading-tight lg:min-w-[120px]">
                الخياطون وطلباتهم
                {!!summary?.pendingRequestsCount && (
                  <span className="absolute -top-1 start-1/2 rounded-full bg-[#b8791f] px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {formatNumber(summary.pendingRequestsCount)} جديد
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="production" className="h-auto min-h-9 w-full whitespace-normal py-1.5 text-center leading-tight lg:min-w-[120px]">دورة الإنتاج</TabsTrigger>
              <TabsTrigger value="models" className="h-auto min-h-9 w-full whitespace-normal py-1.5 text-center leading-tight lg:min-w-[120px]">الموديلات</TabsTrigger>
            </TabsList>

            {/* ═════ المخزون ═════ */}
            <TabsContent value="stock" className="space-y-4">
              <FormAccordionCard marker="أ" title="إنشاء فاتورة جديدة" tag="فاتورة">
                <Tabs defaultValue="fabric-bill" className="w-full">
                  <TabsList dir="rtl" className="mb-4 grid w-full grid-cols-2">
                    <TabsTrigger value="fabric-bill">فاتورة شراء قماش</TabsTrigger>
                    <TabsTrigger value="accessory-bill">فاتورة شراء المستلزمات</TabsTrigger>
                  </TabsList>

                  <TabsContent value="fabric-bill">
                    <form onSubmit={handlePurchaseBillSubmit} dir="rtl" className="space-y-4 text-right">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
                        <TextInput label="رقم الفاتورة" value={purchaseBillForm.billNumber} onChange={(billNumber) => setPurchaseBillForm({ ...purchaseBillForm, billNumber })} required />
                        <TextInput label="تاريخ الشراء" type="date" value={purchaseBillForm.purchaseDate} onChange={(purchaseDate) => setPurchaseBillForm({ ...purchaseBillForm, purchaseDate })} required />
                        <SearchableSelect label="المورد" value={purchaseBillForm.supplier} options={supplierOptions} onChange={(supplier) => setPurchaseBillForm({ ...purchaseBillForm, supplier })} />
                      </div>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">الأقمشة في الفاتورة</p>
                          <Button type="button" size="sm" variant="outline" onClick={addPurchaseBillItem}>
                            <Plus className="size-4" />
                            إضافة قماش
                          </Button>
                        </div>
                        <div className="hidden rounded-lg border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid lg:grid-cols-[1.6fr_.75fr_.75fr_.75fr_.9fr_40px] lg:gap-2">
                          <span>القماش</span>
                          <span>الكمية</span>
                          <span>التكلفة</span>
                          <span>حد التنبيه</span>
                          <span>ملاحظات السطر</span>
                          <span />
                        </div>
                        {purchaseBillItems.map((item, index) => (
                          <PurchaseBillItemRow
                            key={item.id}
                            item={item}
                            index={index}
                            lengthUnit={lengthUnit}
                            fabricOptions={fabricOptions}
                            onFabricSelect={(fabricId) => selectPurchaseBillFabric(item.id, fabricId)}
                            onCreateFabric={(searchValue) => openCreateFabricDialog(item.id, searchValue)}
                            onChange={(changes) => updatePurchaseBillItem(item.id, changes)}
                            onRemove={() => removePurchaseBillItem(item.id)}
                            canRemove={purchaseBillItems.length > 1}
                          />
                        ))}
                      </div>
                      <Field>
                        <FieldLabel>ملاحظات الفاتورة</FieldLabel>
                        <Textarea value={purchaseBillForm.notes} onChange={(event) => setPurchaseBillForm({ ...purchaseBillForm, notes: event.target.value })} />
                      </Field>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">ابحث بالاسم أو الرمز. إذا لم تجد القماش، اختر إنشاء قماش جديد من نفس الحقل.</p>
                        <Button className="sm:w-fit" type="submit" disabled={saving}>
                          <FileText className="size-4" />
                          حفظ الفاتورة
                        </Button>
                      </div>
                    </form>
                  </TabsContent>

                  <TabsContent value="accessory-bill">
                    <form onSubmit={handleAccessoryBillSubmit} dir="rtl" className="space-y-4 text-right">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
                        <TextInput label="رقم الفاتورة" value={accessoryBillForm.billNumber} onChange={(billNumber) => setAccessoryBillForm({ ...accessoryBillForm, billNumber })} required />
                        <TextInput label="تاريخ الشراء" type="date" value={accessoryBillForm.purchaseDate} onChange={(purchaseDate) => setAccessoryBillForm({ ...accessoryBillForm, purchaseDate })} required />
                        <SearchableSelect label="المورد" value={accessoryBillForm.supplier} options={supplierOptions} onChange={(supplier) => setAccessoryBillForm({ ...accessoryBillForm, supplier })} />
                      </div>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">المستلزمات في الفاتورة</p>
                          <Button type="button" size="sm" variant="outline" onClick={addAccessoryBillItem}>
                            <Plus className="size-4" />
                            إضافة مستلزم
                          </Button>
                        </div>
                        {accessoryBillItems.map((item, index) => (
                          <AccessoryBillItemRow
                            key={item.id}
                            item={item}
                            index={index}
                            accessoryOptions={accessoryOptions}
                            onAccessorySelect={(accessoryId) => selectAccessoryBillItem(item.id, accessoryId)}
                            onChange={(changes) => updateAccessoryBillItem(item.id, changes)}
                            onRemove={() => removeAccessoryBillItem(item.id)}
                            canRemove={accessoryBillItems.length > 1}
                          />
                        ))}
                      </div>
                      <Field>
                        <FieldLabel>ملاحظات الفاتورة</FieldLabel>
                        <Textarea value={accessoryBillForm.notes} onChange={(event) => setAccessoryBillForm({ ...accessoryBillForm, notes: event.target.value })} />
                      </Field>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">اختر مستلزماً موجوداً للتزويد، أو اكتب اسم مستلزم جديد لإنشائه.</p>
                        <Button className="sm:w-fit" type="submit" disabled={saving}>
                          <FileText className="size-4" />
                          حفظ الفاتورة
                        </Button>
                      </div>
                    </form>
                  </TabsContent>
                </Tabs>
              </FormAccordionCard>

              <FormAccordionCard marker="ب" title="تعديل مخزون بدون فاتورة" description="استخدم هذا القسم لإضافة كمية واحدة كتصحيح يدوي منفصل عن فواتير الشراء" tag="تعديل يدوي">
                <form onSubmit={handleStockSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                  <SearchableSelect label="القماش" value={stockForm.fabricId} options={fabricOptions} onChange={(fabricId) => setStockForm({ ...stockForm, fabricId })} placeholder="اختر القماش" required />
                  <TextInput label={lengthUnit === 'yard' ? 'الكمية المشتراة بالياردة' : 'الكمية المشتراة بالمتر'} type="number" value={stockForm.purchasedLength} onChange={(purchasedLength) => setStockForm({ ...stockForm, purchasedLength })} required />
                  <TextInput label={lengthUnit === 'yard' ? 'تكلفة الياردة الجديدة' : 'تكلفة المتر الجديدة'} type="number" value={stockForm.unitCost} onChange={(unitCost) => setStockForm({ ...stockForm, unitCost })} />
                  <SearchableSelect label="المورد" value={stockForm.supplier} options={supplierOptions} onChange={(supplier) => setStockForm({ ...stockForm, supplier })} />
                  <Field className="md:col-span-3">
                    <FieldLabel>سبب التعديل أو ملاحظات</FieldLabel>
                    <Textarea value={stockForm.notes} onChange={(event) => setStockForm({ ...stockForm, notes: event.target.value })} />
                  </Field>
                  <Button className="justify-self-start md:w-fit" type="submit" disabled={saving || !data?.fabrics.length}>
                    <Ruler className="size-4" />
                    حفظ التعديل
                  </Button>
                </form>
              </FormAccordionCard>

              <div className="overflow-hidden rounded-lg border bg-card">
                <Tabs defaultValue="stock-fabric" className="w-full">
                  <div className="border-b px-3 pt-3">
                    <TabsList dir="rtl" className="grid w-full max-w-sm grid-cols-2">
                      <TabsTrigger value="stock-fabric">الأقمشة</TabsTrigger>
                      <TabsTrigger value="stock-acc">المستلزمات</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="stock-fabric" className="mt-0">
                    <FabricTable fabrics={data?.fabrics || []} onEdit={(fabric) => setEditDrawer({ open: true, kind: 'fabric', entity: fabric })} onDelete={(fabric) => void handleDeleteFabric(fabric)} />
                  </TabsContent>
                  <TabsContent value="stock-acc" className="mt-0">
                    <AccessoryTable accessories={data?.accessories || []} onEdit={(accessory) => setEditDrawer({ open: true, kind: 'accessory', entity: accessory })} onDelete={(accessory) => void handleDeleteAccessory(accessory)} />
                  </TabsContent>
                </Tabs>
              </div>
            </TabsContent>

            {/* ═════ الخياطون وطلباتهم ═════ */}
            <TabsContent value="tailors" className="space-y-4">
              <Tabs defaultValue="tailor-list" className="w-full">
                <TabsList dir="rtl" className="mb-4 grid w-full max-w-md grid-cols-2">
                  <TabsTrigger value="tailor-list">الخياطون</TabsTrigger>
                  <TabsTrigger value="tailor-req" className="relative">
                    طلبات الخياطين
                    {!!summary?.pendingRequestsCount && (
                      <span className="ms-1 rounded-full bg-[#faf0dc] px-1.5 py-0.5 text-[10px] font-bold text-[#b8791f]">
                        {formatNumber(summary.pendingRequestsCount)}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="tailor-list" className="space-y-4">
                  <FormAccordionCard marker="＋" title="إضافة خياط" description="بيانات الخياط ورمز دخوله لبوابة الخياطين">
                    <form onSubmit={handleTailorSubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-2">
                      <TextInput label="اسم الخياط" value={tailorForm.name} onChange={(name) => setTailorForm({ ...tailorForm, name })} required />
                      <SearchableSelect label="الورشة / نوع العمل" value={tailorForm.workshopName} options={workshopOptions} onChange={(workshopName) => setTailorForm({ ...tailorForm, workshopName })} allowCreate />
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
                  </FormAccordionCard>
                  <TailorsTable tailors={data?.tailors || []} />
                </TabsContent>
                <TabsContent value="tailor-req">
                  <RequestsTable requests={data?.requests || []} onStatusChange={(requestId, status) => void updateRequestStatus(requestId, status)} saving={saving} />
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* ═════ دورة الإنتاج ═════ */}
            <TabsContent value="production" className="space-y-4">
              <FormAccordionCard marker="⚙" title="دورة الإنتاج">
                <Tabs defaultValue="deliver" className="w-full">
                  <TabsList dir="rtl" className="mb-4 grid w-full grid-cols-2">
                    <TabsTrigger value="deliver">↑ تسليم القماش للخياط</TabsTrigger>
                    <TabsTrigger value="receive">↓ استلام الفساتين والتكلفة</TabsTrigger>
                  </TabsList>

                  <TabsContent value="deliver">
                    <form onSubmit={handleModelIssueSubmit} dir="rtl" className="space-y-4 text-right">
                      <SearchableSelect label="اختر الفستان" value={modelIssueForm.designModelId} options={modelOptions} onChange={(designModelId) => setModelIssueForm({ ...modelIssueForm, designModelId })} placeholder="اختر الفستان" required />
                      {selectedIssueModel && (
                        <ModelBomPreview model={selectedIssueModel} fabrics={data?.fabrics || []} count={Number(modelIssueForm.plannedDressCount) || 1} />
                      )}
                      <div className="grid gap-3 md:grid-cols-3">
                        <SearchableSelect label="الخياط" value={modelIssueForm.tailorId} options={tailorOptions} onChange={(tailorId) => setModelIssueForm({ ...modelIssueForm, tailorId })} placeholder="اختر الخياط" required />
                        <TextInput label="عدد الفساتين" type="number" value={modelIssueForm.plannedDressCount} onChange={(plannedDressCount) => setModelIssueForm({ ...modelIssueForm, plannedDressCount })} required />
                        <TextInput label="تاريخ التسليم" type="date" value={modelIssueForm.issueDate} onChange={(issueDate) => setModelIssueForm({ ...modelIssueForm, issueDate })} />
                        <TextInput label="مرجع" value={modelIssueForm.reference} onChange={(reference) => setModelIssueForm({ ...modelIssueForm, reference })} />
                        <Field className="md:col-span-2">
                          <FieldLabel>ملاحظات</FieldLabel>
                          <Textarea value={modelIssueForm.notes} onChange={(event) => setModelIssueForm({ ...modelIssueForm, notes: event.target.value })} />
                        </Field>
                      </div>
                      <Button type="submit" disabled={saving || !data?.models.length || !data?.tailors.length}>
                        <Send className="size-4" />
                        تسجيل التسليم
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="receive">
                    <form onSubmit={handleDeliverySubmit} dir="rtl" className="grid gap-3 text-right md:grid-cols-3">
                      <SearchableSelect label="سجل القماش" value={deliveryForm.issueId} options={issueOptions} onChange={(issueId) => setDeliveryForm({ ...deliveryForm, issueId })} placeholder="اختر سجل القماش" required />
                      <TextInput label="عدد الفساتين" type="number" value={deliveryForm.deliveredDressCount} onChange={(deliveredDressCount) => setDeliveryForm({ ...deliveryForm, deliveredDressCount })} />
                      <TextInput label={lengthUnit === 'yard' ? 'المستهلك من القماش بالياردة' : 'المستهلك من القماش بالمتر'} type="number" value={deliveryForm.consumedLength} onChange={(consumedLength) => setDeliveryForm({ ...deliveryForm, consumedLength })} />
                      <TextInput label={lengthUnit === 'yard' ? 'المرتجع للمخزون بالياردة' : 'المرتجع للمخزون بالمتر'} type="number" value={deliveryForm.returnedLength} onChange={(returnedLength) => setDeliveryForm({ ...deliveryForm, returnedLength })} />
                      <TextInput label="تكلفة الخياطة" type="number" value={deliveryForm.tailoringCost} onChange={(tailoringCost) => setDeliveryForm({ ...deliveryForm, tailoringCost })} />
                      <TextInput label="تكاليف إضافية" type="number" value={deliveryForm.extraCost} onChange={(extraCost) => setDeliveryForm({ ...deliveryForm, extraCost })} />
                      <TextInput label="تاريخ استلام الفساتين" type="date" value={deliveryForm.deliveryDate} onChange={(deliveryDate) => setDeliveryForm({ ...deliveryForm, deliveryDate })} />
                      <Button className="justify-self-start md:w-fit" type="submit" disabled={saving || !openIssues.length}>
                        <CheckCircle2 className="size-4" />
                        حفظ الاستلام
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </FormAccordionCard>
              <div className="space-y-2">
                <p className="text-sm font-semibold">سجل الحركات</p>
                <IssuesTable issues={data?.issues || []} showCost />
              </div>
            </TabsContent>

            <TabsContent value="models">
              <ModelsTabSpec
                fabrics={data?.fabrics || []}
                accessoriesInventory={data?.accessories || []}
                models={data?.models || []}
                onChanged={fetchData}
                unit={lengthUnit as 'meter' | 'yard'}
              />
            </TabsContent>
          </Tabs>
          <Dialog open={createFabricDialog.open} onOpenChange={(open) => !open && closeCreateFabricDialog()}>
            <DialogContent dir="rtl" className="text-right sm:max-w-xl">
              <DialogHeader className="text-right">
                <DialogTitle>إنشاء قماش جديد</DialogTitle>
                <DialogDescription>
                  احفظ القماش ثم سيتم اختياره تلقائياً في سطر الفاتورة.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateFabricFromDialog} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    label="اسم القماش"
                    value={createFabricDialog.name}
                    onChange={(name) => setCreateFabricDialog((current) => ({ ...current, name }))}
                    required
                  />
                  <TextInput
                    label="رمز القماش"
                    value={createFabricDialog.sku}
                    onChange={(sku) => setCreateFabricDialog((current) => ({ ...current, sku }))}
                  />
                </div>
                <SearchableSelect
                  label="اللون"
                  value={createFabricDialog.color}
                  options={fabricColorOptions}
                  onChange={(color) => setCreateFabricDialog((current) => ({ ...current, color }))}
                  allowCreate
                />
                <DialogFooter className="gap-2 sm:justify-start">
                  <Button type="submit" disabled={saving}>
                    <Plus className="size-4" />
                    حفظ واختيار القماش
                  </Button>
                  <Button type="button" variant="outline" onClick={closeCreateFabricDialog} disabled={saving}>
                    إلغاء
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <EditEntityDrawer
            state={editDrawer}
            lengthUnit={lengthUnit}
            saving={saving}
            onClose={() => setEditDrawer(closedDrawer)}
            onSave={async (payload) => {
              const ok = await postAction(payload);
              if (ok) setEditDrawer(closedDrawer);
            }}
          />
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

function FormAccordionCard({
  marker,
  title,
  description,
  tag,
  children,
}: {
  marker: string;
  title: string;
  description?: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-visible rounded-lg border bg-card text-card-foreground shadow-sm">
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm font-bold select-none group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            {marker}
          </span>
          <span>{title}</span>
          {tag && (
            <span className="me-1 rounded-full bg-[#faf0dc] px-2.5 py-0.5 text-[11px] font-bold text-[#b8791f]">
              {tag}
            </span>
          )}
          <span className="ms-auto text-muted-foreground transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="border-t p-4">
          {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
      </details>
    </div>
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

function UnitToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 rounded-md border bg-background p-1">
      {LENGTH_UNIT_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'ghost'}
          className="min-w-20"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function PurchaseBillItemRow({
  item,
  index,
  lengthUnit,
  fabricOptions,
  onFabricSelect,
  onCreateFabric,
  onChange,
  onRemove,
  canRemove,
}: {
  item: PurchaseBillItem;
  index: number;
  lengthUnit: string;
  fabricOptions: SelectOption[];
  onFabricSelect: (fabricId: string) => void;
  onCreateFabric: (searchValue: string) => void;
  onChange: (changes: Partial<PurchaseBillItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const quantityLabel = lengthUnit === 'yard' ? 'الكمية بالياردة' : 'الكمية بالمتر';
  const costLabel = lengthUnit === 'yard' ? 'تكلفة الياردة' : 'تكلفة المتر';
  const stockLabel = lengthUnit === 'yard' ? 'حد التنبيه بالياردة' : 'حد التنبيه بالمتر';

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
        <p className="text-sm font-bold">قماش {index + 1}</p>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label="حذف القماش">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_.75fr_.75fr_.75fr_.9fr_40px] lg:items-start lg:gap-2">
        <FabricLookupSelect
          label="القماش"
          value={item.fabricId}
          options={fabricOptions}
          onChange={onFabricSelect}
          onCreate={onCreateFabric}
          required
        />

        <TextInput
          label={quantityLabel}
          type="number"
          value={item.purchasedLength}
          onChange={(purchasedLength) => onChange({ purchasedLength })}
          required
        />
        <TextInput
          label={costLabel}
          type="number"
          value={item.unitCost}
          onChange={(unitCost) => onChange({ unitCost })}
        />
        <TextInput
          label={stockLabel}
          type="number"
          value={item.minStock}
          onChange={(minStock) => onChange({ minStock })}
        />
        <Field>
          <FieldLabel>ملاحظة السطر</FieldLabel>
          <Textarea
            value={item.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            className="min-h-9"
          />
        </Field>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="حذف القماش"
          className="mt-7 hidden lg:inline-flex"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function FabricLookupSelect({
  label,
  value,
  options,
  onChange,
  onCreate,
  required,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  onCreate: (searchValue: string) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedOption = options.find((option) => option.value === value);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => {
        const searchableText = `${option.label} ${option.value} ${option.description || ''}`.toLowerCase();
        return searchableText.includes(normalizedSearch);
      })
    : options;
  const hasExactOption = normalizedSearch
    ? options.some((option) => {
        const values = [option.label, option.value, option.sku || '', option.description || ''].map((item) =>
          item.trim().toLowerCase()
        );
        return values.includes(normalizedSearch);
      })
    : true;
  const showCreateOption = normalizedSearch.length > 0 && !hasExactOption;

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setSearch('');
    setOpen(false);
  };

  const createValue = () => {
    const nextSearch = search.trim();
    if (!nextSearch) return;
    onCreate(nextSearch);
    setSearch('');
    setOpen(false);
  };

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSearch('');
        }}
      >
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
              {selectedOption?.label || 'اختر أو اكتب قماش جديد'}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0" dir="rtl">
          <Command dir="rtl" className="text-right" shouldFilter={false}>
            <CommandInput
              className="text-right"
              placeholder="ابحث بالاسم أو الرمز..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {!filteredOptions.length && !showCreateOption && <CommandEmpty>لا توجد نتائج</CommandEmpty>}
              <CommandGroup>
                {showCreateOption && (
                  <CommandItem
                    value={`create-${search}`}
                    onSelect={createValue}
                    className="justify-between text-right"
                  >
                    <Plus className="size-4" />
                    <span className="min-w-0 flex-1 truncate text-right">
                      إنشاء قماش جديد: {search.trim()}
                    </span>
                  </CommandItem>
                )}
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description || ''}`}
                    onSelect={() => selectValue(option.value)}
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
  allowCreate = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedOption = options.find((option) => option.value === value);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => {
        const searchableText = `${option.label} ${option.value} ${option.description || ''}`.toLowerCase();
        return searchableText.includes(normalizedSearch);
      })
    : options;
  const creatableValue = search.trim();
  const hasExactOption = options.some(
    (option) =>
      option.value.trim().toLowerCase() === normalizedSearch ||
      option.label.trim().toLowerCase() === normalizedSearch
  );
  const showCreateOption = allowCreate && creatableValue.length > 0 && !hasExactOption;

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setSearch('');
    setOpen(false);
  };

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSearch('');
        }}
      >
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
          <Command dir="rtl" className="text-right" shouldFilter={false}>
            <CommandInput
              className="text-right"
              placeholder={allowCreate ? 'بحث أو إضافة...' : 'بحث...'}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {!filteredOptions.length && !showCreateOption && <CommandEmpty>لا توجد نتائج</CommandEmpty>}
              <CommandGroup>
                {showCreateOption && (
                  <CommandItem
                    value={creatableValue}
                    onSelect={() => selectValue(creatableValue)}
                    className="justify-between text-right"
                  >
                    <Plus className="size-4" />
                    <span className="min-w-0 flex-1 truncate text-right">إضافة {creatableValue}</span>
                  </CommandItem>
                )}
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value || '__empty__'}
                    value={`${option.label} ${option.description || ''}`}
                    onSelect={() => selectValue(option.value)}
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

function FabricTable({
  fabrics,
  onEdit,
  onDelete,
}: {
  fabrics: Fabric[];
  onEdit: (fabric: Fabric) => void;
  onDelete: (fabric: Fabric) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border-t bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>القماش</TableHead>
            <TableHead>رمز القماش</TableHead>
            <TableHead>اللون</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>المخزون</TableHead>
            <TableHead>تكلفة المتر</TableHead>
            <TableHead>إجراء</TableHead>
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
              <TableCell>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={() => onEdit(fabric)}>تعديل</Button>
                  <Button size="xs" variant="ghost" className="text-destructive" onClick={() => onDelete(fabric)}>حذف</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!fabrics.length && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                لا توجد أقمشة مسجلة
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function AccessoryTable({
  accessories,
  onEdit,
  onDelete,
}: {
  accessories: Accessory[];
  onEdit: (accessory: Accessory) => void;
  onDelete: (accessory: Accessory) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border-t bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>المستلزم</TableHead>
            <TableHead>رقم المنتج</TableHead>
            <TableHead>المخزون</TableHead>
            <TableHead>السعر</TableHead>
            <TableHead>إجراء</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accessories.map((accessory) => (
            <TableRow key={accessory.id}>
              <TableCell className="font-medium">{accessory.name}</TableCell>
              <TableCell>{accessory.sku || '-'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {formatNumber(accessory.stockQty)}
                  {accessory.isLowStock && <Badge variant="secondary">منخفض</Badge>}
                </div>
              </TableCell>
              <TableCell>{formatCurrency(accessory.unitPrice)}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={() => onEdit(accessory)}>تعديل</Button>
                  <Button size="xs" variant="ghost" className="text-destructive" onClick={() => onDelete(accessory)}>حذف</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!accessories.length && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                لا توجد مستلزمات مسجلة
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function AccessoryBillItemRow({
  item,
  index,
  accessoryOptions,
  onAccessorySelect,
  onChange,
  onRemove,
  canRemove,
}: {
  item: AccessoryBillItem;
  index: number;
  accessoryOptions: SelectOption[];
  onAccessorySelect: (accessoryId: string) => void;
  onChange: (changes: Partial<AccessoryBillItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold">مستلزم {index + 1}</p>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label="حذف المستلزم">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        <SearchableSelect label="المستلزم الموجود" value={item.accessoryId} options={accessoryOptions} onChange={onAccessorySelect} placeholder="اختر أو اترك فارغاً لمستلزم جديد" />
        <TextInput label="اسم مستلزم جديد" value={item.name} onChange={(name) => onChange({ name })} />
        <TextInput label="الكمية" type="number" value={item.purchasedQty} onChange={(purchasedQty) => onChange({ purchasedQty })} required />
        <TextInput label="السعر" type="number" value={item.unitPrice} onChange={(unitPrice) => onChange({ unitPrice })} />
      </div>
    </div>
  );
}

function ModelBomPreview({
  model,
  fabrics,
  count,
}: {
  model: DesignModel;
  fabrics: Fabric[];
  count: number;
}) {
  const safeCount = Math.max(1, count || 1);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted px-3 py-2 text-xs font-bold text-primary">
        مكونات الفستان — {model.sku} (×{formatNumber(safeCount)})
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>المكوّن</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>الاستهلاك للقطعة</TableHead>
            <TableHead>الإجمالي المطلوب</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.fabrics.map((row) => {
            const fabric = fabrics.find((item) => item.id === row.fabricId);
            const per = Number(row.consumption) || 0;
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{fabric?.name || '-'}</TableCell>
                <TableCell>قماش</TableCell>
                <TableCell>{formatNumber(per)}</TableCell>
                <TableCell>{formatNumber(per * safeCount)}</TableCell>
              </TableRow>
            );
          })}
          {model.accessories.filter((row) => row.accessoryId).map((row) => {
            const per = Number(row.consumption) || 0;
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name || '-'}</TableCell>
                <TableCell>مستلزم</TableCell>
                <TableCell>{formatNumber(per)}</TableCell>
                <TableCell>{formatNumber(per * safeCount)}</TableCell>
              </TableRow>
            );
          })}
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
            <TableHead>القماش / رمز المنتج</TableHead>
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
              <TableCell>
                <div className="space-y-1">
                  <p className="font-medium">{issue.fabric.name}</p>
                  <p className="text-xs text-muted-foreground">{issue.fabric.sku || 'لا يوجد رمز'}</p>
                </div>
              </TableCell>
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
            <TableHead>نوع الطلب</TableHead>
            <TableHead>القماش / التفاصيل</TableHead>
            <TableHead>الكمية</TableHead>
            <TableHead>التكلفة</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>التاريخ</TableHead>
            <TableHead>إجراء</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell className="font-medium">{request.tailor.name}</TableCell>
              <TableCell>
                <Badge variant={request.requestType === 'purchase' ? 'default' : 'secondary'}>
                  {request.requestType === 'purchase' ? 'شراء قماش' : 'طلب مخزون'}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <p className="font-medium">
                    {request.requestType === 'purchase'
                      ? request.purchaseName || request.fabric?.name || '-'
                      : request.fabric?.name || '-'}
                  </p>
                  {request.requestType === 'purchase' && (
                    <p className="text-xs text-muted-foreground">
                      {[request.purchaseSku && `رمز: ${request.purchaseSku}`, request.purchaseColor, request.purchaseFabricType, request.purchaseSupplier]
                        .filter(Boolean)
                        .join(' · ') || 'تفاصيل الشراء غير مكتملة'}
                    </p>
                  )}
                  {request.notes && <p className="text-xs text-muted-foreground">{request.notes}</p>}
                </div>
              </TableCell>
              <TableCell>{formatDualLength(request.requestedLength)}</TableCell>
              <TableCell>{formatCurrency(request.purchaseUnitCost)}</TableCell>
              <TableCell>
                <Badge variant={request.status === 'pending' ? 'secondary' : 'default'}>{request.status}</Badge>
                {request.approvedBy && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    بواسطة {request.approvedBy}
                  </p>
                )}
              </TableCell>
              <TableCell>{formatDate(request.createdAt)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" disabled={saving} onClick={() => onStatusChange(request.id, 'approved')}>
                    {request.requestType === 'purchase' ? 'اعتماد وإدخال' : 'موافقة'}
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
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                لا توجد طلبات من الخياطين
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

type EditFormState = Record<string, string>;

function EditEntityDrawer({
  state,
  lengthUnit,
  saving,
  onClose,
  onSave,
}: {
  state: EditDrawerState;
  lengthUnit: string;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [form, setForm] = useState<EditFormState>({});
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const entityId = state.open ? state.entity.id : null;
  const kind = state.open ? state.kind : null;

  useEffect(() => {
    if (!state.open) return;
    if (state.kind === 'fabric') {
      const f = state.entity;
      setForm({
        name: f.name,
        sku: f.sku || '',
        color: f.color || '',
        fabricType: f.fabricType || '',
        stockLength: String(f.stockLength),
        unitCost: String(f.unitCost),
        minStock: String(f.minStock),
        notes: f.notes || '',
      });
    } else if (state.kind === 'accessory') {
      const a = state.entity;
      setForm({
        name: a.name,
        sku: a.sku || '',
        stockQty: String(a.stockQty),
        unitPrice: String(a.unitPrice),
        minStock: String(a.minStock),
        notes: a.notes || '',
      });
    }
  }, [state]);

  useEffect(() => {
    if (!entityId || !kind) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLogsLoading(true);
    fetch('/api/fabric-management', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-audit', entityType: kind, entityId }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (!cancelled) setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, kind]);

  const setField = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleSave = () => {
    if (!state.open) return;
    if (state.kind === 'fabric') {
      void onSave({ action: 'update-fabric', fabricId: state.entity.id, lengthUnit, ...form });
    } else {
      void onSave({ action: 'update-accessory', accessoryId: state.entity.id, ...form });
    }
  };

  const title = state.open ? `تعديل — ${state.entity.name}` : 'تعديل';

  return (
    <Sheet open={state.open} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 text-right sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>عدّل البيانات ثم احفظ. كل تغيير يُسجّل في سجل التعديلات.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {state.open && state.kind === 'fabric' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="اسم القماش" value={form.name || ''} onChange={(v) => setField('name', v)} />
              <TextInput label="رمز القماش" value={form.sku || ''} onChange={(v) => setField('sku', v)} />
              <TextInput label="اللون" value={form.color || ''} onChange={(v) => setField('color', v)} />
              <TextInput label="النوع" value={form.fabricType || ''} onChange={(v) => setField('fabricType', v)} />
              <TextInput label={lengthUnit === 'yard' ? 'المخزون (ياردة)' : 'المخزون (متر)'} type="number" value={form.stockLength || ''} onChange={(v) => setField('stockLength', v)} />
              <TextInput label={lengthUnit === 'yard' ? 'تكلفة الياردة' : 'تكلفة المتر'} type="number" value={form.unitCost || ''} onChange={(v) => setField('unitCost', v)} />
              <TextInput label={lengthUnit === 'yard' ? 'حد التنبيه (ياردة)' : 'حد التنبيه (متر)'} type="number" value={form.minStock || ''} onChange={(v) => setField('minStock', v)} />
              <Field className="sm:col-span-2">
                <FieldLabel>ملاحظات</FieldLabel>
                <Textarea value={form.notes || ''} onChange={(event) => setField('notes', event.target.value)} />
              </Field>
            </div>
          )}
          {state.open && state.kind === 'accessory' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="اسم المستلزم" value={form.name || ''} onChange={(v) => setField('name', v)} />
              <TextInput label="رقم المنتج" value={form.sku || ''} onChange={(v) => setField('sku', v)} />
              <TextInput label="المخزون" type="number" value={form.stockQty || ''} onChange={(v) => setField('stockQty', v)} />
              <TextInput label="السعر" type="number" value={form.unitPrice || ''} onChange={(v) => setField('unitPrice', v)} />
              <TextInput label="حد التنبيه" type="number" value={form.minStock || ''} onChange={(v) => setField('minStock', v)} />
              <Field className="sm:col-span-2">
                <FieldLabel>ملاحظات</FieldLabel>
                <Textarea value={form.notes || ''} onChange={(event) => setField('notes', event.target.value)} />
              </Field>
            </div>
          )}

          <details className="mt-4 overflow-hidden rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between bg-muted px-3 py-2 text-sm font-bold select-none [&::-webkit-details-marker]:hidden">
              <span>
                سجل التعديلات
                <span className="ms-2 rounded-full bg-muted-foreground px-1.5 py-0.5 text-[10px] font-bold text-white">{logs.length}</span>
              </span>
              <span className="text-muted-foreground">▾</span>
            </summary>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>الحقل</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logsLoading && (
                    <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">جاري التحميل…</TableCell></TableRow>
                  )}
                  {!logsLoading && !logs.length && (
                    <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">لا توجد تعديلات مسجّلة</TableCell></TableRow>
                  )}
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                      <TableCell>{log.changedBy}</TableCell>
                      <TableCell>{log.field}</TableCell>
                      <TableCell className="text-muted-foreground">{log.oldValue ?? '—'}</TableCell>
                      <TableCell>{log.newValue ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button onClick={handleSave} disabled={saving}>حفظ التعديل</Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>إلغاء</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
