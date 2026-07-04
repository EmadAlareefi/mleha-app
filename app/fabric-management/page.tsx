'use client';

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import {
  ChevronDown,
  FileText,
  PackagePlus,
  Plus,
  RefreshCw,
  Ruler,
  Scissors,
  Send,
  Trash2,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { ModelsTabSpec, type DesignModel } from './models-tab-spec';
import './fabric-design.css';

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
  atWarehouse?: number;
  atTailors?: number;
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

type Supplier = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  address?: string | null;
  notes?: string | null;
};

type AuditLog = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  createdAt: string;
};

type PurchaseInvoiceItem = {
  id: string;
  itemType: 'fabric' | 'accessory' | string;
  fabricId?: string | null;
  accessoryId?: string | null;
  productName: string;
  productNumber?: string | null;
  unit?: string | null;
  quantity: number;
  unitCost: number;
  vatRate: number;
  lineTotalExclVat: number;
  vatAmount: number;
  lineTotalInclVat: number;
  extractionConfidence?: string | null;
  notes?: string | null;
};

type PurchaseInvoice = {
  id: string;
  invoiceNumber: string;
  documentType?: string | null;
  supplier?: string | null;
  purchaseDate?: string | null;
  currency: string;
  subtotalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  sourceFile?: string | null;
  notes?: string | null;
  items: PurchaseInvoiceItem[];
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
  embroideryCost: number;
  extraCost: number;
  remainingAtTailor: number;
  totalDressCost: number;
  costPerDress: number | null;
  deliveryDate?: string | null;
  designModelId?: string | null;
  plannedDressCount?: number | null;
  size?: string | null;
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

type DeliveryNote = {
  id: string;
  noteNumber: string;
  dressCount: number;
  size?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  tailoringCost: number;
  embroideryCost: number;
  extraCost: number;
  componentsConsumed?: {
    fabrics?: Array<{ fabricId: string; name: string; meters: number }>;
    accessories?: Array<{ accessoryId: string; name: string; qty: number }>;
  } | null;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  sallaSyncStatus?: string | null;
  sallaSyncError?: string | null;
  createdAt: string;
  tailor?: { id: string; name: string; workshopName?: string | null };
  designModel?: { id: string; sku: string };
};

type FabricManagementData = {
  fabrics: Fabric[];
  accessories: Accessory[];
  issues: TailorFabricIssue[];
  requests: TailorFabricRequest[];
  models: DesignModel[];
  suppliers: Supplier[];
  purchaseInvoices: PurchaseInvoice[];
  deliveryNotes: DeliveryNote[];
  tailorFabricBalances: Array<{ fabricId: string; tailorId: string; heldMeters: number }>;
  summary: {
    fabricsCount: number;
    accessoriesCount: number;
    stockMeters: number;
    withTailorsMeters: number;
    pendingRequestsCount: number;
    modelsCount: number;
    purchaseInvoicesCount: number;
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
});

const initialCreateFabricDialog: CreateFabricDialogState = {
  open: false,
  rowId: null,
  name: '',
  sku: '',
  color: '',
};

type CreateSupplierDialogState = {
  open: boolean;
  target: 'fabric' | 'accessory' | null;
  name: string;
  phone: string;
  email: string;
  contactPerson: string;
  address: string;
  notes: string;
};

const initialCreateSupplierDialog: CreateSupplierDialogState = {
  open: false,
  target: null,
  name: '',
  phone: '',
  email: '',
  contactPerson: '',
  address: '',
  notes: '',
};

const looksLikeSku = (value: string) => /[0-9]/.test(value) || /^[A-Za-z0-9_-]+$/.test(value);

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

const initialTailorRequestForm = {
  fabricId: '',
  requestedLength: '',
  notes: '',
  purchaseName: '',
  purchaseSku: '',
  purchaseColor: '',
  purchaseFabricType: '',
  purchaseSupplier: '',
  purchaseUnitCost: '',
};

const initialDeliveryRequestForm = {
  designModelId: '',
  dressCount: '1',
  size: '',
  tailoringCost: '',
  embroideryCost: '',
  extraCost: '',
  notes: '',
};

export default function FabricManagementPage() {
  const [data, setData] = useState<FabricManagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lengthUnit, setLengthUnit] = useState('meter');
  const [purchaseBillForm, setPurchaseBillForm] = useState<PurchaseBillForm>(() => initialPurchaseBillForm());
  const [purchaseBillItems, setPurchaseBillItems] = useState<PurchaseBillItem[]>(() => [createPurchaseBillItem()]);
  const [createFabricDialog, setCreateFabricDialog] = useState<CreateFabricDialogState>(initialCreateFabricDialog);
  const [createSupplierDialog, setCreateSupplierDialog] = useState<CreateSupplierDialogState>(initialCreateSupplierDialog);
  const [accessoryBillForm, setAccessoryBillForm] = useState<PurchaseBillForm>(() => initialPurchaseBillForm());
  const [accessoryBillItems, setAccessoryBillItems] = useState<AccessoryBillItem[]>(() => [createAccessoryBillItem()]);
  const [editDrawer, setEditDrawer] = useState<EditDrawerState>(closedDrawer);
  const [tailorRequestTab, setTailorRequestTab] = useState<'stock' | 'purchase'>('stock');
  const [tailorRequestForm, setTailorRequestForm] = useState(initialTailorRequestForm);
  const [deliveryRequestForm, setDeliveryRequestForm] = useState(initialDeliveryRequestForm);
  const [openingBalanceTab, setOpeningBalanceTab] = useState<'fabric' | 'accessory'>('fabric');
  const [openingBalanceForm, setOpeningBalanceForm] = useState({ fabricId: '', accessoryId: '', quantity: '', notes: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fabric-management');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to fetch fabric data');
      setData(payload);
    } catch (fetchError: any) {
      setError(fetchError.message || 'فشل في جلب بيانات الأقمشة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const fabricColorOptions = useMemo(
    () => mergeOptions(FABRIC_COLOR_OPTIONS, data?.fabrics.map((fabric) => fabric.color) || [], true),
    [data?.fabrics]
  );
  const supplierOptions = useMemo<SelectOption[]>(
    () =>
      (data?.suppliers || []).map((supplier) => ({
        value: supplier.name,
        label: supplier.name,
        description: [supplier.contactPerson, supplier.phone].filter(Boolean).join(' - ') || undefined,
      })),
    [data?.suppliers]
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
  // Pared-down pickers for the tailor view: the scoped API payload carries no
  // stock levels or costs, so these skip the quantities shown in fabricOptions.
  const tailorFabricOptions = useMemo<SelectOption[]>(
    () =>
      (data?.fabrics || []).map((fabric) => ({
        value: fabric.id,
        label: fabric.name,
        sku: fabric.sku || undefined,
        description: [fabric.sku ? `رمز: ${fabric.sku}` : null, fabric.color].filter(Boolean).join(' - ') || undefined,
      })),
    [data?.fabrics]
  );
  const modelOptions = useMemo<SelectOption[]>(
    () =>
      (data?.models || []).map((model) => ({
        value: model.id,
        label: model.sku,
        description: [model.sallaProductName, model.size].filter(Boolean).join(' - ') || undefined,
      })),
    [data?.models]
  );
  const tailorBalances = useMemo(
    () =>
      (data?.tailorFabricBalances || []).map((balance) => ({
        ...balance,
        fabricName: data?.fabrics.find((fabric) => fabric.id === balance.fabricId)?.name || balance.fabricId,
      })),
    [data?.tailorFabricBalances, data?.fabrics]
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
      if (createFabricDialog.rowId === 'opening-balance' && createdFabric.id) {
        setOpeningBalanceForm((current) => ({ ...current, fabricId: createdFabric.id }));
      } else if (createFabricDialog.rowId && createdFabric.id) {
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

  const openCreateSupplierDialog = (target: 'fabric' | 'accessory', searchValue: string) => {
    setCreateSupplierDialog({ ...initialCreateSupplierDialog, open: true, target, name: searchValue.trim() });
  };

  const closeCreateSupplierDialog = () => {
    setCreateSupplierDialog(initialCreateSupplierDialog);
  };

  const handleCreateSupplierFromDialog = async (event: FormEvent) => {
    event.preventDefault();
    const name = createSupplierDialog.name.trim();
    if (!name) {
      alert('اسم المورّد مطلوب');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-supplier',
          name,
          phone: createSupplierDialog.phone,
          email: createSupplierDialog.email,
          contactPerson: createSupplierDialog.contactPerson,
          address: createSupplierDialog.address,
          notes: createSupplierDialog.notes,
        }),
      });
      const createdSupplier = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(createdSupplier.error || 'فشل في إنشاء المورّد');

      const supplierName = createdSupplier.name || name;
      const target = createSupplierDialog.target;
      await fetchData();
      if (target === 'fabric') {
        setPurchaseBillForm((current) => ({ ...current, supplier: supplierName }));
      } else if (target === 'accessory') {
        setAccessoryBillForm((current) => ({ ...current, supplier: supplierName }));
      }
      closeCreateSupplierDialog();
    } catch (createError: any) {
      alert(createError.message || 'فشل في إنشاء المورّد');
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

  const handleTailorRequestSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const isPurchase = tailorRequestTab === 'purchase';
    if (!isPurchase && !tailorRequestForm.fabricId) {
      alert('اختر القماش المطلوب');
      return;
    }
    const ok = await postAction({
      action: 'create-tailor-request',
      requestType: isPurchase ? 'purchase' : 'stock_request',
      fabricId: isPurchase ? undefined : tailorRequestForm.fabricId,
      requestedLength: tailorRequestForm.requestedLength,
      lengthUnit,
      notes: tailorRequestForm.notes,
      purchaseName: isPurchase ? tailorRequestForm.purchaseName : undefined,
      purchaseSku: isPurchase ? tailorRequestForm.purchaseSku : undefined,
      purchaseColor: isPurchase ? tailorRequestForm.purchaseColor : undefined,
      purchaseFabricType: isPurchase ? tailorRequestForm.purchaseFabricType : undefined,
      purchaseSupplier: isPurchase ? tailorRequestForm.purchaseSupplier : undefined,
      purchaseUnitCost:
        isPurchase && tailorRequestForm.purchaseUnitCost !== '' ? tailorRequestForm.purchaseUnitCost : undefined,
    });
    if (ok) setTailorRequestForm(initialTailorRequestForm);
  };

  const handleOpeningBalanceSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const isAccessory = openingBalanceTab === 'accessory';
    if (isAccessory ? !openingBalanceForm.accessoryId : !openingBalanceForm.fabricId) {
      alert(isAccessory ? 'اختر المستلزم' : 'اختر القماش');
      return;
    }
    const ok = await postAction({
      action: 'add-opening-balance',
      itemType: openingBalanceTab,
      fabricId: isAccessory ? undefined : openingBalanceForm.fabricId,
      accessoryId: isAccessory ? openingBalanceForm.accessoryId : undefined,
      quantity: openingBalanceForm.quantity,
      lengthUnit,
      notes: openingBalanceForm.notes,
    });
    if (ok) setOpeningBalanceForm({ fabricId: '', accessoryId: '', quantity: '', notes: '' });
  };

  const handleCreateAccessoryForOpening = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-accessory', name: trimmed }),
      });
      const created = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(created.error || 'فشل في إنشاء المستلزم');
      await fetchData();
      if (created.id) setOpeningBalanceForm((current) => ({ ...current, accessoryId: created.id }));
    } catch (createError: any) {
      alert(createError.message || 'فشل في إنشاء المستلزم');
    } finally {
      setSaving(false);
    }
  };

  const handleDeliveryRequestSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!deliveryRequestForm.designModelId) {
      alert('اختر الموديل');
      return;
    }
    const ok = await postAction({
      action: 'create-delivery-request',
      designModelId: deliveryRequestForm.designModelId,
      dressCount: deliveryRequestForm.dressCount,
      size: deliveryRequestForm.size || undefined,
      tailoringCost: deliveryRequestForm.tailoringCost === '' ? undefined : deliveryRequestForm.tailoringCost,
      embroideryCost: deliveryRequestForm.embroideryCost === '' ? undefined : deliveryRequestForm.embroideryCost,
      extraCost: deliveryRequestForm.extraCost === '' ? undefined : deliveryRequestForm.extraCost,
      notes: deliveryRequestForm.notes,
    });
    if (ok) setDeliveryRequestForm(initialDeliveryRequestForm);
  };

  const summary = data?.summary;

  const { data: session, status: sessionStatus } = useSession();
  const userServiceKeys: string[] = (session?.user as any)?.serviceKeys || [];
  // Manufacturer accounts are tailors and get the self-scoped creation view —
  // but only when they hold no fabric service keys. The مصنع flag is also set
  // on regular staff accounts (it predates this feature), so fabric access and
  // the admin role always win over it. Mirrors the API's requireAccess gate.
  const isAdminUser = (session?.user as any)?.role === 'admin';
  const isTailorOnly =
    (session?.user as any)?.userType === 'manufacturer' &&
    !isAdminUser &&
    !userServiceKeys.includes('fabric-warehouse') &&
    !userServiceKeys.includes('fabric-management');
  // Scoped to the fabric section specifically (not the user's overall role set) —
  // a warehouse worker often also holds unrelated permissions elsewhere (e.g.
  // salla-products for SKU search) that carry other roles as a side effect, so
  // checking aggregate roles would wrongly exclude them from this restriction.
  const isWarehouseOnly =
    !isAdminUser && userServiceKeys.includes('fabric-warehouse') && !userServiceKeys.includes('fabric-management');
  // Both restricted audiences only ever see the two request tabs.
  const isRestrictedView = isWarehouseOnly || isTailorOnly;

  const [tab, setTab] = useState<'stock' | 'tailor-requests' | 'models' | 'invoices' | 'delivery-requests' | 'opening-balance'>('stock');
  const [stockBillTab, setStockBillTab] = useState<'fabric' | 'accessory'>('fabric');
  const [stockTableTab, setStockTableTab] = useState<'fabric' | 'accessory'>('fabric');

  const pendingCount = summary?.pendingRequestsCount || 0;
  const pendingDeliveryCount = (data?.deliveryNotes || []).filter((note) => note.status === 'SUBMITTED').length;
  const allowedTabs = isTailorOnly
    ? ['tailor-requests', 'delivery-requests', 'models', 'invoices', 'opening-balance']
    : isWarehouseOnly
      ? ['tailor-requests', 'delivery-requests', 'opening-balance']
      : ['stock', 'tailor-requests', 'models', 'invoices', 'delivery-requests', 'opening-balance'];
  const activeTab = allowedTabs.includes(tab) ? tab : isRestrictedView ? 'tailor-requests' : 'stock';

  const fabricBillTotal = purchaseBillItems.reduce(
    (sum, item) => sum + (Number(item.purchasedLength) || 0) * (Number(item.unitCost) || 0),
    0
  );
  const accessoryBillTotal = accessoryBillItems.reduce(
    (sum, item) => sum + (Number(item.purchasedQty) || 0) * (Number(item.unitPrice) || 0),
    0
  );

  // Shared between the stock tab (admins) and the invoices tab (tailors record
  // their self-bought fabric; the API books it onto their own balance).
  const fabricBillForm = (
    <form onSubmit={handlePurchaseBillSubmit}>
      <div className="grid" style={{ marginBottom: 14 }}>
        <TextInput label="رقم الفاتورة" value={purchaseBillForm.billNumber} onChange={(billNumber) => setPurchaseBillForm({ ...purchaseBillForm, billNumber })} required />
        <TextInput label="تاريخ الشراء" type="date" value={purchaseBillForm.purchaseDate} onChange={(purchaseDate) => setPurchaseBillForm({ ...purchaseBillForm, purchaseDate })} required />
        <DesignSelect label="اسم المورد" value={purchaseBillForm.supplier} options={supplierOptions} onChange={(supplier) => setPurchaseBillForm({ ...purchaseBillForm, supplier })} onCreate={(name) => openCreateSupplierDialog('fabric', name)} searchable fallbackLabel={purchaseBillForm.supplier} />
      </div>
      <div className="section-label" style={{ marginBottom: 10 }}>الأقمشة في الفاتورة</div>
      <div className="inv-head">
        <div>القماش</div><div>رقم المنتج</div><div>الكمية</div><div>التكلفة</div><div>حد التنبيه</div><div>الإجمالي</div><div></div>
      </div>
      {purchaseBillItems.map((item) => (
        <PurchaseBillItemRow
          key={item.id}
          item={item}
          fabricOptions={fabricOptions}
          onFabricSelect={(fabricId) => selectPurchaseBillFabric(item.id, fabricId)}
          onCreateFabric={(searchValue) => openCreateFabricDialog(item.id, searchValue)}
          onChange={(changes) => updatePurchaseBillItem(item.id, changes)}
          onRemove={() => removePurchaseBillItem(item.id)}
          canRemove={purchaseBillItems.length > 1}
        />
      ))}
      <div className="inv-total">
        <span>إجمالي الفاتورة</span>
        <span className="inv-total-val">{formatCurrency(fabricBillTotal)}</span>
      </div>
      <button type="button" className="btn-add-row" onClick={addPurchaseBillItem}><Plus size={15} /> إضافة قماش</button>
      <TextAreaField label="ملاحظات الفاتورة" value={purchaseBillForm.notes} onChange={(notes) => setPurchaseBillForm({ ...purchaseBillForm, notes })} />
      <p className="muted-note" style={{ marginTop: 8 }}>ابحث بالاسم أو الرمز. إذا لم تجد القماش، اختر إنشاء قماش جديد من نفس الحقل.</p>
      <button className="btn" type="submit" disabled={saving}><FileText /> حفظ الفاتورة</button>
    </form>
  );

  return (
    <AppPageShell
      title="إدارة الأقمشة"
      subtitle="تتبع مخزون الأقمشة والكميات لدى الخياطين وتكلفة الفساتين النهائية"
    >
      <div className="fab-design" dir="rtl">
        <div className="wrap">
          <div className="toolbar-row">
            <span className="muted-note">إدارة شاملة للأقمشة والمستلزمات والموديلات ودورة الإنتاج</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-outline" onClick={() => void fetchData()} disabled={loading}>
                <RefreshCw />
                تحديث
              </button>
            </div>
          </div>

          {error && <div className="err-box">{error}</div>}

          {(loading && !data) || sessionStatus === 'loading' ? (
            <LoadingState label="جاري تحميل بيانات الأقمشة" />
          ) : (
            <>
              {!isTailorOnly && (
                <div className="stats-row">
                  <StatCard title="أنواع الأقمشة" value={formatNumber(summary?.fabricsCount)} icon={<Scissors />} />
                  <StatCard title="المخزون المتاح" value={formatDualLength(summary?.stockMeters)} icon={<Ruler />} />
                  <StatCard title="لدى الخياطين" value={formatDualLength(summary?.withTailorsMeters)} icon={<Send />} />
                  <StatCard title="طلبات معلقة" value={formatNumber(summary?.pendingRequestsCount)} icon={<PackagePlus />} />
                </div>
              )}

              <div className="unit-bar">
                <span className="unit-bar-label">وحدة القياس</span>
                <span className="unit-bar-hint">تُطبّق على كل التبويبات: الكميات والتكاليف والاستهلاك</span>
                <UnitToggle value={lengthUnit} onChange={setLengthUnit} />
              </div>

              <div className="tablist">
                {!isRestrictedView && (
                  <button type="button" className={`tab ${activeTab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>المخزون</button>
                )}
                <button type="button" className={`tab ${activeTab === 'tailor-requests' ? 'active' : ''}`} onClick={() => setTab('tailor-requests')}>
                  طلبات الخياطين
                  {pendingCount > 0 && <span className="tab-badge">{formatNumber(pendingCount)} جديد</span>}
                </button>
                <button type="button" className={`tab ${activeTab === 'delivery-requests' ? 'active' : ''}`} onClick={() => setTab('delivery-requests')}>
                  طلبات التسليم
                  {pendingDeliveryCount > 0 && <span className="tab-badge">{formatNumber(pendingDeliveryCount)} جديد</span>}
                </button>
                {!isWarehouseOnly && (
                  <button type="button" className={`tab ${activeTab === 'models' ? 'active' : ''}`} onClick={() => setTab('models')}>الموديلات</button>
                )}
                {!isWarehouseOnly && (
                  <button type="button" className={`tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setTab('invoices')}>فواتير الشراء</button>
                )}
                <button type="button" className={`tab ${activeTab === 'opening-balance' ? 'active' : ''}`} onClick={() => setTab('opening-balance')}>رصيد افتتاحي</button>
              </div>

              {/* ═════ المخزون ═════ */}
              {!isRestrictedView && activeTab === 'stock' && (
                <div>
                  <FormAccordionCard marker="أ" title="إنشاء فاتورة جديدة" tag="فاتورة">
                    <div className="subtabs">
                      <button type="button" className={`subtab ${stockBillTab === 'fabric' ? 'active' : ''}`} onClick={() => setStockBillTab('fabric')}>فاتورة شراء قماش</button>
                      <button type="button" className={`subtab ${stockBillTab === 'accessory' ? 'active' : ''}`} onClick={() => setStockBillTab('accessory')}>فاتورة شراء المستلزمات</button>
                    </div>

                    {stockBillTab === 'fabric' && fabricBillForm}

                    {stockBillTab === 'accessory' && (
                      <form onSubmit={handleAccessoryBillSubmit}>
                        <div className="grid" style={{ marginBottom: 14 }}>
                          <TextInput label="رقم الفاتورة" value={accessoryBillForm.billNumber} onChange={(billNumber) => setAccessoryBillForm({ ...accessoryBillForm, billNumber })} required />
                          <TextInput label="تاريخ الشراء" type="date" value={accessoryBillForm.purchaseDate} onChange={(purchaseDate) => setAccessoryBillForm({ ...accessoryBillForm, purchaseDate })} required />
                          <DesignSelect label="اسم المورد" value={accessoryBillForm.supplier} options={supplierOptions} onChange={(supplier) => setAccessoryBillForm({ ...accessoryBillForm, supplier })} onCreate={(name) => openCreateSupplierDialog('accessory', name)} searchable fallbackLabel={accessoryBillForm.supplier} />
                        </div>
                        <div className="section-label" style={{ marginBottom: 10 }}>المستلزمات في الفاتورة</div>
                        <div className="inv-head acc-inv-head">
                          <div>المستلزم</div><div>رقم المنتج</div><div>الكمية</div><div>السعر</div><div>الإجمالي</div><div></div>
                        </div>
                        {accessoryBillItems.map((item) => (
                          <AccessoryBillItemRow
                            key={item.id}
                            item={item}
                            accessoryOptions={accessoryOptions}
                            onAccessorySelect={(accessoryId) => selectAccessoryBillItem(item.id, accessoryId)}
                            onChange={(changes) => updateAccessoryBillItem(item.id, changes)}
                            onRemove={() => removeAccessoryBillItem(item.id)}
                            canRemove={accessoryBillItems.length > 1}
                          />
                        ))}
                        <div className="inv-total">
                          <span>إجمالي الفاتورة</span>
                          <span className="inv-total-val">{formatCurrency(accessoryBillTotal)}</span>
                        </div>
                        <button type="button" className="btn-add-row" onClick={addAccessoryBillItem}><Plus size={15} /> إضافة مستلزم</button>
                        <TextAreaField label="ملاحظات الفاتورة" value={accessoryBillForm.notes} onChange={(notes) => setAccessoryBillForm({ ...accessoryBillForm, notes })} />
                        <p className="muted-note" style={{ marginTop: 8 }}>اختر مستلزماً موجوداً للتزويد، أو اكتب اسم مستلزم جديد لإنشائه.</p>
                        <button className="btn" type="submit" disabled={saving}><FileText /> حفظ الفاتورة</button>
                      </form>
                    )}
                  </FormAccordionCard>

                  <div className="card">
                    <div className="subtabs" style={{ marginBottom: 0, padding: '0 14px' }}>
                      <button type="button" className={`subtab ${stockTableTab === 'fabric' ? 'active' : ''}`} onClick={() => setStockTableTab('fabric')}>الأقمشة</button>
                      <button type="button" className={`subtab ${stockTableTab === 'accessory' ? 'active' : ''}`} onClick={() => setStockTableTab('accessory')}>المستلزمات</button>
                    </div>
                    {stockTableTab === 'fabric' ? (
                      <FabricTable fabrics={data?.fabrics || []} onEdit={(fabric) => setEditDrawer({ open: true, kind: 'fabric', entity: fabric })} onDelete={(fabric) => void handleDeleteFabric(fabric)} />
                    ) : (
                      <AccessoryTable accessories={data?.accessories || []} onEdit={(accessory) => setEditDrawer({ open: true, kind: 'accessory', entity: accessory })} onDelete={(accessory) => void handleDeleteAccessory(accessory)} />
                    )}
                  </div>
                </div>
              )}

              {/* ═════ طلبات الخياطين ═════ */}
              {activeTab === 'tailor-requests' && (
                <div>
                  {isTailorOnly && (
                    <FormAccordionCard marker="ط" title="طلب قماش جديد" tag="طلب">
                      <div className="subtabs">
                        <button type="button" className={`subtab ${tailorRequestTab === 'stock' ? 'active' : ''}`} onClick={() => setTailorRequestTab('stock')}>طلب من المخزون</button>
                        <button type="button" className={`subtab ${tailorRequestTab === 'purchase' ? 'active' : ''}`} onClick={() => setTailorRequestTab('purchase')}>شراء قماش</button>
                      </div>
                      <form onSubmit={handleTailorRequestSubmit}>
                        <div className="grid" style={{ marginBottom: 14 }}>
                          {tailorRequestTab === 'stock' ? (
                            <DesignSelect
                              label="القماش"
                              value={tailorRequestForm.fabricId}
                              options={tailorFabricOptions}
                              onChange={(fabricId) => setTailorRequestForm({ ...tailorRequestForm, fabricId })}
                              searchable
                            />
                          ) : (
                            <>
                              <TextInput label="اسم القماش" value={tailorRequestForm.purchaseName} onChange={(purchaseName) => setTailorRequestForm({ ...tailorRequestForm, purchaseName })} required />
                              <TextInput label="رمز القماش" value={tailorRequestForm.purchaseSku} onChange={(purchaseSku) => setTailorRequestForm({ ...tailorRequestForm, purchaseSku })} />
                              <DesignSelect label="اللون" value={tailorRequestForm.purchaseColor} options={fabricColorOptions} onChange={(purchaseColor) => setTailorRequestForm({ ...tailorRequestForm, purchaseColor })} allowCreate searchable />
                              <TextInput label="نوع القماش" value={tailorRequestForm.purchaseFabricType} onChange={(purchaseFabricType) => setTailorRequestForm({ ...tailorRequestForm, purchaseFabricType })} />
                              <TextInput label="المورد" value={tailorRequestForm.purchaseSupplier} onChange={(purchaseSupplier) => setTailorRequestForm({ ...tailorRequestForm, purchaseSupplier })} />
                              <TextInput label={`تكلفة ${lengthUnit === 'yard' ? 'الياردة' : 'المتر'}`} type="number" value={tailorRequestForm.purchaseUnitCost} onChange={(purchaseUnitCost) => setTailorRequestForm({ ...tailorRequestForm, purchaseUnitCost })} />
                            </>
                          )}
                          <TextInput label={`الكمية المطلوبة (${lengthUnit === 'yard' ? 'ياردة' : 'متر'})`} type="number" value={tailorRequestForm.requestedLength} onChange={(requestedLength) => setTailorRequestForm({ ...tailorRequestForm, requestedLength })} required />
                        </div>
                        <TextAreaField label="ملاحظات" value={tailorRequestForm.notes} onChange={(notes) => setTailorRequestForm({ ...tailorRequestForm, notes })} />
                        <button className="btn" type="submit" disabled={saving}><PackagePlus /> إرسال الطلب</button>
                      </form>
                    </FormAccordionCard>
                  )}
                  <div className="card">
                    <div className="subtab-body">
                      <RequestsTable
                        requests={data?.requests || []}
                        onStatusChange={(requestId, status) => void updateRequestStatus(requestId, status)}
                        saving={saving}
                        readOnly={isTailorOnly}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ═════ طلبات التسليم ═════ */}
              {activeTab === 'delivery-requests' && (
                <div>
                  {isTailorOnly && (
                    <>
                      {tailorBalances.length > 0 && (
                        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
                          <div className="section-label" style={{ marginBottom: 8 }}>رصيدك من الأقمشة</div>
                          {tailorBalances.map((balance) => (
                            <div key={balance.fabricId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
                              <span>{balance.fabricName}</span>
                              <b>{formatDualLength(balance.heldMeters)}</b>
                            </div>
                          ))}
                        </div>
                      )}
                      <FormAccordionCard marker="ت" title="طلب تسليم جديد" tag="تسليم" description="اختر الموديل وعدد القطع الجاهزة — يُرسل الطلب لمراجعة المستودع وقبوله.">
                        <form onSubmit={handleDeliveryRequestSubmit}>
                          <div className="grid" style={{ marginBottom: 14 }}>
                            <DesignSelect
                              label="الموديل"
                              value={deliveryRequestForm.designModelId}
                              options={modelOptions}
                              onChange={(designModelId) => setDeliveryRequestForm({ ...deliveryRequestForm, designModelId })}
                              searchable
                            />
                            <TextInput label="عدد القطع" type="number" value={deliveryRequestForm.dressCount} onChange={(dressCount) => setDeliveryRequestForm({ ...deliveryRequestForm, dressCount })} required />
                            <TextInput label="المقاس" value={deliveryRequestForm.size} onChange={(size) => setDeliveryRequestForm({ ...deliveryRequestForm, size })} />
                            <TextInput label="تكلفة الخياطة" type="number" value={deliveryRequestForm.tailoringCost} onChange={(tailoringCost) => setDeliveryRequestForm({ ...deliveryRequestForm, tailoringCost })} />
                            <TextInput label="تكلفة التطريز" type="number" value={deliveryRequestForm.embroideryCost} onChange={(embroideryCost) => setDeliveryRequestForm({ ...deliveryRequestForm, embroideryCost })} />
                            <TextInput label="تكاليف إضافية" type="number" value={deliveryRequestForm.extraCost} onChange={(extraCost) => setDeliveryRequestForm({ ...deliveryRequestForm, extraCost })} />
                          </div>
                          <TextAreaField label="ملاحظات" value={deliveryRequestForm.notes} onChange={(notes) => setDeliveryRequestForm({ ...deliveryRequestForm, notes })} />
                          <button className="btn" type="submit" disabled={saving}><Send /> إرسال طلب التسليم</button>
                        </form>
                      </FormAccordionCard>
                    </>
                  )}
                  <div className="card">
                    <div className="subtab-body">
                      <DeliveryRequestsTable
                        notes={
                          isTailorOnly
                            ? data?.deliveryNotes || []
                            : (data?.deliveryNotes || []).filter((note) => note.status === 'SUBMITTED')
                        }
                        onAccept={(noteId) => void postAction({ action: 'accept-delivery-note', noteId })}
                        onReject={(noteId, rejectionReason) => void postAction({ action: 'reject-delivery-note', noteId, rejectionReason })}
                        saving={saving}
                        readOnly={isTailorOnly}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ═════ الموديلات ═════ */}
              {!isWarehouseOnly && activeTab === 'models' && (
                <ModelsTabSpec
                  fabrics={data?.fabrics || []}
                  accessoriesInventory={data?.accessories || []}
                  models={data?.models || []}
                  onChanged={fetchData}
                  unit={lengthUnit as 'meter' | 'yard'}
                />
              )}

              {!isWarehouseOnly && activeTab === 'invoices' && (
                <div>
                  {isTailorOnly && (
                    <FormAccordionCard
                      marker="ف"
                      title="فاتورة شراء قماش"
                      tag="فاتورة"
                      description="سجّل القماش الذي اشتريته بنفسك — تُضاف الكمية مباشرة إلى رصيدك من الأقمشة."
                    >
                      {fabricBillForm}
                    </FormAccordionCard>
                  )}
                  <InvoicesTab invoices={data?.purchaseInvoices || []} />
                </div>
              )}

              {/* ═════ رصيد افتتاحي ═════ */}
              {activeTab === 'opening-balance' && (
                <div>
                  <FormAccordionCard
                    marker="ر"
                    title="إضافة رصيد افتتاحي"
                    tag="جرد"
                    description={
                      isTailorOnly
                        ? 'سجّل الكميات الموجودة لديك حالياً بدون فاتورة — تُضاف مباشرة إلى رصيدك.'
                        : 'سجّل الكميات الموجودة في المستودع حالياً بدون فاتورة شراء.'
                    }
                  >
                    <div className="subtabs">
                      <button type="button" className={`subtab ${openingBalanceTab === 'fabric' ? 'active' : ''}`} onClick={() => setOpeningBalanceTab('fabric')}>الأقمشة</button>
                      <button type="button" className={`subtab ${openingBalanceTab === 'accessory' ? 'active' : ''}`} onClick={() => setOpeningBalanceTab('accessory')}>الاكسسوارات</button>
                    </div>
                    <form onSubmit={handleOpeningBalanceSubmit}>
                      <div className="grid" style={{ marginBottom: 14 }}>
                        {openingBalanceTab === 'fabric' ? (
                          <DesignSelect
                            label="القماش"
                            value={openingBalanceForm.fabricId}
                            options={isTailorOnly ? tailorFabricOptions : fabricOptions}
                            onChange={(fabricId) => setOpeningBalanceForm({ ...openingBalanceForm, fabricId })}
                            onCreate={(name) => openCreateFabricDialog('opening-balance', name)}
                            searchable
                          />
                        ) : (
                          <DesignSelect
                            label="المستلزم"
                            value={openingBalanceForm.accessoryId}
                            options={accessoryOptions}
                            onChange={(accessoryId) => setOpeningBalanceForm({ ...openingBalanceForm, accessoryId })}
                            onCreate={(name) => void handleCreateAccessoryForOpening(name)}
                            searchable
                          />
                        )}
                        <TextInput
                          label={openingBalanceTab === 'fabric' ? `الكمية (${lengthUnit === 'yard' ? 'ياردة' : 'متر'})` : 'الكمية'}
                          type="number"
                          value={openingBalanceForm.quantity}
                          onChange={(quantity) => setOpeningBalanceForm({ ...openingBalanceForm, quantity })}
                          required
                        />
                      </div>
                      <TextAreaField label="ملاحظات" value={openingBalanceForm.notes} onChange={(notes) => setOpeningBalanceForm({ ...openingBalanceForm, notes })} />
                      <p className="muted-note" style={{ marginTop: 8 }}>إذا لم تجد الصنف في القائمة، اكتب اسمه واختر إنشاءه من نفس الحقل.</p>
                      <button className="btn" type="submit" disabled={saving}><PackagePlus /> إضافة الرصيد</button>
                    </form>
                  </FormAccordionCard>
                  {isTailorOnly && tailorBalances.length > 0 && (
                    <div className="card" style={{ padding: 14 }}>
                      <div className="section-label" style={{ marginBottom: 8 }}>رصيدك من الأقمشة</div>
                      {tailorBalances.map((balance) => (
                        <div key={balance.fabricId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
                          <span>{balance.fabricName}</span>
                          <b>{formatDualLength(balance.heldMeters)}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <CreateFabricDrawer
                state={createFabricDialog}
                saving={saving}
                colorOptions={fabricColorOptions}
                onClose={closeCreateFabricDialog}
                onChange={(changes) => setCreateFabricDialog((current) => ({ ...current, ...changes }))}
                onSubmit={handleCreateFabricFromDialog}
              />
              <CreateSupplierDrawer
                state={createSupplierDialog}
                saving={saving}
                onClose={closeCreateSupplierDialog}
                onChange={(changes) => setCreateSupplierDialog((current) => ({ ...current, ...changes }))}
                onSubmit={handleCreateSupplierFromDialog}
              />
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
      </div>
    </AppPageShell>
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

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-inner">
        <div>
          <p className="k">{title}</p>
          <p className="v">{value}</p>
        </div>
        <div className="stat-ico">{icon}</div>
      </div>
    </div>
  );
}

function InvoicesTab({ invoices }: { invoices: PurchaseInvoice[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!invoices.length) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        لا توجد فواتير شراء مسجّلة بعد.
      </div>
    );
  }

  const totals = invoices.reduce(
    (sum, inv) => ({
      subtotal: sum.subtotal + inv.subtotalExclVat,
      vat: sum.vat + inv.vatAmount,
      total: sum.total + inv.totalInclVat,
    }),
    { subtotal: 0, vat: 0, total: 0 }
  );

  return (
    <div>
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <StatCard title="عدد الفواتير" value={formatNumber(invoices.length)} icon={<FileText />} />
        <StatCard title="الإجمالي قبل الضريبة" value={formatCurrency(totals.subtotal)} icon={<FileText />} />
        <StatCard title="إجمالي الضريبة" value={formatCurrency(totals.vat)} icon={<FileText />} />
        <StatCard title="الإجمالي شامل الضريبة" value={formatCurrency(totals.total)} icon={<FileText />} />
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="cards-mobile">
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>التاريخ</th>
              <th>المورد</th>
              <th>الأصناف</th>
              <th>قبل الضريبة</th>
              <th>الضريبة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const isOpen = expanded === invoice.id;
              return (
                <Fragment key={invoice.id}>
                  <tr
                    style={{ cursor: 'pointer' }}
                    onClick={() => setExpanded(isOpen ? null : invoice.id)}
                  >
                    <td data-label="رقم الفاتورة">
                      {isOpen ? '▾ ' : '▸ '}
                      {invoice.invoiceNumber}
                    </td>
                    <td data-label="التاريخ">{formatDate(invoice.purchaseDate)}</td>
                    <td data-label="المورد">{invoice.supplier || '-'}</td>
                    <td data-label="الأصناف">{formatNumber(invoice.items.length)}</td>
                    <td data-label="قبل الضريبة">{formatCurrency(invoice.subtotalExclVat)}</td>
                    <td data-label="الضريبة">{formatCurrency(invoice.vatAmount)}</td>
                    <td data-label="الإجمالي">{formatCurrency(invoice.totalInclVat)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: '#f8fafc', padding: 12 }}>
                        <table className="log-table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>الصنف</th>
                              <th>النوع</th>
                              <th>رقم المنتج</th>
                              <th>الوحدة</th>
                              <th>الكمية</th>
                              <th>سعر الوحدة</th>
                              <th>الإجمالي شامل الضريبة</th>
                              <th>الثقة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoice.items.map((item) => (
                              <tr key={item.id}>
                                <td>{item.productName}</td>
                                <td>{item.itemType === 'accessory' ? 'مستلزم' : 'قماش'}</td>
                                <td>{item.productNumber || '-'}</td>
                                <td>{item.unit || '-'}</td>
                                <td>{formatNumber(item.quantity)}</td>
                                <td>{formatCurrency(item.unitCost)}</td>
                                <td>{formatCurrency(item.lineTotalInclVat)}</td>
                                <td>{item.extractionConfidence || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnitToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="unit-toggle">
      {LENGTH_UNIT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`unit-btn ${value === option.value ? 'active' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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
    <details className="acc" open>
      <summary>
        <span className="ico">{marker}</span>
        <span>{title}</span>
        {tag && <span className="tag">{tag}</span>}
        <ChevronDown className="chev" />
      </summary>
      <div className="acc-body">
        {description && <p className="muted-note" style={{ margin: '0 0 12px' }}>{description}</p>}
        {children}
      </div>
    </details>
  );
}

const inputResetStyle: React.CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'right',
};

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
    <div className="field">
      <label>{label}</label>
      <div className="inp">
        <input
          type={type}
          value={value}
          required={required}
          min={type === 'number' ? '0' : undefined}
          step={type === 'number' ? '0.01' : undefined}
          onChange={(event) => onChange(event.target.value)}
          style={inputResetStyle}
        />
      </div>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      <textarea className="inp area" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function DesignSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'اختر',
  allowCreate = false,
  onCreate,
  searchable = false,
  className = '',
  bare = false,
  fallbackLabel = '',
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowCreate?: boolean;
  onCreate?: (value: string) => void;
  searchable?: boolean;
  className?: string;
  bare?: boolean;
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((option) => option.value === value && option.value !== '');
  const normalized = search.trim().toLowerCase();
  const showInput = searchable || allowCreate || !!onCreate;
  const filtered = normalized
    ? options.filter((option) =>
        `${option.label} ${option.value} ${option.description || ''} ${option.sku || ''}`.toLowerCase().includes(normalized)
      )
    : options;
  const creatable = search.trim();
  const hasExact = options.some(
    (option) => option.value.trim().toLowerCase() === normalized || option.label.trim().toLowerCase() === normalized
  );
  const showCreate = (allowCreate || !!onCreate) && creatable.length > 0 && !hasExact;

  const choose = (next: string) => {
    onChange(next);
    setSearch('');
    setOpen(false);
  };
  const doCreate = () => {
    if (!creatable) return;
    if (onCreate) onCreate(creatable);
    else onChange(creatable);
    setSearch('');
    setOpen(false);
  };

  const wrap = (
    <div className="sel-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`sel-trigger ${open ? 'open' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="sel-val" style={selected || fallbackLabel ? undefined : { color: 'var(--muted-foreground)' }}>
            {selected ? selected.label : fallbackLabel || placeholder}
          </span>
          <span className="sel-chev">▾</span>
        </button>
        <div className={`sel-menu ${open ? 'open' : ''}`}>
          {showInput && (
            <div className="sel-add-row" style={{ borderTop: 0, borderBottom: '1px solid var(--border)', borderRadius: '8px 8px 0 0' }}>
              <input
                className="sel-add-input"
                placeholder={onCreate ? 'ابحث أو أنشئ…' : allowCreate ? 'ابحث أو أضف…' : 'بحث…'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && showCreate) {
                    event.preventDefault();
                    doCreate();
                  }
                }}
                autoFocus
              />
            </div>
          )}
          <div className="sel-options-list">
            {showCreate && (
              <button type="button" className="sel-option" style={{ color: 'var(--primary)', fontWeight: 700 }} onClick={doCreate}>
                ＋ {onCreate ? `إنشاء جديد: ${creatable}` : `إضافة: ${creatable}`}
              </button>
            )}
            {filtered.map((option) => (
              <button
                key={option.value || '__empty__'}
                type="button"
                className={`sel-option ${option.value === value ? 'selected' : ''}`}
                onClick={() => choose(option.value)}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                  <span>{option.label}</span>
                  {option.description && <span style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>{option.description}</span>}
                </span>
              </button>
            ))}
            {!filtered.length && !showCreate && (
              <div className="sel-option" style={{ color: 'var(--muted-foreground)', cursor: 'default' }}>لا توجد نتائج</div>
            )}
          </div>
        </div>
      </div>
  );

  if (bare) return wrap;
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {wrap}
    </div>
  );
}

function PurchaseBillItemRow({
  item,
  fabricOptions,
  onFabricSelect,
  onCreateFabric,
  onChange,
  onRemove,
  canRemove,
}: {
  item: PurchaseBillItem;
  fabricOptions: SelectOption[];
  onFabricSelect: (fabricId: string) => void;
  onCreateFabric: (searchValue: string) => void;
  onChange: (changes: Partial<PurchaseBillItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const sku = fabricOptions.find((option) => option.value === item.fabricId)?.sku || '';
  const rowTotal = (Number(item.purchasedLength) || 0) * (Number(item.unitCost) || 0);
  return (
    <div className="inv-row">
      <DesignSelect bare placeholder="أضف / اختر القماش" value={item.fabricId} options={fabricOptions} onChange={onFabricSelect} onCreate={onCreateFabric} searchable />
      <div className="field" data-label="رقم المنتج"><div className="inp" style={{ color: 'var(--muted-foreground)' }}>{sku || '—'}</div></div>
      <div className="field" data-label="الكمية">
        <div className="inp"><input type="number" min="0" step="0.01" value={item.purchasedLength} required onChange={(event) => onChange({ purchasedLength: event.target.value })} style={inputResetStyle} /></div>
      </div>
      <div className="field" data-label="التكلفة">
        <div className="inp"><input type="number" min="0" step="0.01" value={item.unitCost} onChange={(event) => onChange({ unitCost: event.target.value })} style={inputResetStyle} /></div>
      </div>
      <div className="field" data-label="حد التنبيه">
        <div className="inp"><input type="number" min="0" step="0.01" value={item.minStock} onChange={(event) => onChange({ minStock: event.target.value })} style={inputResetStyle} /></div>
      </div>
      <div className="field auto" data-label="الإجمالي"><div className="inp">{formatCurrency(rowTotal)}</div></div>
      <button type="button" className="iconbtn del" onClick={onRemove} disabled={!canRemove} aria-label="حذف القماش"><Trash2 /></button>
    </div>
  );
}

function AccessoryBillItemRow({
  item,
  accessoryOptions,
  onAccessorySelect,
  onChange,
  onRemove,
  canRemove,
}: {
  item: AccessoryBillItem;
  accessoryOptions: SelectOption[];
  onAccessorySelect: (accessoryId: string) => void;
  onChange: (changes: Partial<AccessoryBillItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const rowTotal = (Number(item.purchasedQty) || 0) * (Number(item.unitPrice) || 0);
  return (
    <div className="inv-row acc-inv-row">
      <DesignSelect bare placeholder="أضف / اختر المستلزم" value={item.accessoryId} fallbackLabel={item.name} options={accessoryOptions} onChange={onAccessorySelect} onCreate={(name) => onChange({ accessoryId: '', name, sku: '' })} searchable />
      <div className="field" data-label="رقم المنتج"><div className="inp" style={{ color: 'var(--muted-foreground)' }}>{item.sku || '—'}</div></div>
      <div className="field" data-label="الكمية">
        <div className="inp"><input type="number" min="0" step="0.01" value={item.purchasedQty} required onChange={(event) => onChange({ purchasedQty: event.target.value })} style={inputResetStyle} /></div>
      </div>
      <div className="field" data-label="السعر">
        <div className="inp"><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => onChange({ unitPrice: event.target.value })} style={inputResetStyle} /></div>
      </div>
      <div className="field auto" data-label="الإجمالي"><div className="inp">{formatCurrency(rowTotal)}</div></div>
      <button type="button" className="iconbtn del" onClick={onRemove} disabled={!canRemove} aria-label="حذف المستلزم"><Trash2 /></button>
    </div>
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
    <div className="table-wrap">
      <table className="cards-mobile">
        <thead>
          <tr>
            <th>القماش</th>
            <th>رمز القماش</th>
            <th>اللون</th>
            <th>النوع</th>
            <th>الإجمالي</th>
            <th>في المستودع</th>
            <th>لدى الخياطين</th>
            <th>تكلفة المتر</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          {fabrics.map((fabric) => (
            <tr key={fabric.id}>
              <td data-label="القماش"><b>{fabric.name}</b></td>
              <td data-label="رمز القماش" style={{ color: 'var(--muted-foreground)' }}>{fabric.sku || '-'}</td>
              <td data-label="اللون">{fabric.color || '-'}</td>
              <td data-label="النوع">{fabric.fabricType || '-'}</td>
              <td data-label="الإجمالي">
                {formatDualLength(fabric.stockLength)}
                {fabric.isLowStock && <span className="low-badge">منخفض</span>}
              </td>
              <td data-label="في المستودع">{formatDualLength(fabric.atWarehouse ?? fabric.stockLength)}</td>
              <td data-label="لدى الخياطين">{formatDualLength(fabric.atTailors ?? 0)}</td>
              <td data-label="تكلفة المتر">{formatCurrency(fabric.unitCost)}</td>
              <td data-label="إجراء" className="actions-cell">
                <div className="td-actions">
                  <button type="button" className="tbl-btn edit" onClick={() => onEdit(fabric)}>تعديل</button>
                  <button type="button" className="tbl-btn del" onClick={() => onDelete(fabric)}>حذف</button>
                </div>
              </td>
            </tr>
          ))}
          {!fabrics.length && (
            <tr><td className="empty-row" colSpan={9}>لا توجد أقمشة مسجلة</td></tr>
          )}
        </tbody>
      </table>
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
    <div className="table-wrap">
      <table className="cards-mobile">
        <thead>
          <tr>
            <th>المستلزم</th>
            <th>رقم المنتج</th>
            <th>المخزون</th>
            <th>السعر</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          {accessories.map((accessory) => (
            <tr key={accessory.id}>
              <td data-label="المستلزم"><b>{accessory.name}</b></td>
              <td data-label="رقم المنتج" style={{ color: 'var(--muted-foreground)' }}>{accessory.sku || '-'}</td>
              <td data-label="المخزون">
                {formatNumber(accessory.stockQty)}
                {accessory.isLowStock && <span className="low-badge">منخفض</span>}
              </td>
              <td data-label="السعر">{formatCurrency(accessory.unitPrice)}</td>
              <td data-label="إجراء" className="actions-cell">
                <div className="td-actions">
                  <button type="button" className="tbl-btn edit" onClick={() => onEdit(accessory)}>تعديل</button>
                  <button type="button" className="tbl-btn del" onClick={() => onDelete(accessory)}>حذف</button>
                </div>
              </td>
            </tr>
          ))}
          {!accessories.length && (
            <tr><td className="empty-row" colSpan={5}>لا توجد مستلزمات مسجلة</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function requestStatusPill(status: string) {
  if (status === 'pending') return 'warn';
  if (status === 'rejected') return 'red';
  return 'ok';
}

function RequestsTable({
  requests,
  onStatusChange,
  saving,
  readOnly = false,
}: {
  requests: TailorFabricRequest[];
  onStatusChange: (requestId: string, status: string) => void;
  saving: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="cards-mobile">
        <thead>
          <tr>
            <th>الخياط</th>
            <th>نوع الطلب</th>
            <th>القماش / التفاصيل</th>
            <th>الكمية</th>
            <th>التكلفة</th>
            <th>الحالة</th>
            <th>التاريخ</th>
            {!readOnly && <th>إجراء</th>}
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td data-label="الخياط"><b>{request.tailor.name}</b></td>
              <td data-label="نوع الطلب">
                <span className="pill muted">{request.requestType === 'purchase' ? 'شراء قماش' : 'طلب مخزون'}</span>
              </td>
              <td data-label="القماش / التفاصيل">
                <b>
                  {request.requestType === 'purchase'
                    ? request.purchaseName || request.fabric?.name || '-'
                    : request.fabric?.name || '-'}
                </b>
                {request.requestType === 'purchase' && (
                  <div style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>
                    {[request.purchaseSku && `رمز: ${request.purchaseSku}`, request.purchaseColor, request.purchaseFabricType, request.purchaseSupplier]
                      .filter(Boolean)
                      .join(' · ') || 'تفاصيل الشراء غير مكتملة'}
                  </div>
                )}
                {request.notes && <div style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>{request.notes}</div>}
              </td>
              <td data-label="الكمية">{formatDualLength(request.requestedLength)}</td>
              <td data-label="التكلفة">{formatCurrency(request.purchaseUnitCost)}</td>
              <td data-label="الحالة">
                <span className={`pill ${requestStatusPill(request.status)}`}>{request.status}</span>
                {request.approvedBy && (
                  <div style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>بواسطة {request.approvedBy}</div>
                )}
              </td>
              <td data-label="التاريخ">{formatDate(request.createdAt)}</td>
              {!readOnly && (
                <td data-label="إجراء" className="actions-cell">
                  <div className="td-actions" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="tbl-btn edit" disabled={saving} onClick={() => onStatusChange(request.id, 'approved')}>
                      {request.requestType === 'purchase' ? 'اعتماد وإدخال' : 'موافقة'}
                    </button>
                    <button type="button" className="tbl-btn edit" disabled={saving} onClick={() => onStatusChange(request.id, 'fulfilled')}>
                      تم التوريد
                    </button>
                    <button type="button" className="tbl-btn del" disabled={saving} onClick={() => onStatusChange(request.id, 'rejected')}>
                      رفض
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {!requests.length && (
            <tr><td className="empty-row" colSpan={readOnly ? 7 : 8}>لا توجد طلبات من الخياطين</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function deliveryStatusPill(status: DeliveryNote['status']) {
  if (status === 'SUBMITTED') return { cls: 'warn', label: 'بانتظار المراجعة' };
  if (status === 'ACCEPTED') return { cls: 'ok', label: 'مقبول' };
  if (status === 'REJECTED') return { cls: 'red', label: 'مرفوض' };
  return { cls: 'muted', label: 'مسودة' };
}

function DeliveryRequestsTable({
  notes,
  onAccept,
  onReject,
  saving,
  readOnly = false,
}: {
  notes: DeliveryNote[];
  onAccept: (noteId: string) => void;
  onReject: (noteId: string, rejectionReason?: string) => void;
  saving: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="cards-mobile">
        <thead>
          <tr>
            <th>الخياط</th>
            <th>الموديل</th>
            <th>عدد القطع</th>
            <th>المقاس</th>
            <th>التكلفة</th>
            <th>المكونات المستهلكة</th>
            <th>تاريخ التسليم</th>
            {readOnly ? <th>الحالة</th> : <th>إجراء</th>}
          </tr>
        </thead>
        <tbody>
          {notes.map((note) => {
            const totalCost = (note.tailoringCost || 0) + (note.embroideryCost || 0) + (note.extraCost || 0);
            const componentsSummary =
              [
                ...(note.componentsConsumed?.fabrics || []).map((line) => `${line.name} (${formatDualLength(line.meters)})`),
                ...(note.componentsConsumed?.accessories || []).map((line) => `${line.name} (${formatNumber(line.qty)})`),
              ].join(' · ') || '-';
            return (
              <tr key={note.id}>
                <td data-label="الخياط"><b>{note.tailor?.name || '-'}</b></td>
                <td data-label="الموديل">{note.designModel?.sku || '-'}</td>
                <td data-label="عدد القطع">{formatNumber(note.dressCount)}</td>
                <td data-label="المقاس">{note.size || '-'}</td>
                <td data-label="التكلفة">{formatCurrency(totalCost)}</td>
                <td data-label="المكونات المستهلكة" style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>{componentsSummary}</td>
                <td data-label="تاريخ التسليم">{formatDate(note.submittedAt || note.createdAt)}</td>
                {readOnly ? (
                  <td data-label="الحالة">
                    <span className={`pill ${deliveryStatusPill(note.status).cls}`}>{deliveryStatusPill(note.status).label}</span>
                    {note.status === 'REJECTED' && note.rejectionReason && (
                      <div style={{ fontSize: '11.5px', color: 'var(--muted-foreground)' }}>{note.rejectionReason}</div>
                    )}
                  </td>
                ) : (
                  <td data-label="إجراء" className="actions-cell">
                    <div className="td-actions" style={{ flexWrap: 'wrap' }}>
                      <button type="button" className="tbl-btn edit" disabled={saving} onClick={() => onAccept(note.id)}>
                        قبول
                      </button>
                      <button
                        type="button"
                        className="tbl-btn del"
                        disabled={saving}
                        onClick={() => onReject(note.id, window.prompt('سبب الرفض (اختياري):') || undefined)}
                      >
                        رفض
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!notes.length && (
            <tr><td className="empty-row" colSpan={8}>{readOnly ? 'لا توجد طلبات تسليم بعد' : 'لا توجد طلبات تسليم بانتظار المراجعة'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!open || !mounted) return null;
  return createPortal(
    <>
      <div className="fab-design-drawer-overlay" onClick={onClose} />
      <div className="fab-design-drawer fab-design" dir="rtl">
        <div className="drawer-head">
          <h3>{title}</h3>
          <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

function CreateFabricDrawer({
  state,
  saving,
  colorOptions,
  onClose,
  onChange,
  onSubmit,
}: {
  state: CreateFabricDialogState;
  saving: boolean;
  colorOptions: SelectOption[];
  onClose: () => void;
  onChange: (changes: Partial<CreateFabricDialogState>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Drawer
      open={state.open}
      title="إنشاء قماش جديد"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="submit" form="create-fabric-form" disabled={saving}>حفظ واختيار القماش</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>إلغاء</button>
        </>
      }
    >
      <p className="muted-note" style={{ marginBottom: 12 }}>احفظ القماش ثم سيتم اختياره تلقائياً في سطر الفاتورة.</p>
      <form id="create-fabric-form" onSubmit={onSubmit}>
        <div className="grid">
          <TextInput label="اسم القماش" value={state.name} onChange={(name) => onChange({ name })} required />
          <TextInput label="رمز القماش" value={state.sku} onChange={(sku) => onChange({ sku })} />
          <DesignSelect label="اللون" value={state.color} options={colorOptions} onChange={(color) => onChange({ color })} allowCreate searchable className="full" />
        </div>
      </form>
    </Drawer>
  );
}

function CreateSupplierDrawer({
  state,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  state: CreateSupplierDialogState;
  saving: boolean;
  onClose: () => void;
  onChange: (changes: Partial<CreateSupplierDialogState>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Drawer
      open={state.open}
      title="إنشاء مورد جديد"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="submit" form="create-supplier-form" disabled={saving}>حفظ واختيار المورد</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>إلغاء</button>
        </>
      }
    >
      <p className="muted-note" style={{ marginBottom: 12 }}>الاسم فقط مطلوب، وبقية الحقول اختيارية. سيتم اختيار المورد تلقائياً في الفاتورة بعد الحفظ.</p>
      <form id="create-supplier-form" onSubmit={onSubmit}>
        <div className="grid">
          <TextInput label="اسم المورد" value={state.name} onChange={(name) => onChange({ name })} required />
          <TextInput label="رقم الجوال (اختياري)" value={state.phone} onChange={(phone) => onChange({ phone })} />
          <TextInput label="الشخص المسؤول (اختياري)" value={state.contactPerson} onChange={(contactPerson) => onChange({ contactPerson })} />
          <TextInput label="البريد الإلكتروني (اختياري)" type="email" value={state.email} onChange={(email) => onChange({ email })} />
          <TextAreaField label="العنوان (اختياري)" value={state.address} onChange={(address) => onChange({ address })} className="full" />
          <TextAreaField label="ملاحظات (اختياري)" value={state.notes} onChange={(notes) => onChange({ notes })} className="full" />
        </div>
      </form>
    </Drawer>
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
    <Drawer
      open={state.open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={handleSave} disabled={saving}>حفظ التعديل</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>إلغاء</button>
        </>
      }
    >
      <p className="muted-note" style={{ marginBottom: 12 }}>عدّل البيانات ثم احفظ. كل تغيير يُسجّل في سجل التعديلات.</p>
      {state.open && state.kind === 'fabric' && (
        <div className="grid">
          <TextInput label="اسم القماش" value={form.name || ''} onChange={(v) => setField('name', v)} />
          <TextInput label="رمز القماش" value={form.sku || ''} onChange={(v) => setField('sku', v)} />
          <TextInput label="اللون" value={form.color || ''} onChange={(v) => setField('color', v)} />
          <TextInput label="النوع" value={form.fabricType || ''} onChange={(v) => setField('fabricType', v)} />
          <TextInput label={lengthUnit === 'yard' ? 'المخزون (ياردة)' : 'المخزون (متر)'} type="number" value={form.stockLength || ''} onChange={(v) => setField('stockLength', v)} />
          <TextInput label={lengthUnit === 'yard' ? 'تكلفة الياردة' : 'تكلفة المتر'} type="number" value={form.unitCost || ''} onChange={(v) => setField('unitCost', v)} />
          <TextInput label={lengthUnit === 'yard' ? 'حد التنبيه (ياردة)' : 'حد التنبيه (متر)'} type="number" value={form.minStock || ''} onChange={(v) => setField('minStock', v)} />
          <TextAreaField label="ملاحظات" value={form.notes || ''} onChange={(v) => setField('notes', v)} className="full" />
        </div>
      )}
      {state.open && state.kind === 'accessory' && (
        <div className="grid">
          <TextInput label="اسم المستلزم" value={form.name || ''} onChange={(v) => setField('name', v)} />
          <TextInput label="رقم المنتج" value={form.sku || ''} onChange={(v) => setField('sku', v)} />
          <TextInput label="المخزون" type="number" value={form.stockQty || ''} onChange={(v) => setField('stockQty', v)} />
          <TextInput label="السعر" type="number" value={form.unitPrice || ''} onChange={(v) => setField('unitPrice', v)} />
          <TextInput label="حد التنبيه" type="number" value={form.minStock || ''} onChange={(v) => setField('minStock', v)} />
          <TextAreaField label="ملاحظات" value={form.notes || ''} onChange={(v) => setField('notes', v)} className="full" />
        </div>
      )}

      <details className="log">
        <summary>
          <span>سجل التعديلات</span>
          <span className="log-count">{logs.length}</span>
          <ChevronDown style={{ width: 16, height: 16, color: 'var(--muted-foreground)' }} />
        </summary>
        <table className="log-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المستخدم</th>
              <th>الحقل</th>
              <th>من</th>
              <th>إلى</th>
            </tr>
          </thead>
          <tbody>
            {logsLoading && (
              <tr><td className="empty-row" colSpan={5}>جاري التحميل…</td></tr>
            )}
            {!logsLoading && !logs.length && (
              <tr><td className="empty-row" colSpan={5}>لا توجد تعديلات مسجّلة</td></tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td style={{ color: 'var(--muted-foreground)' }}>{formatDate(log.createdAt)}</td>
                <td>{log.changedBy}</td>
                <td>{log.field}</td>
                <td style={{ color: 'var(--muted-foreground)' }}>{log.oldValue ?? '—'}</td>
                <td>{log.newValue ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Drawer>
  );
}
