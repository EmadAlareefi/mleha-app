'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Grid2X2,
  Layers,
  PackageCheck,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

type Fabric = {
  id: string;
  name: string;
  sku?: string | null;
  color?: string | null;
  fabricType?: string | null;
  unitCost: number;
  stockLength: number;
};

type SelectOption = {
  value: string;
  label: string;
};

type RecipeFabricRow = {
  id: string;
  role: string;
  fabricId: string;
  consumption: string;
};

type AccessoryRow = {
  id: string;
  name: string;
  cost: string;
};

export type DesignModel = {
  id: string;
  sku: string;
  status: string;
  colors: string[];
  description: string;
  unit: 'meter' | 'yard';
  imageData?: string | null;
  fabrics: RecipeFabricRow[];
  accessories: AccessoryRow[];
  tailoringCost: number;
  embroideryCost: number;
  extraCost: number;
  fabricCost: number;
  accessoriesCost: number;
  totalCost: number;
  producibleCount: number;
  producedCount: number;
  inProgressCount: number;
  reservedLength: number;
};

const METER_TO_YARD = 1.0936132983;
const YARD_TO_METER = 0.9144;

const statusOptions: SelectOption[] = [
  { value: 'active', label: 'نشط' },
  { value: 'paused', label: 'موقوف' },
  { value: 'draft', label: 'تحت التطوير' },
];

const unitOptions: SelectOption[] = [
  { value: 'meter', label: 'متر' },
  { value: 'yard', label: 'ياردة' },
];

const fabricRoleOptions: SelectOption[] = [
  { value: 'main', label: 'أساسي' },
  { value: 'bottom', label: 'قطعة سفلية' },
  { value: 'inner', label: 'قماش داخلي' },
  { value: 'lining', label: 'بطانة' },
  { value: 'embroidery', label: 'تطريز' },
];

const accessoryOptions: SelectOption[] = [
  { value: 'سحّاب مخفي', label: 'سحّاب مخفي' },
  { value: 'خرز تطريز', label: 'خرز تطريز' },
  { value: 'أزرار', label: 'أزرار' },
  { value: 'شريط كاوتش', label: 'شريط كاوتش' },
  { value: 'ترتر', label: 'ترتر' },
];

const colors = [
  { name: 'أبيض', value: '#fff', border: true },
  { name: 'أسود', value: '#1a1a1a' },
  { name: 'بيج', value: '#c8a97a' },
  { name: 'بني', value: '#8b6f47' },
  { name: 'أحمر', value: '#b5363e' },
  { name: 'وردي', value: '#e8a0b4' },
  { name: 'بنفسجي', value: '#c084b8' },
  { name: 'أزرق', value: '#2c6fa8' },
  { name: 'أخضر', value: '#4a9e6b' },
  { name: 'ذهبي', value: '#d4a836' },
  { name: 'فضي', value: '#c0c0c0' },
  { name: 'كحلي', value: '#2c2416' },
  { name: 'سالموني', value: '#e8c4b0' },
  { name: 'رمادي', value: '#708090' },
];

const colorMap = new Map(colors.map((color) => [color.name, color.value]));
const numberFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat('ar-SA-u-nu-latn', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 2,
});

const toNumber = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value: number) => numberFormatter.format(value);
const formatCurrency = (value: number) => currencyFormatter.format(value);
const consumptionToMeters = (value: string, unit: string) => toNumber(value) * (unit === 'yard' ? YARD_TO_METER : 1);
const metersToCurrentUnit = (value: number, unit: string) => value * (unit === 'yard' ? METER_TO_YARD : 1);

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getStatusLabel(status: string) {
  return statusOptions.find((option) => option.value === status)?.label || status;
}

function getRoleLabel(role: string) {
  return fabricRoleOptions.find((option) => option.value === role)?.label || role;
}

function calculateModel(input: {
  fabrics: Fabric[];
  rows: RecipeFabricRow[];
  accessories: AccessoryRow[];
  unit: string;
  tailoringCost: string;
  embroideryCost: string;
  extraCost: string;
}) {
  const usableRows = input.rows
    .map((row) => {
      const fabric = input.fabrics.find((item) => item.id === row.fabricId);
      const consumptionMeters = consumptionToMeters(row.consumption, input.unit);
      return { row, fabric, consumptionMeters };
    })
    .filter((row) => row.fabric && row.consumptionMeters > 0);

  const fabricCost = usableRows.reduce(
    (sum, row) => sum + row.consumptionMeters * (row.fabric?.unitCost || 0),
    0
  );
  const accessoriesCost = input.accessories.reduce((sum, row) => sum + toNumber(row.cost), 0);
  const tailoringCost = toNumber(input.tailoringCost);
  const embroideryCost = toNumber(input.embroideryCost);
  const extraCost = toNumber(input.extraCost);
  const totalCost = fabricCost + accessoriesCost + tailoringCost + embroideryCost + extraCost;
  const producibleCount = usableRows.length
    ? Math.min(...usableRows.map((row) => Math.floor((row.fabric?.stockLength || 0) / row.consumptionMeters)))
    : 0;

  return {
    fabricCost,
    accessoriesCost,
    tailoringCost,
    embroideryCost,
    extraCost,
    totalCost,
    producibleCount: Number.isFinite(producibleCount) ? Math.max(producibleCount, 0) : 0,
    mainFabric: usableRows[0]?.fabric,
    mainConsumptionMeters: usableRows[0]?.consumptionMeters || 0,
  };
}

export function ModelsTabSpec({
  fabrics,
  models,
  onChanged,
}: {
  fabrics: Fabric[];
  models: DesignModel[];
  onChanged: () => void | Promise<void>;
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const [sku, setSku] = useState('DRS-001');
  const [status, setStatus] = useState('active');
  const [unit, setUnit] = useState<'meter' | 'yard'>('meter');
  const [description, setDescription] = useState('تفاصيل التصميم والقصة…');
  const [imageData, setImageData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>(['متعدد الألوان']);
  const [recipeRows, setRecipeRows] = useState<RecipeFabricRow[]>([
    { id: 'main', role: 'main', fabricId: fabrics[0]?.id || '', consumption: '2.3' },
    { id: 'bottom', role: 'bottom', fabricId: fabrics[1]?.id || fabrics[0]?.id || '', consumption: '1.0' },
    { id: 'lining', role: 'lining', fabricId: fabrics[2]?.id || fabrics[0]?.id || '', consumption: '1.5' },
  ]);
  const [accessoryRows, setAccessoryRows] = useState<AccessoryRow[]>([
    { id: 'zipper', name: 'سحّاب مخفي', cost: '3' },
    { id: 'beads', name: 'خرز تطريز', cost: '12' },
  ]);
  const [tailoringCost, setTailoringCost] = useState('40');
  const [embroideryCost, setEmbroideryCost] = useState('20');
  const [extraCost, setExtraCost] = useState('10');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const fabricOptions = useMemo(
    () =>
      fabrics.map((fabric) => ({
        value: fabric.id,
        label: `${fabric.name} — متاح ${formatNumber(fabric.stockLength)}م`,
      })),
    [fabrics]
  );

  const calculations = useMemo(
    () =>
      calculateModel({
        fabrics,
        rows: recipeRows,
        accessories: accessoryRows,
        unit,
        tailoringCost,
        embroideryCost,
        extraCost,
      }),
    [accessoryRows, embroideryCost, extraCost, fabrics, recipeRows, tailoringCost, unit]
  );

  const visibleModels = models;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedSearch) return models;
    return models.filter((model) => {
      const skuMatch = (model.sku || '').toLowerCase().includes(normalizedSearch);
      const fabricCodeMatch = model.fabrics.some((row) => {
        const fabric = fabrics.find((item) => item.id === row.fabricId);
        return (fabric?.sku || '').toLowerCase().includes(normalizedSearch);
      });
      return skuMatch || fabricCodeMatch;
    });
  }, [models, fabrics, normalizedSearch]);
  const activeModelsCount = visibleModels.filter((model) => model.status === 'active').length;
  const totalProducibleCount = visibleModels.reduce((sum, model) => sum + model.producibleCount, 0);
  const totalReservedLength = visibleModels.reduce((sum, model) => sum + model.reservedLength, 0);
  const currentUnitLabel = unitOptions.find((option) => option.value === unit)?.label || 'متر';

  const setSelectValue = (id: string, value: string) => {
    if (id === 'status') setStatus(value);
    if (id === 'unit') setUnit(value as 'meter' | 'yard');
    if (id.startsWith('fabric-')) {
      const rowId = id.replace('fabric-', '');
      setRecipeRows((current) => current.map((row) => (row.id === rowId ? { ...row, fabricId: value } : row)));
    }
    if (id.startsWith('role-')) {
      const rowId = id.replace('role-', '');
      setRecipeRows((current) => current.map((row) => (row.id === rowId ? { ...row, role: value } : row)));
    }
    if (id.startsWith('accessory-')) {
      const rowId = id.replace('accessory-', '');
      setAccessoryRows((current) => current.map((row) => (row.id === rowId ? { ...row, name: value } : row)));
    }
    setOpenSelect(null);
  };

  const toggleColor = (name: string) => {
    setSelectedColors((current) =>
      current.includes(name) ? current.filter((color) => color !== name) : [...current, name]
    );
  };

  const updateRecipeRow = (rowId: string, patch: Partial<RecipeFabricRow>) => {
    setRecipeRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const updateAccessoryRow = (rowId: string, patch: Partial<AccessoryRow>) => {
    setAccessoryRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addFabricRow = () => {
    setRecipeRows((current) => [
      ...current,
      {
        id: makeId('fabric'),
        role: 'lining',
        fabricId: fabrics[0]?.id || '',
        consumption: '0',
      },
    ]);
  };

  const addAccessoryRow = () => {
    setAccessoryRows((current) => [...current, { id: makeId('accessory'), name: 'أزرار', cost: '0' }]);
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('الملف يجب أن يكون صورة');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('حجم الصورة كبير جداً (الحد الأقصى 2 ميجابايت)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageData(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const postAction = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'فشل في الحفظ');
      await onChanged();
      return true;
    } catch (saveError: any) {
      setError(saveError.message || 'فشل في الحفظ');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    const saved = await postAction({
      action: 'create-model',
      sku: sku.trim(),
      status,
      description,
      unit,
      colors: selectedColors.length ? selectedColors : ['متعدد الألوان'],
      imageData,
      recipe: recipeRows.map((row) => ({ role: row.role, fabricId: row.fabricId, consumption: row.consumption })),
      accessories: accessoryRows.map((row) => ({ name: row.name, cost: row.cost })),
      tailoringCost,
      embroideryCost,
      extraCost,
    });
    if (saved) {
      setImageData(null);
      setSelectedColors(['متعدد الألوان']);
      setDescription('تفاصيل التصميم والقصة…');
    }
  };

  const deleteModel = async (modelId: string) => {
    if (!window.confirm('هل تريد حذف هذا الموديل؟')) return;
    await postAction({ action: 'delete-model', modelId });
  };

  return (
    <div className="models-spec" dir="rtl">
      <div className="wrap">
        <div className="stats-row">
          <StatCard title="عدد الموديلات" value={`${formatNumber(visibleModels.length)} موديل`} icon={<Grid2X2 />} />
          <StatCard title="موديلات نشطة" value={`${formatNumber(activeModelsCount)} نشطة`} icon={<Check />} />
          <StatCard title="قابل للإنتاج حالياً" value={`${formatNumber(totalProducibleCount)} فساتين`} icon={<PackageCheck />} />
          <StatCard title="إجمالي القماش المحجوز" value={`${formatNumber(totalReservedLength)} م`} icon={<Layers />} />
        </div>

        <section>
          <BlockTitle marker="1">فورم إضافة موديل جديد</BlockTitle>
          <p className="block-sub">نفس بنية المواصفة: معلومات أساسية، وصفة الأقمشة والمستلزمات، ثم التكاليف المحسوبة.</p>

          <div className="card">
            <div className="card-head">
              بيانات الموديل
              <div className="desc">اختر الأقمشة من المخزون الحالي وشاهد تكلفة القطعة والكمية الممكن إنتاجها مباشرة</div>
            </div>

            <details className="acc" open>
              <summary>
                <span className="ico">أ</span>
                معلومات أساسية
                <ChevronDown className="chev" />
              </summary>
              <div className="acc-body">
                <div className="sec-a-wrap">
                  <div className="sec-a-img">
                    <label>صورة المنتج</label>
                    <label className="imgbox sec-a-imgbox" style={{ cursor: 'pointer', overflow: 'hidden', padding: 0 }}>
                      {imageData ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageData}
                          alt="صورة المنتج"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span>
                          🖼️
                          <br />
                          اسحب الصورة أو اضغط للرفع
                        </span>
                      )}
                      <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                    </label>
                    {imageData && (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ margin: '8px 0 0', padding: '4px 12px', fontSize: 12 }}
                        onClick={() => setImageData(null)}
                      >
                        إزالة الصورة
                      </button>
                    )}
                  </div>

                  <div className="sec-a-fields">
                    <EditableField label="رقم الصنف (SKU)" value={sku} onChange={setSku} />
                    <SelectBox
                      id="status"
                      label="الحالة"
                      options={statusOptions}
                      value={status}
                      openSelect={openSelect}
                      setOpenSelect={setOpenSelect}
                      onChange={setSelectValue}
                    />

                    <div className="field full">
                      <label>الألوان المتاحة</label>
                      <div className="sel-wrap">
                        <button
                          type="button"
                          className={`sel-trigger ${openSelect === 'colors' ? 'open' : ''}`}
                          onClick={() => setOpenSelect(openSelect === 'colors' ? null : 'colors')}
                        >
                          <span className="sel-val">
                            {selectedColors.length
                              ? selectedColors.map((color) => (
                                  <span className="color-val" key={color}>
                                    {colorMap.has(color) && (
                                      <span className="color-swatch" style={{ background: colorMap.get(color) }} />
                                    )}
                                    {color}
                                  </span>
                                ))
                              : 'اختر الألوان…'}
                          </span>
                          <span className="sel-chev">▾</span>
                        </button>
                        <div className={`sel-menu color-pop ${openSelect === 'colors' ? 'open' : ''}`}>
                          <div className="color-menu open">
                            <div className="color-grid">
                              {colors.map((color) => (
                                <button
                                  key={color.name}
                                  type="button"
                                  className={`color-chip ${selectedColors.includes(color.name) ? 'selected' : ''}`}
                                  title={color.name}
                                  style={{
                                    background: color.value,
                                    borderColor: color.border ? '#ccc' : undefined,
                                  }}
                                  onClick={() => toggleColor(color.name)}
                                />
                              ))}
                              <button
                                type="button"
                                className={`color-chip multi ${selectedColors.includes('متعدد الألوان') ? 'selected' : ''}`}
                                onClick={() => toggleColor('متعدد الألوان')}
                              >
                                متعدد الألوان
                              </button>
                            </div>
                            <div className="color-help">اضغط لاختيار لون أو أكثر</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <EditableField label="الوصف" value={description} onChange={setDescription} className="full" area />
                  </div>
                </div>
              </div>
            </details>

            <details className="acc" open>
              <summary>
                <span className="ico">ب</span>
                الأقمشة والمستلزمات
                <span className="tag">الأهم</span>
                <ChevronDown className="chev" />
              </summary>
              <div className="acc-body">
                <SelectBox
                  id="unit"
                  label="وحدة القياس"
                  options={unitOptions}
                  value={unit}
                  openSelect={openSelect}
                  setOpenSelect={setOpenSelect}
                  onChange={setSelectValue}
                  className="full unit-field"
                  hint="تُطبّق على كل حقول الاستهلاك في الأسفل"
                />

                {!fabrics.length && (
                  <div className="note no-stock">
                    أضف أقمشة من تبويب المخزون أولاً حتى تظهر في وصفة الموديل وحسابات الإنتاج.
                  </div>
                )}

                <div className="rep-label">الأقمشة</div>
                <div>
                  {recipeRows.map((row, index) => (
                    <div className="rep-row fabric" key={row.id}>
                      {index === 0 ? (
                        <div className="role-pill">أساسي</div>
                      ) : (
                        <SelectBox
                          id={`role-${row.id}`}
                          options={fabricRoleOptions}
                          value={row.role}
                          openSelect={openSelect}
                          setOpenSelect={setOpenSelect}
                          onChange={setSelectValue}
                        />
                      )}
                      <SelectBox
                        id={`fabric-${row.id}`}
                        options={fabricOptions}
                        value={row.fabricId}
                        openSelect={openSelect}
                        setOpenSelect={setOpenSelect}
                        onChange={setSelectValue}
                        placeholder="اختر القماش"
                      />
                      <EditableField
                        value={row.consumption}
                        onChange={(consumption) => updateRecipeRow(row.id, { consumption })}
                        suffix={currentUnitLabel}
                        type="number"
                      />
                      {index === 0 ? (
                        <button className="iconbtn add" type="button" title="إضافة قماش آخر" onClick={addFabricRow}>
                          <Plus />
                        </button>
                      ) : (
                        <button
                          className="iconbtn del"
                          type="button"
                          title="حذف"
                          onClick={() => setRecipeRows((current) => current.filter((item) => item.id !== row.id))}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <span className="hint block-hint">الاستهلاك يحسب التكلفة من سعر المتر المسجل في المخزون</span>

                <div className="rep-label">الإكسسوارات والمستلزمات</div>
                <div>
                  {accessoryRows.map((row, index) => (
                    <div className="rep-row acc-row" key={row.id}>
                      <SelectBox
                        id={`accessory-${row.id}`}
                        options={accessoryOptions}
                        value={row.name}
                        openSelect={openSelect}
                        setOpenSelect={setOpenSelect}
                        onChange={setSelectValue}
                        allowCustom
                      />
                      <EditableField
                        value={row.cost}
                        onChange={(cost) => updateAccessoryRow(row.id, { cost })}
                        suffix="ر.س"
                        type="number"
                      />
                      {index === 0 ? (
                        <button className="iconbtn add" type="button" title="إضافة إكسسوار آخر" onClick={addAccessoryRow}>
                          <Plus />
                        </button>
                      ) : (
                        <button
                          className="iconbtn del"
                          type="button"
                          title="حذف"
                          onClick={() => setAccessoryRows((current) => current.filter((item) => item.id !== row.id))}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </details>

            <details className="acc" open>
              <summary>
                <span className="ico">د</span>
                التكاليف
                <ChevronDown className="chev" />
              </summary>
              <div className="acc-body">
                <div className="grid">
                  <DisplayField label="تكلفة القماش" value={formatCurrency(calculations.fabricCost)} auto hint="من الأقمشة × أسعارها" />
                  <DisplayField label="تكلفة الإكسسوارات" value={formatCurrency(calculations.accessoriesCost)} auto hint="مجموع أسعار الإكسسوارات" />
                  <EditableField label="تكلفة الخياطة" value={tailoringCost} onChange={setTailoringCost} suffix="ر.س" type="number" />
                  <EditableField label="تكلفة التطريز" value={embroideryCost} onChange={setEmbroideryCost} suffix="ر.س" type="number" />
                  <EditableField label="تكلفة إضافية" value={extraCost} onChange={setExtraCost} suffix="ر.س" type="number" hint="كي • تغليف…" />
                  <DisplayField label="التكلفة الإجمالية" value={formatCurrency(calculations.totalCost)} auto hint="مجموع ما سبق" />
                </div>
              </div>
            </details>

            <div className="note m">
              <b>الحساب الحالي:</b> يمكن إنتاج {formatNumber(calculations.producibleCount)} قطعة من أضعف قماش في الوصفة.
              {calculations.mainFabric
                ? ` القماش الأساسي: ${calculations.mainFabric.name} • استهلاك القطعة: ${formatNumber(metersToCurrentUnit(calculations.mainConsumptionMeters, unit))} ${currentUnitLabel}.`
                : ' اختر قماشاً أساسياً لإظهار الحسابات.'}
            </div>

            {error && (
              <div className="note" style={{ margin: '0 18px 14px', background: '#fdecea', borderColor: '#f5c2c0', color: '#a3261f' }}>
                {error}
              </div>
            )}

            <button className="btn" type="button" onClick={() => void saveModel()} disabled={!fabrics.length || saving}>
              {saving ? 'جاري الحفظ…' : 'حفظ الموديل'}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={saving}
              onClick={() => {
                setImageData(null);
                setSelectedColors(['متعدد الألوان']);
                setDescription('تفاصيل التصميم والقصة…');
                setError(null);
              }}
            >
              إلغاء
            </button>
          </div>
        </section>

        <section>
          <BlockTitle marker="2">جدول الموديلات</BlockTitle>
          <p className="block-sub">اضغط على أي موديل ليفتح أسفله أكورديون باللوحة الذكية.</p>
          <div className="card">
            <div className="search-bar">
              <Search className="search-ico" />
              <input
                className="search-input"
                type="search"
                placeholder="ابحث برمز المنتج أو رمز القماش…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>رقم الصنف</th>
                    <th>الألوان</th>
                    <th>القماش الأساسي</th>
                    <th>الكمية</th>
                    <th>التكلفة الإجمالية</th>
                    <th>الحالة</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.map((model) => (
                    <ModelTableRows
                      key={model.id}
                      model={model}
                      fabrics={fabrics}
                      isOpen={Boolean(openRows[model.id])}
                      onToggle={() => setOpenRows((current) => ({ ...current, [model.id]: !current[model.id] }))}
                      onDelete={() => void deleteModel(model.id)}
                      disabled={saving}
                    />
                  ))}
                  {!filteredModels.length && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted-foreground)' }}>
                        {normalizedSearch
                          ? 'لا توجد موديلات مطابقة لبحثك.'
                          : 'لا توجد موديلات محفوظة بعد — أضف موديلاً من الفورم بالأعلى.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>

      <style jsx global>{`
        .models-spec {
          --background: #eee2d4;
          --foreground: #2c2416;
          --card: #ffffff;
          --card-foreground: #2c2416;
          --primary: #8b6f47;
          --primary-foreground: #ffffff;
          --muted: #f5ebe0;
          --muted-foreground: #6b5d4f;
          --accent: #a08968;
          --border: #d4c4b0;
          --input: #d4c4b0;
          --green: #3f7d4e;
          --green-soft: #e8f1ea;
          --amber: #b8791f;
          --amber-soft: #faf0dc;
          --blue: #3a6ea5;
          --blue-soft: #e9f0f7;
          width: 100%;
          color: var(--foreground);
          font-family: var(--font-tajawal), Tajawal, Arial, sans-serif;
          font-size: 15px;
          line-height: 1.7;
          text-align: right;
        }
        .models-spec *,
        .models-spec *::before,
        .models-spec *::after { box-sizing: border-box; }
        .models-spec .wrap { max-width: none; margin: 0; padding: 0 0 56px; }
        .models-spec .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
        .models-spec .stat-card,
        .models-spec .card {
          background: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          box-shadow: 0 1px 2px rgba(44, 36, 22, .04);
        }
        .models-spec .stat-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px; }
        .models-spec .stat-card .k { font-size: 13.5px; color: var(--muted-foreground); margin: 0; }
        .models-spec .stat-card .v { font-size: 20px; font-weight: 700; margin: 4px 0 0; }
        .models-spec .stat-ico {
          border-radius: 6px;
          background: var(--muted);
          padding: 8px;
          color: var(--muted-foreground);
          display: grid;
          place-items: center;
        }
        .models-spec .stat-ico svg { width: 18px; height: 18px; }
        .models-spec section { margin-top: 26px; }
        .models-spec .block-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 17px;
          font-weight: 700;
          margin: 0 0 4px;
        }
        .models-spec .block-title .n,
        .models-spec details.acc > summary .ico {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: var(--primary);
          color: #fff;
          display: grid;
          place-items: center;
          font-size: 13px;
          font-weight: 700;
          flex: 0 0 auto;
        }
        .models-spec .block-sub { color: var(--muted-foreground); font-size: 13.5px; margin: 0 0 14px; }
        .models-spec .card-head { font-size: 16px; font-weight: 700; padding: 16px 18px 6px; }
        .models-spec .card-head .desc { font-size: 13px; font-weight: 400; color: var(--muted-foreground); margin-top: 3px; }
        .models-spec details.acc {
          border: 1px solid var(--border);
          border-radius: 8px;
          margin: 0 18px 14px;
          background: var(--card);
          overflow: visible;
        }
        .models-spec details.acc[open] { box-shadow: 0 1px 2px rgba(44, 36, 22, .04); }
        .models-spec details.acc > summary {
          list-style: none;
          cursor: pointer;
          padding: 13px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 700;
          font-size: 15px;
          background: var(--muted);
          user-select: none;
          border-radius: 7px;
        }
        .models-spec details.acc[open] > summary { border-radius: 7px 7px 0 0; }
        .models-spec details.acc > summary::-webkit-details-marker { display: none; }
        .models-spec details.acc > summary .chev {
          margin-inline-start: auto;
          transition: transform .2s;
          color: var(--muted-foreground);
          width: 18px;
          height: 18px;
        }
        .models-spec details.acc[open] > summary .chev { transform: rotate(180deg); }
        .models-spec details.acc > summary .tag {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 9px;
          border-radius: 999px;
          background: var(--amber-soft);
          color: var(--amber);
          margin-inline-start: 4px;
        }
        .models-spec .acc-body { padding: 16px; border-top: 1px solid var(--border); }
        .models-spec .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .models-spec .field label {
          display: block;
          font-size: 13.5px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--foreground);
        }
        .models-spec .field .inp {
          background: var(--card);
          border: 1px solid var(--input);
          border-radius: 6px;
          padding: 8px 11px;
          font-size: 13.5px;
          color: var(--foreground);
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 38px;
          width: 100%;
          font-family: inherit;
          text-align: right;
        }
        .models-spec textarea.inp { resize: vertical; min-height: 64px; align-items: flex-start; }
        .models-spec .field .hint,
        .models-spec .hint { font-size: 11.5px; color: #a89a8a; margin-top: 5px; display: block; }
        .models-spec .field.auto .inp { background: var(--green-soft); border-color: #c5ddca; color: var(--green); font-weight: 700; }
        .models-spec .field.auto label::after { content: " • تلقائي"; color: var(--green); font-weight: 700; font-size: 11px; }
        .models-spec .full { grid-column: 1 / -1; }
        .models-spec .sel-wrap { position: relative; }
        .models-spec .sel-trigger {
          width: 100%;
          background: var(--card);
          border: 1px solid var(--input);
          border-radius: 6px;
          padding: 8px 11px;
          font-size: 13.5px;
          color: var(--foreground);
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          user-select: none;
          transition: border-color .15s;
          font-family: inherit;
          text-align: right;
        }
        .models-spec .sel-trigger:hover { border-color: var(--primary); }
        .models-spec .sel-trigger.open { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(139, 111, 71, .15); }
        .models-spec .sel-trigger .sel-val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .models-spec .sel-trigger .sel-chev { color: var(--muted-foreground); transition: transform .2s; font-size: 12px; }
        .models-spec .sel-trigger.open .sel-chev { transform: rotate(180deg); }
        .models-spec .sel-menu {
          position: absolute;
          inset-inline: 0 auto;
          top: calc(100% + 4px);
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 6px 20px rgba(44, 36, 22, .15);
          z-index: 50;
          display: none;
          flex-direction: column;
          min-width: 160px;
          width: 100%;
        }
        .models-spec .sel-menu.open { display: flex; }
        .models-spec .sel-options-list { overflow-y: auto; max-height: 220px; border-radius: 8px; }
        .models-spec .sel-option {
          width: 100%;
          border: 0;
          background: transparent;
          text-align: right;
          padding: 9px 13px;
          cursor: pointer;
          font-size: 13.5px;
          transition: background .1s;
          white-space: nowrap;
          font-family: inherit;
          color: var(--foreground);
        }
        .models-spec .sel-option:hover,
        .models-spec .sel-option.selected { background: var(--muted); }
        .models-spec .sel-option.selected { font-weight: 700; color: var(--primary); }
        .models-spec .sel-add-row {
          display: flex;
          gap: 6px;
          padding: 8px 10px;
          border-top: 1px solid var(--border);
          background: var(--muted);
          border-radius: 0 0 8px 8px;
          flex-shrink: 0;
        }
        .models-spec .sel-add-input {
          flex: 1;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          font-family: inherit;
          background: var(--card);
          color: var(--foreground);
          outline: none;
          min-width: 0;
        }
        .models-spec .sel-add-input:focus { border-color: var(--primary); }
        .models-spec .sel-add-btn {
          background: var(--primary);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .models-spec .color-pop { min-width: 320px; }
        .models-spec .color-menu { display: block; padding: 12px; }
        .models-spec .color-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
        .models-spec .color-chip {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform .15s, border-color .15s;
        }
        .models-spec .color-chip:hover { transform: scale(1.15); }
        .models-spec .color-chip.selected { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(139, 111, 71, .25); }
        .models-spec .color-chip.multi {
          width: auto;
          height: auto;
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 12.5px;
          font-weight: 700;
          background: var(--muted);
          color: var(--foreground);
          border-color: var(--border);
          font-family: inherit;
        }
        .models-spec .color-chip.multi.selected { background: var(--primary); color: #fff; border-color: var(--primary); }
        .models-spec .color-help { font-size: 12px; color: var(--muted-foreground); }
        .models-spec .color-val { display: inline-flex; align-items: center; gap: 5px; margin-inline-end: 8px; }
        .models-spec .color-swatch {
          display: inline-block;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 1px solid rgba(0, 0, 0, .15);
          margin-inline-end: 5px;
          vertical-align: middle;
        }
        .models-spec .sec-a-wrap { display: flex; gap: 16px; align-items: stretch; }
        .models-spec .sec-a-img { flex-shrink: 0; width: 190px; display: flex; flex-direction: column; }
        .models-spec .sec-a-img label {
          display: block;
          font-size: 13.5px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--foreground);
        }
        .models-spec .sec-a-imgbox { flex: 1; min-height: 180px; }
        .models-spec .sec-a-fields { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-content: start; }
        .models-spec .imgbox {
          border: 1px dashed var(--border);
          background: var(--muted);
          border-radius: 8px;
          min-height: 120px;
          display: grid;
          place-items: center;
          color: var(--accent);
          font-size: 13px;
          text-align: center;
        }
        .models-spec .unit-field { margin-bottom: 16px; }
        .models-spec .rep-label { font-size: 13.5px; font-weight: 700; margin: 4px 0 8px; color: var(--primary); }
        .models-spec .rep-row { display: grid; gap: 10px; align-items: end; margin-bottom: 10px; }
        .models-spec .rep-row.fabric { grid-template-columns: 170px 1fr 130px 44px; }
        .models-spec .rep-row.acc-row { grid-template-columns: 1fr 150px 44px; }
        .models-spec .iconbtn {
          width: 38px;
          height: 38px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          font-size: 18px;
          border: 1px solid var(--border);
          background: var(--card);
          cursor: pointer;
          color: inherit;
        }
        .models-spec .iconbtn svg { width: 16px; height: 16px; }
        .models-spec .iconbtn.add { background: var(--primary); color: #fff; border-color: var(--primary); }
        .models-spec .iconbtn.del { color: #dc2626; }
        .models-spec .role-pill {
          display: inline-flex;
          align-items: center;
          height: 38px;
          padding: 0 12px;
          border-radius: 6px;
          background: var(--muted);
          border: 1px solid var(--border);
          font-size: 12.5px;
          font-weight: 700;
          color: var(--muted-foreground);
          justify-content: center;
        }
        .models-spec .block-hint { margin: -2px 0 18px; }
        .models-spec .btn {
          background: var(--primary);
          color: var(--primary-foreground);
          border: none;
          border-radius: 6px;
          padding: 8px 18px;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          display: inline-block;
          margin: 6px 18px 18px;
        }
        .models-spec .btn:disabled { cursor: not-allowed; opacity: .55; }
        .models-spec .btn.ghost { background: transparent; color: var(--foreground); border: 1px solid var(--border); }
        .models-spec .search-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 12px 12px 0;
          padding: 8px 12px;
          background: var(--card);
          border: 1px solid var(--input);
          border-radius: 8px;
        }
        .models-spec .search-bar:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(139, 111, 71, .15); }
        .models-spec .search-ico { width: 16px; height: 16px; color: var(--muted-foreground); flex: 0 0 auto; }
        .models-spec .search-input {
          flex: 1;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--foreground);
          font: inherit;
          font-size: 13.5px;
          text-align: right;
          min-width: 0;
        }
        .models-spec table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .models-spec thead th {
          text-align: right;
          padding: 10px 12px;
          font-weight: 500;
          color: var(--muted-foreground);
          border-bottom: 1px solid var(--border);
        }
        .models-spec tbody td { padding: 12px; border-bottom: 1px solid var(--border); color: var(--foreground); }
        .models-spec .table-wrap { padding: 6px 12px 12px; overflow-x: auto; }
        .models-spec .pill { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
        .models-spec .pill.ok { background: var(--green-soft); color: var(--green); }
        .models-spec .pill.warn { background: var(--amber-soft); color: var(--amber); }
        .models-spec .actions { display: inline-flex; gap: 10px; color: var(--muted-foreground); }
        .models-spec .actions svg { width: 15px; height: 15px; }
        .models-spec tr.model-row { cursor: pointer; }
        .models-spec tr.model-row:hover { background: var(--muted); }
        .models-spec tr.model-row .caret { display: inline-block; transition: transform .2s; color: var(--muted-foreground); }
        .models-spec tr.model-row.open .caret { transform: rotate(180deg); }
        .models-spec tr.panel-row > td { padding: 0; border-bottom: 1px solid var(--border); }
        .models-spec .panel-inner { display: none; padding: 16px; background: var(--muted); }
        .models-spec tr.panel-row.show .panel-inner { display: block; }
        .models-spec .smart { display: grid; grid-template-columns: 180px 1fr; gap: 18px; }
        .models-spec .smart .img {
          background: var(--card);
          border: 1px dashed var(--border);
          border-radius: 8px;
          display: grid;
          place-items: center;
          color: var(--accent);
          font-size: 13px;
          min-height: 170px;
          text-align: center;
        }
        .models-spec .smart .mmeta { color: var(--muted-foreground); font-size: 13px; margin-bottom: 14px; }
        .models-spec .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .models-spec .ministat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
        .models-spec .ministat .k { font-size: 12px; color: var(--muted-foreground); }
        .models-spec .ministat .v { font-size: 19px; font-weight: 800; margin-top: 3px; }
        .models-spec .ministat.hl { background: var(--green-soft); border-color: #c5ddca; }
        .models-spec .ministat.hl .v { color: var(--green); }
        .models-spec .note {
          background: var(--amber-soft);
          border: 1px solid #ecd9b5;
          border-radius: 8px;
          padding: 12px 16px;
          font-size: 13.5px;
          color: #7a5212;
          margin: 0;
        }
        .models-spec .note.m { margin: 14px 18px 18px; }
        .models-spec .note.no-stock { margin: 0 0 16px; }
        .models-spec .note b { color: #5c3d0a; }
        @media (max-width: 760px) {
          .models-spec .stats-row { grid-template-columns: repeat(2, 1fr); }
          .models-spec .grid { grid-template-columns: 1fr; }
          .models-spec .sec-a-wrap { flex-direction: column; }
          .models-spec .sec-a-img { width: 100%; }
          .models-spec .sec-a-fields { grid-template-columns: 1fr; }
          .models-spec .rep-row.fabric { grid-template-columns: 1fr 1fr 44px; }
          .models-spec .rep-row.fabric .role-pill { grid-column: 1 / -1; }
          .models-spec .smart { grid-template-columns: 1fr; }
          .models-spec .stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
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

function BlockTitle({ marker, children }: { marker: string; children: React.ReactNode }) {
  return (
    <div className="block-title">
      <span className="n">{marker}</span>
      {children}
    </div>
  );
}

function DisplayField({
  label,
  value,
  hint,
  className = '',
  auto,
}: {
  label?: string;
  value: string;
  hint?: string;
  className?: string;
  auto?: boolean;
}) {
  return (
    <div className={`field ${auto ? 'auto' : ''} ${className}`}>
      {label && <label>{label}</label>}
      <div className="inp">{value}</div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  hint,
  className = '',
  area,
  suffix,
  type = 'text',
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
  area?: boolean;
  suffix?: string;
  type?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {area ? (
        <textarea className="inp" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <div className="inp">
          <input
            type={type}
            min={type === 'number' ? '0' : undefined}
            step={type === 'number' ? '0.01' : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            style={{
              width: '100%',
              border: 0,
              outline: 0,
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              textAlign: 'right',
            }}
          />
          {suffix && <span style={{ whiteSpace: 'nowrap', color: 'var(--muted-foreground)' }}>{suffix}</span>}
        </div>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function SelectBox({
  id,
  label,
  options,
  value,
  openSelect,
  setOpenSelect,
  onChange,
  className = '',
  hint,
  placeholder = 'اختر',
  allowCustom,
}: {
  id: string;
  label?: string;
  options: SelectOption[];
  value: string;
  openSelect: string | null;
  setOpenSelect: (value: string | null) => void;
  onChange: (id: string, value: string) => void;
  className?: string;
  hint?: string;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const isOpen = openSelect === id;
  const [customValue, setCustomValue] = useState('');

  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      <div className="sel-wrap">
        <button
          type="button"
          className={`sel-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setOpenSelect(isOpen ? null : id)}
        >
          <span className="sel-val">{selected?.label || value || placeholder}</span>
          <span className="sel-chev">▾</span>
        </button>
        <div className={`sel-menu ${isOpen ? 'open' : ''}`}>
          <div className="sel-options-list">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`sel-option ${option.value === value ? 'selected' : ''}`}
                onClick={() => onChange(id, option.value)}
              >
                {option.label}
              </button>
            ))}
            {!options.length && <div className="sel-option">لا توجد خيارات</div>}
          </div>
          {allowCustom && (
            <div className="sel-add-row">
              <input
                className="sel-add-input"
                placeholder="اكتب خياراً جديداً…"
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && customValue.trim()) {
                    event.preventDefault();
                    onChange(id, customValue.trim());
                    setCustomValue('');
                  }
                }}
              />
              <button
                className="sel-add-btn"
                type="button"
                onClick={() => {
                  if (!customValue.trim()) return;
                  onChange(id, customValue.trim());
                  setCustomValue('');
                }}
              >
                ＋ إضافة
              </button>
            </div>
          )}
        </div>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function ModelTableRows({
  model,
  fabrics,
  isOpen,
  onToggle,
  onDelete,
  disabled,
}: {
  model: DesignModel;
  fabrics: Fabric[];
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const mainFabricRow = model.fabrics[0];
  const mainFabric = fabrics.find((fabric) => fabric.id === mainFabricRow?.fabricId);
  const statusLabel = getStatusLabel(model.status);
  const statusClass = model.status === 'active' ? 'ok' : 'warn';
  const unitLabel = model.unit === 'yard' ? 'ياردة' : 'م';
  const mainConsumption = mainFabricRow
    ? formatNumber(metersToCurrentUnit(consumptionToMeters(mainFabricRow.consumption, model.unit), model.unit))
    : '0';

  return (
    <>
      <tr className={`model-row ${isOpen ? 'open' : ''}`} onClick={onToggle}>
        <td><span className="caret">▾</span></td>
        <td>{model.sku}</td>
        <td>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {model.colors.map((color) => (
              <span
                key={color}
                className="color-swatch"
                style={{ background: colorMap.get(color) || '#d4c4b0', width: 16, height: 16, marginInlineEnd: 0 }}
                title={color}
              />
            ))}
          </span>
        </td>
        <td>{mainFabric?.name || '-'}</td>
        <td>{formatNumber(model.producibleCount)} قطع</td>
        <td>{formatCurrency(model.totalCost)}</td>
        <td><span className={`pill ${statusClass}`}>{statusLabel}</span></td>
        <td>
          <span className="actions" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              title="حذف الموديل"
              disabled={disabled}
              onClick={onDelete}
              style={{ border: 0, background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer', color: '#dc2626', padding: 0 }}
            >
              <Trash2 />
            </button>
          </span>
        </td>
      </tr>
      <tr className={`panel-row ${isOpen ? 'show' : ''}`}>
        <td colSpan={8}>
          <div className="panel-inner">
            <div className="smart">
              <div className="img" style={model.imageData ? { padding: 0, overflow: 'hidden' } : undefined}>
                {model.imageData ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={model.imageData}
                    alt={`تصميم ${model.sku}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span>
                    🖼️
                    <br />
                    صورة التصميم
                  </span>
                )}
              </div>
              <div>
                <div className="mmeta">
                  القماش الأساسي: {mainFabric?.name || '-'} • استهلاك القطعة: {mainConsumption} {unitLabel}
                </div>
                <div className="stats">
                  <MiniStat className="hl" title="📊 يمكن إنتاجه من المخزون" value={`${formatNumber(model.producibleCount)} فساتين`} />
                  <MiniStat title="💰 تكلفة القطعة" value={formatCurrency(model.totalCost)} />
                  <MiniStat title="✂️ تكلفة الخياطة" value={formatCurrency(model.tailoringCost)} />
                  <MiniStat title="📦 منتَج حالياً" value={formatNumber(model.producedCount)} />
                  <MiniStat title="⏳ قيد الخياطة" value={formatNumber(model.inProgressCount)} />
                  <MiniStat title="🧵 قماش محجوز للموديل" value={`${formatNumber(model.reservedLength)}م`} />
                </div>
              </div>
            </div>
            <div className="note" style={{ marginTop: 14 }}>
              <b>وصفة القماش:</b>{' '}
              {model.fabrics
                .map((row) => {
                  const fabric = fabrics.find((item) => item.id === row.fabricId);
                  const fabricLabel = fabric ? `${fabric.name}${fabric.sku ? ` (${fabric.sku})` : ''}` : '-';
                  return `${getRoleLabel(row.role)}: ${fabricLabel} × ${row.consumption} ${unitLabel}`;
                })
                .join(' • ')}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function MiniStat({ title, value, className = '' }: { title: string; value: string; className?: string }) {
  return (
    <div className={`ministat ${className}`}>
      <div className="k">{title}</div>
      <div className="v">{value}</div>
    </div>
  );
}
