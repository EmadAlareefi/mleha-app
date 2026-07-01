'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const YARD_TO_METER = 0.9144;

type TailorFabric = {
  id: string;
  name: string;
  sku?: string | null;
  color?: string | null;
  fabricType?: string | null;
  unitCost: number;
  heldByMe: number;
};

type RecipeRow = { role: string; fabricId: string; consumption: number };

type TailorModel = {
  id: string;
  sku: string;
  size?: string | null;
  unit: string;
  imageData?: string | null;
  recipe: RecipeRow[];
  accessories: unknown[];
  tailoringCost: number;
  embroideryCost: number;
  extraCost: number;
  sallaProductId?: number | null;
  sallaVariantId?: string | null;
};

type TailorDeliveryNote = {
  id: string;
  noteNumber: string;
  dressCount: number;
  size?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  tailoringCost: number;
  embroideryCost: number;
  extraCost: number;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  sallaSyncStatus?: string | null;
  createdAt: string;
  designModel?: { id: string; sku: string };
};

type TailorPurchaseInvoice = {
  id: string;
  invoiceNumber: string;
  supplier?: string | null;
  purchaseDate?: string | null;
  totalInclVat: number;
  items: Array<{ fabricId?: string | null; productName: string; quantity: number; unitCost: number }>;
};

type TailorPortalData = {
  tailor: { id: string; name: string; workshopName?: string | null };
  fabrics: TailorFabric[];
  models: TailorModel[];
  deliveryNotes: TailorDeliveryNote[];
  purchaseInvoices: TailorPurchaseInvoice[];
};

const numberFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 2,
});
const formatNumber = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : numberFormatter.format(value);
const formatCurrency = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : currencyFormatter.format(value);

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ACCEPTED') return 'default';
  if (status === 'REJECTED') return 'destructive';
  if (status === 'SUBMITTED') return 'secondary';
  return 'outline';
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

type PurchaseBillItem = {
  id: string;
  fabricId: string;
  name: string;
  sku: string;
  color: string;
  purchasedLength: string;
  unitCost: string;
  notes: string;
};

function emptyPurchaseBillItem(): PurchaseBillItem {
  return { id: makeId('item'), fabricId: '', name: '', sku: '', color: '', purchasedLength: '', unitCost: '', notes: '' };
}

type RecipeFormRow = { id: string; role: string; fabricId: string; consumption: string };

export default function TailorDashboard() {
  const [data, setData] = useState<TailorPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tailor-portal');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'فشل في جلب بيانات لوحة الخياط');
      setData(payload);
    } catch (fetchError: any) {
      setError(fetchError.message || 'فشل في جلب بيانات لوحة الخياط');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const postAction = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await fetch('/api/tailor-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'فشل في تنفيذ الإجراء');
      await fetchData();
      return true;
    } catch (actionError: any) {
      alert(actionError.message || 'فشل في تنفيذ الإجراء');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin ms-2" /> جاري التحميل…
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardContent className="py-4">
          <div className="text-lg font-semibold">{data.tailor.name}</div>
          {data.tailor.workshopName && <div className="text-sm text-muted-foreground">{data.tailor.workshopName}</div>}
        </CardContent>
      </Card>

      <Tabs defaultValue="fabrics">
        <TabsList>
          <TabsTrigger value="fabrics">أقمشتي</TabsTrigger>
          <TabsTrigger value="models">موديلاتي</TabsTrigger>
          <TabsTrigger value="manufacture">تصنيع</TabsTrigger>
          <TabsTrigger value="history">سجل التسليمات</TabsTrigger>
        </TabsList>

        <TabsContent value="fabrics">
          <FabricsTab fabrics={data.fabrics} saving={saving} postAction={postAction} />
        </TabsContent>

        <TabsContent value="models">
          <ModelsTab fabrics={data.fabrics} models={data.models} saving={saving} postAction={postAction} />
        </TabsContent>

        <TabsContent value="manufacture">
          <ManufactureTab
            fabrics={data.fabrics}
            models={data.models}
            deliveryNotes={data.deliveryNotes}
            saving={saving}
            postAction={postAction}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab deliveryNotes={data.deliveryNotes} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FabricsTab({
  fabrics,
  saving,
  postAction,
}: {
  fabrics: TailorFabric[];
  saving: boolean;
  postAction: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [billNumber, setBillNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [lengthUnit, setLengthUnit] = useState<'meter' | 'yard'>('meter');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseBillItem[]>([emptyPurchaseBillItem()]);

  const [adjustFabricId, setAdjustFabricId] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');

  const updateItem = (id: string, changes: Partial<PurchaseBillItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const submitBill = async () => {
    const preparedItems = items
      .filter((item) => item.purchasedLength)
      .map((item) => ({
        fabricId: item.fabricId || undefined,
        name: item.name || undefined,
        sku: item.sku || undefined,
        color: item.color || undefined,
        purchasedLength: Number(item.purchasedLength),
        unitCost: Number(item.unitCost) || 0,
        notes: item.notes || undefined,
      }));
    if (!billNumber || !purchaseDate || !preparedItems.length) {
      alert('رقم الفاتورة والتاريخ وقماش واحد على الأقل مطلوبة');
      return;
    }
    const ok = await postAction({
      action: 'create-purchase-bill',
      billNumber,
      purchaseDate,
      lengthUnit,
      supplier: supplier || undefined,
      items: preparedItems,
      notes: notes || undefined,
    });
    if (ok) {
      setBillNumber('');
      setSupplier('');
      setNotes('');
      setItems([emptyPurchaseBillItem()]);
    }
  };

  const submitAdjustment = async () => {
    if (!adjustFabricId || !adjustDelta) {
      alert('اختر القماش وأدخل الفرق');
      return;
    }
    const ok = await postAction({
      action: 'tailor-stock-adjustment',
      fabricId: adjustFabricId,
      delta: Number(adjustDelta),
      lengthUnit,
      notes: adjustNotes || undefined,
    });
    if (ok) {
      setAdjustDelta('');
      setAdjustNotes('');
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardContent className="py-4">
          <div className="font-medium mb-3">القماش لدي</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القماش</TableHead>
                <TableHead>رمز القماش</TableHead>
                <TableHead>اللون</TableHead>
                <TableHead>الكمية لدي</TableHead>
                <TableHead>تكلفة المتر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fabrics.map((fabric) => (
                <TableRow key={fabric.id}>
                  <TableCell className="font-medium">{fabric.name}</TableCell>
                  <TableCell>{fabric.sku || '-'}</TableCell>
                  <TableCell>{fabric.color || '-'}</TableCell>
                  <TableCell>{formatNumber(fabric.heldByMe)} م</TableCell>
                  <TableCell>{formatCurrency(fabric.unitCost)}</TableCell>
                </TableRow>
              ))}
              {!fabrics.length && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState title="لا توجد أقمشة" description="لم يتم تسجيل أي قماش بعد" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="font-medium">إدخال فاتورة شراء قماش جديدة</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="رقم الفاتورة" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            <Input placeholder="اسم المورد (اختياري)" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <NativeSelect value={lengthUnit} onChange={(e) => setLengthUnit(e.target.value as 'meter' | 'yard')}>
            <NativeSelectOption value="meter">متر</NativeSelectOption>
            <NativeSelectOption value="yard">ياردة</NativeSelectOption>
          </NativeSelect>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-center border rounded-md p-2">
                <NativeSelect
                  value={item.fabricId}
                  onChange={(e) => updateItem(item.id, { fabricId: e.target.value })}
                >
                  <NativeSelectOption value="">قماش جديد…</NativeSelectOption>
                  {fabrics.map((fabric) => (
                    <NativeSelectOption key={fabric.id} value={fabric.id}>
                      {fabric.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {!item.fabricId && (
                  <>
                    <Input placeholder="اسم القماش" value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
                    <Input placeholder="رمز (اختياري)" value={item.sku} onChange={(e) => updateItem(item.id, { sku: e.target.value })} />
                    <Input placeholder="اللون" value={item.color} onChange={(e) => updateItem(item.id, { color: e.target.value })} />
                  </>
                )}
                <Input
                  type="number"
                  placeholder={lengthUnit === 'yard' ? 'الكمية (ياردة)' : 'الكمية (متر)'}
                  value={item.purchasedLength}
                  onChange={(e) => updateItem(item.id, { purchasedLength: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder="تكلفة الوحدة"
                  value={item.unitCost}
                  onChange={(e) => updateItem(item.id, { unitCost: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={items.length <= 1}
                  onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => setItems((current) => [...current, emptyPurchaseBillItem()])}>
            <Plus className="h-4 w-4 ms-1" /> إضافة قماش
          </Button>
          <Input placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button type="button" disabled={saving} onClick={() => void submitBill()}>
            حفظ الفاتورة
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="font-medium">تصحيح جرد (زيادة أو نقص)</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NativeSelect value={adjustFabricId} onChange={(e) => setAdjustFabricId(e.target.value)}>
              <NativeSelectOption value="">اختر القماش</NativeSelectOption>
              {fabrics.map((fabric) => (
                <NativeSelectOption key={fabric.id} value={fabric.id}>
                  {fabric.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              type="number"
              placeholder="الفرق (+ أو -)"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
            />
            <Input placeholder="ملاحظات (اختياري)" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} />
          </div>
          <Button type="button" variant="outline" disabled={saving} onClick={() => void submitAdjustment()}>
            حفظ التصحيح
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ModelsTab({
  fabrics,
  models,
  saving,
  postAction,
}: {
  fabrics: TailorFabric[];
  models: TailorModel[];
  saving: boolean;
  postAction: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [sku, setSku] = useState('');
  const [size, setSize] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<'meter' | 'yard'>('meter');
  const [tailoringCost, setTailoringCost] = useState('');
  const [extraCost, setExtraCost] = useState('');
  const [recipeRows, setRecipeRows] = useState<RecipeFormRow[]>([
    { id: makeId('rec'), role: 'main', fabricId: '', consumption: '' },
  ]);

  const updateRow = (id: string, changes: Partial<RecipeFormRow>) =>
    setRecipeRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  const submitModel = async () => {
    const recipe = recipeRows
      .filter((row) => row.fabricId && row.consumption)
      .map((row) => ({ role: row.role, fabricId: row.fabricId, consumption: Number(row.consumption) }));
    if (!sku || !recipe.length) {
      alert('رقم الصنف وقماش واحد على الأقل مطلوبان');
      return;
    }
    const ok = await postAction({
      action: 'create-model',
      sku,
      unit,
      size: size || undefined,
      description: description || undefined,
      tailoringCost: Number(tailoringCost) || 0,
      extraCost: Number(extraCost) || 0,
      recipe,
    });
    if (ok) {
      setSku('');
      setSize('');
      setDescription('');
      setTailoringCost('');
      setExtraCost('');
      setRecipeRows([{ id: makeId('rec'), role: 'main', fabricId: '', consumption: '' }]);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardContent className="py-4">
          <div className="font-medium mb-3">موديلاتي</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>المقاس</TableHead>
                <TableHead>تكلفة الخياطة</TableHead>
                <TableHead>تكلفة إضافية</TableHead>
                <TableHead>منتج سلة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="font-medium">{model.sku}</TableCell>
                  <TableCell>{model.size || '-'}</TableCell>
                  <TableCell>{formatCurrency(model.tailoringCost)}</TableCell>
                  <TableCell>{formatCurrency(model.extraCost)}</TableCell>
                  <TableCell>
                    {model.sallaProductId || model.sallaVariantId ? (
                      <Badge variant="secondary">مرتبط</Badge>
                    ) : (
                      <Badge variant="outline">غير مرتبط</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!models.length && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState title="لا توجد موديلات" description="لم يتم إنشاء أي موديل بعد" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="font-medium">إنشاء موديل جديد</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="رقم الصنف (SKU)" value={sku} onChange={(e) => setSku(e.target.value)} />
            <Input placeholder="المقاس (اختياري)" value={size} onChange={(e) => setSize(e.target.value)} />
            <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value as 'meter' | 'yard')}>
              <NativeSelectOption value="meter">متر</NativeSelectOption>
              <NativeSelectOption value="yard">ياردة</NativeSelectOption>
            </NativeSelect>
            <Input placeholder="تكلفة الخياطة" type="number" value={tailoringCost} onChange={(e) => setTailoringCost(e.target.value)} />
            <Input placeholder="تكلفة إضافية" type="number" value={extraCost} onChange={(e) => setExtraCost(e.target.value)} />
          </div>
          <Input placeholder="وصف (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">مكونات القماش (Bill of Materials)</div>
            {recipeRows.map((row) => (
              <div key={row.id} className="grid grid-cols-3 gap-2 items-center">
                <NativeSelect value={row.fabricId} onChange={(e) => updateRow(row.id, { fabricId: e.target.value })}>
                  <NativeSelectOption value="">اختر القماش</NativeSelectOption>
                  {fabrics.map((fabric) => (
                    <NativeSelectOption key={fabric.id} value={fabric.id}>
                      {fabric.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Input
                  type="number"
                  placeholder="الاستهلاك لكل قطعة"
                  value={row.consumption}
                  onChange={(e) => updateRow(row.id, { consumption: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={recipeRows.length <= 1}
                  onClick={() => setRecipeRows((current) => current.filter((r) => r.id !== row.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setRecipeRows((current) => [...current, { id: makeId('rec'), role: 'lining', fabricId: '', consumption: '' }])}
            >
              <Plus className="h-4 w-4 ms-1" /> إضافة قماش للموديل
            </Button>
          </div>

          <Button type="button" disabled={saving} onClick={() => void submitModel()}>
            حفظ الموديل
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ManufactureTab({
  fabrics,
  models,
  deliveryNotes,
  saving,
  postAction,
}: {
  fabrics: TailorFabric[];
  models: TailorModel[];
  deliveryNotes: TailorDeliveryNote[];
  saving: boolean;
  postAction: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [modelId, setModelId] = useState('');
  const [dressCount, setDressCount] = useState('1');
  const [size, setSize] = useState('');
  const [notes, setNotes] = useState('');

  const selectedModel = useMemo(() => models.find((model) => model.id === modelId) || null, [models, modelId]);
  const fabricMap = useMemo(() => new Map(fabrics.map((fabric) => [fabric.id, fabric])), [fabrics]);

  const preview = useMemo(() => {
    if (!selectedModel) return [];
    const count = Number(dressCount) || 1;
    return selectedModel.recipe.map((row) => {
      const fabric = fabricMap.get(row.fabricId);
      const meters = row.consumption * (selectedModel.unit === 'yard' ? YARD_TO_METER : 1) * count;
      const held = fabric?.heldByMe ?? 0;
      return { fabricId: row.fabricId, name: fabric?.name || '-', meters, held, sufficient: held >= meters };
    });
  }, [selectedModel, dressCount, fabricMap]);

  const drafts = deliveryNotes.filter((note) => note.status === 'DRAFT');

  const createDraft = async () => {
    if (!modelId || !dressCount) {
      alert('اختر الموديل وعدد القطع');
      return;
    }
    const ok = await postAction({
      action: 'create-delivery-note',
      designModelId: modelId,
      dressCount: Number(dressCount),
      size: size || undefined,
      notes: notes || undefined,
    });
    if (ok) {
      setDressCount('1');
      setSize('');
      setNotes('');
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="font-medium">تصنيع دفعة جديدة</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NativeSelect value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <NativeSelectOption value="">اختر الموديل</NativeSelectOption>
              {models.map((model) => (
                <NativeSelectOption key={model.id} value={model.id}>
                  {model.sku}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input type="number" placeholder="عدد القطع" value={dressCount} onChange={(e) => setDressCount(e.target.value)} />
            <Input placeholder="المقاس (اختياري)" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <Input placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          {preview.length > 0 && (
            <div className="border rounded-md p-3 space-y-1">
              <div className="text-sm text-muted-foreground mb-2">الأقمشة المطلوبة لهذه الدفعة</div>
              {preview.map((row) => (
                <div key={row.fabricId} className="flex items-center justify-between text-sm">
                  <span>{row.name}</span>
                  <span className={row.sufficient ? 'text-emerald-600' : 'text-red-600'}>
                    {formatNumber(row.meters)} م (لديك {formatNumber(row.held)} م)
                    {!row.sufficient && ' — غير كافٍ'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            disabled={saving || preview.some((row) => !row.sufficient) || !preview.length}
            onClick={() => void createDraft()}
          >
            إنشاء مسودة تسليم
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="font-medium mb-3">مسودات بانتظار التسليم</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم المذكرة</TableHead>
                <TableHead>الموديل</TableHead>
                <TableHead>العدد</TableHead>
                <TableHead>المقاس</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((note) => (
                <TableRow key={note.id}>
                  <TableCell className="font-medium">{note.noteNumber}</TableCell>
                  <TableCell>{note.designModel?.sku || '-'}</TableCell>
                  <TableCell>{formatNumber(note.dressCount)}</TableCell>
                  <TableCell>{note.size || '-'}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving}
                      onClick={() => void postAction({ action: 'submit-delivery-note', noteId: note.id })}
                    >
                      تسليم
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!drafts.length && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState title="لا توجد مسودات" description="أنشئ دفعة تصنيع جديدة أعلاه" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryTab({ deliveryNotes }: { deliveryNotes: TailorDeliveryNote[] }) {
  return (
    <Card className="mt-4">
      <CardContent className="py-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم المذكرة</TableHead>
              <TableHead>الموديل</TableHead>
              <TableHead>العدد</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveryNotes.map((note) => (
              <TableRow key={note.id}>
                <TableCell className="font-medium">{note.noteNumber}</TableCell>
                <TableCell>{note.designModel?.sku || '-'}</TableCell>
                <TableCell>{formatNumber(note.dressCount)}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(note.status)}>{note.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {note.status === 'REJECTED' && note.rejectionReason}
                  {note.status === 'ACCEPTED' && note.sallaSyncStatus && `مزامنة سلة: ${note.sallaSyncStatus}`}
                </TableCell>
              </TableRow>
            ))}
            {!deliveryNotes.length && (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState title="لا يوجد سجل بعد" description="لم يتم إنشاء أي مذكرة تسليم بعد" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
