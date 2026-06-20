'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

type Accessory = {
  id: string;
  name: string;
  sku?: string | null;
  unitPrice: number;
  stockQty: number;
};

export type SelectOption = {
  value: string;
  label: string;
};

type RecipeFabricRow = {
  id: string;
  role: string;
  fabricId: string;
  consumption: string;
};

// Form row for editing a model's accessory recipe (references real inventory).
type AccessoryRow = {
  id: string;
  accessoryId: string;
  consumption: string;
};

// Serialized accessory line returned by the API for an existing model.
type ModelAccessory = {
  id: string;
  accessoryId: string;
  name: string;
  consumption: string;
  unitPrice: number | null;
  cost: number;
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
  accessories: ModelAccessory[];
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

const BASE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: 'نشط' },
  { value: 'paused', label: 'موقوف' },
  { value: 'draft', label: 'تحت التطوير' },
];

const STATUS_OPTIONS_STORAGE_KEY = 'mleha:model-status-options';

// Status options are user-editable: built-ins plus any custom statuses the user
// adds/renames. Persisted in localStorage and merged with statuses already used
// by existing models so an in-use status can never disappear from the dropdown.
function loadStatusOptions(): SelectOption[] {
  if (typeof window === 'undefined') return BASE_STATUS_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STATUS_OPTIONS_STORAGE_KEY);
    if (!raw) return BASE_STATUS_OPTIONS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return BASE_STATUS_OPTIONS;
    const cleaned = parsed
      .filter((item) => item && typeof item.value === 'string')
      .map((item) => ({ value: item.value, label: String(item.label || item.value) }));
    return cleaned.length ? cleaned : BASE_STATUS_OPTIONS;
  } catch {
    return BASE_STATUS_OPTIONS;
  }
}

function saveStatusOptions(options: SelectOption[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATUS_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* ignore quota / serialization errors */
  }
}

// Ensure every status value used by an existing model is present as an option.
function mergeModelStatuses(options: SelectOption[], models: DesignModel[]): SelectOption[] {
  const map = new Map(options.map((option) => [option.value, option]));
  let changed = false;
  models.forEach((model) => {
    const value = (model.status || '').trim();
    if (value && !map.has(value)) {
      map.set(value, { value, label: value });
      changed = true;
    }
  });
  return changed ? Array.from(map.values()) : options;
}

const unitOptions: SelectOption[] = [
  { value: 'meter', label: 'متر' },
  { value: 'yard', label: 'ياردة' },
];

const BASE_ROLE_OPTIONS: SelectOption[] = [
  { value: 'main', label: 'أساسي' },
  { value: 'bottom', label: 'قطعة سفلية' },
  { value: 'inner', label: 'قماش داخلي' },
  { value: 'lining', label: 'بطانة' },
  { value: 'embroidery', label: 'تطريز' },
];

const ROLE_OPTIONS_STORAGE_KEY = 'mleha:model-role-options';

// Fabric-role options are user-editable: built-ins plus any custom roles the user
// adds/renames. Persisted in localStorage and merged with roles already used by
// existing models so an in-use role can never disappear from the dropdown.
function loadRoleOptions(): SelectOption[] {
  if (typeof window === 'undefined') return BASE_ROLE_OPTIONS;
  try {
    const raw = window.localStorage.getItem(ROLE_OPTIONS_STORAGE_KEY);
    if (!raw) return BASE_ROLE_OPTIONS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return BASE_ROLE_OPTIONS;
    const cleaned = parsed
      .filter((item) => item && typeof item.value === 'string')
      .map((item) => ({ value: item.value, label: String(item.label || item.value) }));
    return cleaned.length ? cleaned : BASE_ROLE_OPTIONS;
  } catch {
    return BASE_ROLE_OPTIONS;
  }
}

function saveRoleOptions(options: SelectOption[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ROLE_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* ignore quota / serialization errors */
  }
}

// Ensure every role value used by an existing model's fabrics is present as an option.
function mergeModelRoles(options: SelectOption[], models: DesignModel[]): SelectOption[] {
  const map = new Map(options.map((option) => [option.value, option]));
  let changed = false;
  models.forEach((model) => {
    model.fabrics.forEach((row) => {
      const value = (row.role || '').trim();
      if (value && !map.has(value)) {
        map.set(value, { value, label: value });
        changed = true;
      }
    });
  });
  return changed ? Array.from(map.values()) : options;
}


type ColorChip = { name: string; value: string; border?: boolean; custom?: boolean };

const colors: ColorChip[] = [
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

// Custom colors are persisted in the model's `colors` string[] as "name::#hex"
// so their swatch survives a reload (preset colors are stored as a plain name).
const COLOR_SEP = '::';
function parseStoredColor(raw: string): { name: string; hex?: string } {
  const index = raw.indexOf(COLOR_SEP);
  if (index === -1) return { name: raw };
  return { name: raw.slice(0, index), hex: raw.slice(index + COLOR_SEP.length) || undefined };
}
function encodeColors(selected: string[], customColors: ColorChip[]): string[] {
  const source = selected.length ? selected : ['متعدد الألوان'];
  return source.map((name) => {
    const custom = customColors.find((chip) => chip.name === name);
    return custom ? `${name}${COLOR_SEP}${custom.value}` : name;
  });
}
// Split a stored colors[] into display names + the custom name→hex chips it carries.
function decodeStoredColors(stored: string[]): { names: string[]; customColors: ColorChip[] } {
  const names: string[] = [];
  const customColors: ColorChip[] = [];
  stored.forEach((raw) => {
    const { name, hex } = parseStoredColor(raw);
    names.push(name);
    if (hex && name !== 'متعدد الألوان' && !colors.some((preset) => preset.name === name)) {
      customColors.push({ name, value: hex, custom: true });
    }
  });
  return { names, customColors };
}
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

function getStatusLabel(status: string, options: SelectOption[] = BASE_STATUS_OPTIONS) {
  return options.find((option) => option.value === status)?.label || status;
}

function getRoleLabel(role: string, options: SelectOption[] = BASE_ROLE_OPTIONS) {
  return options.find((option) => option.value === role)?.label || role;
}

function calculateModel(input: {
  fabrics: Fabric[];
  accessoriesInventory: Accessory[];
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
  const accessoriesCost = input.accessories.reduce((sum, row) => {
    const accessory = input.accessoriesInventory.find((item) => item.id === row.accessoryId);
    return sum + toNumber(row.consumption) * (accessory?.unitPrice || 0);
  }, 0);
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
  accessoriesInventory,
  models,
  onChanged,
  unit,
}: {
  fabrics: Fabric[];
  accessoriesInventory: Accessory[];
  models: DesignModel[];
  onChanged: () => void | Promise<void>;
  unit: 'meter' | 'yard';
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const [sku, setSku] = useState('');
  const [status, setStatus] = useState('active');
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>(() => loadStatusOptions());
  const [description, setDescription] = useState('تفاصيل التصميم والقصة…');
  const [imageData, setImageData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>(['متعدد الألوان']);
  const [customColors, setCustomColors] = useState<ColorChip[]>([]);
  const [roleOptions, setRoleOptions] = useState<SelectOption[]>(() => loadRoleOptions());
  const [editModel, setEditModel] = useState<DesignModel | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeFabricRow[]>([
    { id: 'main', role: 'main', fabricId: '', consumption: '' },
  ]);
  const [accessoryRows, setAccessoryRows] = useState<AccessoryRow[]>(() => [
    { id: makeId('accessory'), accessoryId: '', consumption: '' },
  ]);
  // Tailoring & embroidery are auto-derived from the production cycle; a brand-new
  // model has no deliveries yet, so both stay 0 and read-only here.
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

  const accessoryOptionsInv = useMemo<SelectOption[]>(
    () =>
      accessoriesInventory.map((accessory) => ({
        value: accessory.id,
        label: `${accessory.name} — ${formatCurrency(accessory.unitPrice)}`,
      })),
    [accessoriesInventory]
  );

  const calculations = useMemo(
    () =>
      calculateModel({
        fabrics,
        accessoriesInventory,
        rows: recipeRows,
        accessories: accessoryRows,
        unit,
        tailoringCost: '0',
        embroideryCost: '0',
        extraCost,
      }),
    [accessoriesInventory, accessoryRows, extraCost, fabrics, recipeRows, unit]
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

  // Keep the dropdown in sync with statuses already saved on existing models.
  useEffect(() => {
    setStatusOptions((current) => {
      const merged = mergeModelStatuses(current, models);
      if (merged !== current) saveStatusOptions(merged);
      return merged;
    });
  }, [models]);

  const persistStatusOptions = (next: SelectOption[]) => {
    setStatusOptions(next);
    saveStatusOptions(next);
  };

  // Adds the status to the shared option list (if new) and returns the value to
  // select. The caller decides where to apply that selection (create form vs. drawer).
  const addStatusOption = (rawLabel: string): string => {
    const label = rawLabel.trim();
    if (!label) return '';
    const existing = statusOptions.find(
      (option) => option.value === label || option.label.trim() === label
    );
    if (existing) return existing.value;
    persistStatusOptions([...statusOptions, { value: label, label }]);
    return label;
  };

  const editStatusOption = (value: string, rawLabel: string) => {
    const label = rawLabel.trim();
    if (!label) return;
    persistStatusOptions(
      statusOptions.map((option) => (option.value === value ? { ...option, label } : option))
    );
  };

  const deleteStatusOption = (value: string) => {
    if (statusOptions.length <= 1) return;
    persistStatusOptions(statusOptions.filter((option) => option.value !== value));
    if (status === value) {
      const fallback = statusOptions.find((option) => option.value !== value);
      if (fallback) setStatus(fallback.value);
    }
  };

  // Keep the role dropdown in sync with roles already used by existing models.
  useEffect(() => {
    setRoleOptions((current) => {
      const merged = mergeModelRoles(current, models);
      if (merged !== current) saveRoleOptions(merged);
      return merged;
    });
  }, [models]);

  const persistRoleOptions = (next: SelectOption[]) => {
    setRoleOptions(next);
    saveRoleOptions(next);
  };

  // Adds the role to the shared option list (if new) and returns the value to
  // select. The caller decides where to apply that selection (create form vs. drawer).
  const addRoleOption = (rawLabel: string): string => {
    const label = rawLabel.trim();
    if (!label) return '';
    const existing = roleOptions.find(
      (option) => option.value === label || option.label.trim() === label
    );
    if (existing) return existing.value;
    persistRoleOptions([...roleOptions, { value: label, label }]);
    return label;
  };

  const editRoleOption = (value: string, rawLabel: string) => {
    const label = rawLabel.trim();
    if (!label) return;
    persistRoleOptions(
      roleOptions.map((option) => (option.value === value ? { ...option, label } : option))
    );
  };

  const deleteRoleOption = (value: string) => {
    if (roleOptions.length <= 1) return;
    persistRoleOptions(roleOptions.filter((option) => option.value !== value));
    const fallback = roleOptions.find((option) => option.value !== value);
    if (fallback) {
      setRecipeRows((current) =>
        current.map((row) => (row.role === value ? { ...row, role: fallback.value } : row))
      );
    }
  };

  const setSelectValue = (id: string, value: string) => {
    if (id === 'status') setStatus(value);
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
      setAccessoryRows((current) => current.map((row) => (row.id === rowId ? { ...row, accessoryId: value } : row)));
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
        fabricId: '',
        consumption: '',
      },
    ]);
  };

  const addAccessoryRow = () => {
    setAccessoryRows((current) => [
      ...current,
      { id: makeId('accessory'), accessoryId: '', consumption: '' },
    ]);
  };

  // Create a brand-new inventory item from the dropdown's "add new" row, then
  // select it on the row that triggered it (mirrors final-design-v2's inline add).
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
      colors: encodeColors(selectedColors, customColors),
      imageData,
      recipe: recipeRows.map((row) => ({ role: row.role, fabricId: row.fabricId, consumption: row.consumption })),
      accessories: accessoryRows
        .filter((row) => row.accessoryId)
        .map((row) => ({ accessoryId: row.accessoryId, consumption: row.consumption })),
      tailoringCost: 0,
      embroideryCost: 0,
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

        <div className="card">
            <div className="card-head">
              بيانات الموديل
              <div className="desc">اختر الأقمشة وشاهد التكلفة والكمية الممكنة تلقائياً</div>
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
                      allowCustom
                      onCustomAdd={(id, value) => {
                        const resolved = addStatusOption(value);
                        if (resolved) setSelectValue(id, resolved);
                      }}
                      addPlaceholder="حالة جديدة…"
                      editableOptions
                      onEditOption={(_id, value, label) => editStatusOption(value, label)}
                      onDeleteOption={(_id, value) => deleteStatusOption(value)}
                    />

                    <ColorPicker
                      id="colors"
                      openSelect={openSelect}
                      setOpenSelect={setOpenSelect}
                      selected={selectedColors}
                      onToggle={toggleColor}
                      customColors={customColors}
                      onAddCustom={(name, value) => {
                        setCustomColors((current) =>
                          current.some((c) => c.name === name) ? current : [...current, { name, value, custom: true }]
                        );
                        setSelectedColors((current) => (current.includes(name) ? current : [...current, name]));
                      }}
                      onDeleteCustom={(name) => {
                        setCustomColors((current) => current.filter((c) => c.name !== name));
                        setSelectedColors((current) => current.filter((c) => c !== name));
                      }}
                    />

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
                {!fabrics.length && (
                  <div className="note no-stock">
                    أضف أقمشة من تبويب المخزون أولاً حتى تظهر في وصفة الموديل وحسابات الإنتاج.
                  </div>
                )}

                <div className="rep-label">الأقمشة</div>
                <div>
                  {recipeRows.map((row, index) => (
                    <div className={`rep-row ${index === 0 ? 'fabric-main' : 'fabric-extra'}`} key={row.id}>
                      {index === 0 ? (
                        <div
                          className="iconbtn"
                          title="قماش أساسي"
                          style={{ fontSize: 18, color: 'var(--amber)', borderColor: 'var(--amber-soft)', background: 'var(--amber-soft)' }}
                        >
                          ★
                        </div>
                      ) : (
                        <SelectBox
                          id={`role-${row.id}`}
                          options={roleOptions}
                          value={row.role}
                          openSelect={openSelect}
                          setOpenSelect={setOpenSelect}
                          onChange={setSelectValue}
                          allowCustom
                          onCustomAdd={(id, value) => {
                            const resolved = addRoleOption(value);
                            if (resolved) setSelectValue(id, resolved);
                          }}
                          addPlaceholder="نوع جديد"
                          editableOptions
                          onEditOption={(_id, value, label) => editRoleOption(value, label)}
                          onDeleteOption={(_id, value) => deleteRoleOption(value)}
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
                    <div className="rep-row acc" key={row.id}>
                      <SelectBox
                        id={`accessory-${row.id}`}
                        options={accessoryOptionsInv}
                        value={row.accessoryId}
                        openSelect={openSelect}
                        setOpenSelect={setOpenSelect}
                        onChange={setSelectValue}
                        placeholder="اختر الإكسسوار"
                      />
                      <EditableField
                        value={row.consumption}
                        onChange={(consumption) => updateAccessoryRow(row.id, { consumption })}
                        suffix="كمية"
                        type="number"
                      />
                      {index === 0 ? (
                        <button className="iconbtn add" type="button" title="إضافة إكسسوار" onClick={addAccessoryRow}>
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
                  {!accessoriesInventory.length && (
                    <span className="hint block-hint">أضف المستلزمات من تبويب المخزون أولاً لتتمكن من ربطها بالموديل</span>
                  )}
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
                  <DisplayField label="تكلفة الخياطة" value={formatCurrency(calculations.tailoringCost)} auto hint="تلقائي من دورة الإنتاج" />
                  <DisplayField label="تكلفة التطريز" value={formatCurrency(calculations.embroideryCost)} auto hint="تلقائي من دورة الإنتاج" />
                  <EditableField label="تكلفة إضافية" value={extraCost} onChange={setExtraCost} suffix="ر.س" type="number" hint="كي • تغليف…" />
                  <DisplayField label="التكلفة الإجمالية" value={formatCurrency(calculations.totalCost)} auto hint="مجموع ما سبق" />
                </div>
              </div>
            </details>

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
                      statusOptions={statusOptions}
                      isOpen={Boolean(openRows[model.id])}
                      onToggle={() => setOpenRows((current) => ({ ...current, [model.id]: !current[model.id] }))}
                      onEdit={() => setEditModel(model)}
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

        {editModel && (
          <ModelEditDrawer
            key={editModel.id}
            model={editModel}
            fabrics={fabrics}
            accessoriesInventory={accessoriesInventory}
            unit={unit}
            openSelect={openSelect}
            setOpenSelect={setOpenSelect}
            statusOptions={statusOptions}
            onAddStatus={addStatusOption}
            onEditStatus={editStatusOption}
            onDeleteStatus={deleteStatusOption}
            roleOptions={roleOptions}
            onAddRole={addRoleOption}
            onEditRole={editRoleOption}
            onDeleteRole={deleteRoleOption}
            onClose={() => setEditModel(null)}
            onSaved={onChanged}
          />
        )}
      </div>
    </div>
  );
}

export function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
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

export function SelectBox({
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
  onCustomAdd,
  addPlaceholder = 'اكتب خياراً جديداً…',
  editableOptions,
  onEditOption,
  onDeleteOption,
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
  onCustomAdd?: (id: string, value: string) => void;
  addPlaceholder?: string;
  editableOptions?: boolean;
  onEditOption?: (id: string, value: string, nextLabel: string) => void;
  onDeleteOption?: (id: string, value: string) => void;
}) {
  const commitCustom = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    (onCustomAdd || onChange)(id, trimmed);
  };
  const selected = options.find((option) => option.value === value);
  const isOpen = openSelect === id;
  const [customValue, setCustomValue] = useState('');
  const [editing, setEditing] = useState<{ value: string; label: string } | null>(null);
  const commitEdit = () => {
    if (!editing) return;
    const next = editing.label.trim();
    if (next) onEditOption?.(id, editing.value, next);
    setEditing(null);
  };

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
            {options.map((option) =>
              editableOptions && editing?.value === option.value ? (
                <div className="sel-edit-row" key={option.value}>
                  <input
                    className="sel-add-input"
                    value={editing.label}
                    autoFocus
                    onChange={(event) => setEditing({ value: option.value, label: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitEdit();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                  <button type="button" className="sel-opt-icon ok" title="حفظ" onClick={commitEdit}>✓</button>
                  <button type="button" className="sel-opt-icon" title="إلغاء" onClick={() => setEditing(null)}>✕</button>
                </div>
              ) : editableOptions ? (
                <div className={`sel-option-row ${option.value === value ? 'selected' : ''}`} key={option.value}>
                  <button
                    type="button"
                    className={`sel-option ${option.value === value ? 'selected' : ''}`}
                    onClick={() => onChange(id, option.value)}
                  >
                    {option.label}
                  </button>
                  <button
                    type="button"
                    className="sel-opt-icon"
                    title="تعديل"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing({ value: option.value, label: option.label });
                    }}
                  >
                    ✎
                  </button>
                  {options.length > 1 && (
                    <button
                      type="button"
                      className="sel-opt-icon del"
                      title="حذف"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteOption?.(id, option.value);
                      }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              ) : (
                <button
                  key={option.value}
                  type="button"
                  className={`sel-option ${option.value === value ? 'selected' : ''}`}
                  onClick={() => onChange(id, option.value)}
                >
                  {option.label}
                </button>
              )
            )}
            {!options.length && <div className="sel-option">لا توجد خيارات</div>}
          </div>
          {allowCustom && (
            <div className="sel-add-row">
              <input
                className="sel-add-input"
                placeholder={addPlaceholder}
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && customValue.trim()) {
                    event.preventDefault();
                    commitCustom(customValue);
                    setCustomValue('');
                  }
                }}
              />
              <button
                className="sel-add-btn"
                type="button"
                onClick={() => {
                  if (!customValue.trim()) return;
                  commitCustom(customValue);
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

function ColorPicker({
  id,
  openSelect,
  setOpenSelect,
  selected,
  onToggle,
  customColors,
  onAddCustom,
  onDeleteCustom,
}: {
  id: string;
  openSelect: string | null;
  setOpenSelect: (value: string | null) => void;
  selected: string[];
  onToggle: (name: string) => void;
  customColors: ColorChip[];
  onAddCustom: (name: string, value: string) => void;
  onDeleteCustom: (name: string) => void;
}) {
  const isOpen = openSelect === id;
  const [hex, setHex] = useState('#aa6688');
  const [name, setName] = useState('');
  const allChips = [...colors, ...customColors];
  const lookup = new Map(allChips.map((chip) => [chip.name, chip.value]));
  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddCustom(trimmed, hex);
    setName('');
  };
  return (
    <div className="field full">
      <label>الألوان المتاحة</label>
      <div className="sel-wrap">
        <button
          type="button"
          className={`sel-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setOpenSelect(isOpen ? null : id)}
        >
          <span className="sel-val">
            {selected.length
              ? selected.map((color) => (
                  <span className="color-val" key={color}>
                    {lookup.has(color) && <span className="color-swatch" style={{ background: lookup.get(color) }} />}
                    {color}
                  </span>
                ))
              : 'اختر الألوان…'}
          </span>
          <span className="sel-chev">▾</span>
        </button>
        <div className={`sel-menu color-pop ${isOpen ? 'open' : ''}`}>
          <div className="color-menu open">
            <div className="color-grid">
              {allChips.map((color) => (
                <span className="chip-wrap" key={color.name}>
                  <button
                    type="button"
                    className={`color-chip ${selected.includes(color.name) ? 'selected' : ''}`}
                    title={color.name}
                    style={{ background: color.value, borderColor: color.border ? '#ccc' : undefined }}
                    onClick={() => onToggle(color.name)}
                  />
                  {color.custom && (
                    <span
                      className="chip-del"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteCustom(color.name);
                      }}
                    >
                      ×
                    </span>
                  )}
                </span>
              ))}
              <button
                type="button"
                className={`color-chip multi ${selected.includes('متعدد الألوان') ? 'selected' : ''}`}
                onClick={() => onToggle('متعدد الألوان')}
              >
                متعدد الألوان
              </button>
            </div>
            <div className="color-help">اضغط لاختيار لون أو أكثر • مرّر على اللون المخصص لحذفه</div>
            <div className="sel-add-row" style={{ borderTop: '1px solid var(--border)' }}>
              <input
                type="color"
                value={hex}
                onChange={(event) => setHex(event.target.value)}
                style={{ width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: 2, cursor: 'pointer', flex: '0 0 auto' }}
                aria-label="اختر لوناً"
              />
              <input
                className="sel-add-input"
                placeholder="اسم اللون"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                  }
                }}
              />
              <button className="sel-add-btn" type="button" onClick={commit}>
                ＋
              </button>
            </div>
          </div>
        </div>
      </div>
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
          <button type="button" className="drawer-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

type ModelAuditLog = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  createdAt: string;
};

function ModelEditDrawer({
  model,
  fabrics,
  accessoriesInventory,
  openSelect,
  setOpenSelect,
  statusOptions,
  onAddStatus,
  onEditStatus,
  onDeleteStatus,
  roleOptions,
  onAddRole,
  onEditRole,
  onDeleteRole,
  onClose,
  onSaved,
}: {
  model: DesignModel;
  fabrics: Fabric[];
  accessoriesInventory: Accessory[];
  unit: 'meter' | 'yard';
  openSelect: string | null;
  setOpenSelect: (value: string | null) => void;
  statusOptions: SelectOption[];
  onAddStatus: (label: string) => string;
  onEditStatus: (value: string, label: string) => void;
  onDeleteStatus: (value: string) => void;
  roleOptions: SelectOption[];
  onAddRole: (label: string) => string;
  onEditRole: (value: string, label: string) => void;
  onDeleteRole: (value: string) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const drawerUnit = model.unit;
  const unitLabel = drawerUnit === 'yard' ? 'ياردة' : 'م';

  const [imageData, setImageData] = useState<string | null>(model.imageData ?? null);
  const decodedColors = decodeStoredColors(model.colors);
  const [status, setStatus] = useState(model.status);
  const [description, setDescription] = useState(model.description || '');
  const [selectedColors, setSelectedColors] = useState<string[]>(decodedColors.names);
  const [customColors, setCustomColors] = useState<ColorChip[]>(decodedColors.customColors);
  const [recipeRows, setRecipeRows] = useState<RecipeFabricRow[]>(
    model.fabrics.length
      ? model.fabrics.map((row) => ({ id: makeId('erow'), role: row.role, fabricId: row.fabricId, consumption: String(row.consumption) }))
      : [{ id: makeId('erow'), role: 'main', fabricId: fabrics[0]?.id || '', consumption: '0' }]
  );
  const [accessoryRows, setAccessoryRows] = useState<AccessoryRow[]>(
    model.accessories.map((row) => ({ id: makeId('eacc'), accessoryId: row.accessoryId, consumption: String(row.consumption) }))
  );
  // Tailoring & embroidery are read-only here — auto-derived from the production cycle.
  const [extraCost, setExtraCost] = useState(String(model.extraCost));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ModelAuditLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/fabric-management', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-audit', entityType: 'model', entityId: model.id }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (!cancelled) setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [model.id]);

  const fabricOptions = fabrics.map((fabric) => ({ value: fabric.id, label: `${fabric.name} — متاح ${formatNumber(fabric.stockLength)}م` }));
  const accessoryOptions = accessoriesInventory.map((accessory) => ({ value: accessory.id, label: `${accessory.name} — ${formatCurrency(accessory.unitPrice)}` }));

  const calculations = calculateModel({
    fabrics,
    accessoriesInventory,
    rows: recipeRows,
    accessories: accessoryRows,
    unit: drawerUnit,
    tailoringCost: String(model.tailoringCost),
    embroideryCost: String(model.embroideryCost),
    extraCost,
  });

  const dispatchSelect = (id: string, value: string) => {
    if (id === 'edit-status') setStatus(value);
    else if (id.startsWith('edit-fabric-')) {
      const rowId = id.replace('edit-fabric-', '');
      setRecipeRows((current) => current.map((row) => (row.id === rowId ? { ...row, fabricId: value } : row)));
    } else if (id.startsWith('edit-role-')) {
      const rowId = id.replace('edit-role-', '');
      setRecipeRows((current) => current.map((row) => (row.id === rowId ? { ...row, role: value } : row)));
    } else if (id.startsWith('edit-accessory-')) {
      const rowId = id.replace('edit-accessory-', '');
      setAccessoryRows((current) => current.map((row) => (row.id === rowId ? { ...row, accessoryId: value } : row)));
    }
    setOpenSelect(null);
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

  const toggleColor = (name: string) =>
    setSelectedColors((current) => (current.includes(name) ? current.filter((color) => color !== name) : [...current, name]));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/fabric-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-model',
          modelId: model.id,
          status,
          description,
          unit: drawerUnit,
          colors: encodeColors(selectedColors, customColors),
          imageData,
          recipe: recipeRows.map((row) => ({ role: row.role, fabricId: row.fabricId, consumption: row.consumption })),
          accessories: accessoryRows.filter((row) => row.accessoryId).map((row) => ({ accessoryId: row.accessoryId, consumption: row.consumption })),
          tailoringCost: model.tailoringCost,
          embroideryCost: model.embroideryCost,
          extraCost,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'فشل في الحفظ');
      await onSaved();
      onClose();
    } catch (saveError: any) {
      setError(saveError.message || 'فشل في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={`تعديل الموديل — ${model.sku}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'جاري الحفظ…' : 'حفظ التعديل'}
          </button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
        </>
      }
    >
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="sec-a-img" style={{ gridColumn: '1 / -1' }}>
          <label>صورة المنتج</label>
          <label className="imgbox sec-a-imgbox" style={{ cursor: 'pointer', overflow: 'hidden', padding: 0 }}>
            {imageData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageData} alt="صورة المنتج" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
        <DisplayField label="رقم الصنف (SKU)" value={model.sku} />
        <SelectBox
          id="edit-status"
          label="الحالة"
          options={statusOptions}
          value={status}
          openSelect={openSelect}
          setOpenSelect={setOpenSelect}
          onChange={dispatchSelect}
          allowCustom
          onCustomAdd={(_id, value) => {
            const resolved = onAddStatus(value);
            if (resolved) {
              setStatus(resolved);
              setOpenSelect(null);
            }
          }}
          addPlaceholder="حالة جديدة…"
          editableOptions
          onEditOption={(_id, value, label) => onEditStatus(value, label)}
          onDeleteOption={(_id, value) => onDeleteStatus(value)}
        />
        <ColorPicker
          id="edit-colors"
          openSelect={openSelect}
          setOpenSelect={setOpenSelect}
          selected={selectedColors}
          onToggle={toggleColor}
          customColors={customColors}
          onAddCustom={(name, value) => {
            setCustomColors((current) => (current.some((c) => c.name === name) ? current : [...current, { name, value, custom: true }]));
            setSelectedColors((current) => (current.includes(name) ? current : [...current, name]));
          }}
          onDeleteCustom={(name) => {
            setCustomColors((current) => current.filter((c) => c.name !== name));
            setSelectedColors((current) => current.filter((c) => c !== name));
          }}
        />
        <EditableField label="الوصف" value={description} onChange={setDescription} className="full" area />
      </div>

      <div className="rep-section-title">ب – الأقمشة والمستلزمات</div>

      <div className="rep-label">الأقمشة ({recipeRows.length})</div>
      {recipeRows.map((row, index) => (
        <div className={`rep-row ${index === 0 ? 'fabric-main' : 'acc'}`} key={row.id}>
          {index === 0 ? (
            <div className="iconbtn" title="قماش أساسي" style={{ fontSize: 18, color: 'var(--amber)', borderColor: 'var(--amber-soft)', background: 'var(--amber-soft)' }}>★</div>
          ) : (
            <SelectBox
              id={`edit-role-${row.id}`}
              options={roleOptions}
              value={row.role}
              openSelect={openSelect}
              setOpenSelect={setOpenSelect}
              onChange={dispatchSelect}
              allowCustom
              onCustomAdd={(id, value) => {
                const resolved = onAddRole(value);
                if (resolved) dispatchSelect(id, resolved);
              }}
              addPlaceholder="نوع جديد"
              editableOptions
              onEditOption={(_id, value, label) => onEditRole(value, label)}
              onDeleteOption={(_id, value) => onDeleteRole(value)}
            />
          )}
          <SelectBox
            id={`edit-fabric-${row.id}`}
            options={fabricOptions}
            value={row.fabricId}
            openSelect={openSelect}
            setOpenSelect={setOpenSelect}
            onChange={dispatchSelect}
            placeholder="اختر القماش"
          />
          <EditableField value={row.consumption} onChange={(consumption) => setRecipeRows((current) => current.map((item) => (item.id === row.id ? { ...item, consumption } : item)))} suffix={unitLabel} type="number" />
          {index === 0 ? (
            <button className="iconbtn add" type="button" title="إضافة قماش" onClick={() => setRecipeRows((current) => [...current, { id: makeId('erow'), role: 'lining', fabricId: fabrics[0]?.id || '', consumption: '0' }])}>
              <Plus />
            </button>
          ) : (
            <button className="iconbtn del" type="button" title="حذف" onClick={() => setRecipeRows((current) => current.filter((item) => item.id !== row.id))}>
              <Trash2 />
            </button>
          )}
        </div>
      ))}

      <div className="rep-label">الإكسسوارات والمستلزمات ({accessoryRows.length})</div>
      {accessoryRows.map((row, index) => {
        const accessory = accessoriesInventory.find((item) => item.id === row.accessoryId);
        const rowCost = toNumber(row.consumption) * (accessory?.unitPrice || 0);
        return (
          <div className="rep-row acc" key={row.id}>
            <SelectBox
              id={`edit-accessory-${row.id}`}
              options={accessoryOptions}
              value={row.accessoryId}
              openSelect={openSelect}
              setOpenSelect={setOpenSelect}
              onChange={dispatchSelect}
              placeholder="اختر الإكسسوار"
            />
            <EditableField value={row.consumption} onChange={(consumption) => setAccessoryRows((current) => current.map((item) => (item.id === row.id ? { ...item, consumption } : item)))} suffix="كمية" type="number" />
            {index === 0 ? (
              <button className="iconbtn add" type="button" title="إضافة إكسسوار" onClick={() => setAccessoryRows((current) => [...current, { id: makeId('eacc'), accessoryId: accessoriesInventory[0]?.id || '', consumption: '1' }])}>
                <Plus />
              </button>
            ) : (
              <button className="iconbtn del" type="button" title="حذف" onClick={() => setAccessoryRows((current) => current.filter((item) => item.id !== row.id))}>
                <Trash2 />
              </button>
            )}
            <span className="hint" style={{ gridColumn: '1 / -1', marginTop: -4 }}>{formatCurrency(rowCost)}</span>
          </div>
        );
      })}
      {!accessoryRows.length && (
        <button className="rep-add-btn" type="button" title="إضافة إكسسوار" onClick={() => setAccessoryRows((current) => [...current, { id: makeId('eacc'), accessoryId: accessoriesInventory[0]?.id || '', consumption: '1' }])}>
          <Plus /> إضافة إكسسوار
        </button>
      )}

      <div className="rep-section-title">د – التكاليف</div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <DisplayField label="تكلفة القماش" value={formatCurrency(calculations.fabricCost)} auto />
        <DisplayField label="تكلفة الإكسسوارات" value={formatCurrency(calculations.accessoriesCost)} auto />
        <DisplayField label="تكلفة الخياطة" value={formatCurrency(model.tailoringCost)} auto hint="تلقائي من دورة الإنتاج" />
        <DisplayField label="تكلفة التطريز" value={formatCurrency(model.embroideryCost)} auto hint="تلقائي من دورة الإنتاج" />
        <EditableField label="تكلفة إضافية" value={extraCost} onChange={setExtraCost} suffix="ر.س" type="number" />
        <DisplayField label="التكلفة الإجمالية" value={formatCurrency(calculations.totalCost)} auto />
      </div>

      {error && (
        <div className="note" style={{ marginTop: 14, background: '#fdecea', borderColor: '#f5c2c0', color: '#a3261f' }}>{error}</div>
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
            {!logs.length && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--muted-foreground)' }}>لا توجد تعديلات مسجّلة</td></tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td style={{ color: 'var(--muted-foreground)' }}>{new Date(log.createdAt).toLocaleDateString('ar')}</td>
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

function ModelTableRows({
  model,
  fabrics,
  statusOptions,
  isOpen,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: {
  model: DesignModel;
  fabrics: Fabric[];
  statusOptions: SelectOption[];
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const mainFabricRow = model.fabrics[0];
  const mainFabric = fabrics.find((fabric) => fabric.id === mainFabricRow?.fabricId);
  const statusLabel = getStatusLabel(model.status, statusOptions);
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
            {model.colors.map((raw) => {
              const { name, hex } = parseStoredColor(raw);
              return (
                <span
                  key={raw}
                  className="color-swatch"
                  style={{ background: colorMap.get(name) || hex || '#d4c4b0', width: 16, height: 16, marginInlineEnd: 0 }}
                  title={name}
                />
              );
            })}
          </span>
        </td>
        <td>{mainFabric?.name || '-'}</td>
        <td>{formatNumber(model.producibleCount)} قطع</td>
        <td>{formatCurrency(model.totalCost)}</td>
        <td><span className={`pill ${statusClass}`}>{statusLabel}</span></td>
        <td>
          <div className="td-actions" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="tbl-btn edit" disabled={disabled} onClick={onEdit}>تعديل</button>
            <button type="button" className="tbl-btn del" disabled={disabled} onClick={onDelete}>حذف</button>
          </div>
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
            <div className="recipe-blocks">
              <div className="recipe-block">
                <div className="recipe-head">
                  <span className="recipe-title">الأقمشة</span>
                  <span className="recipe-count">{model.fabrics.length}</span>
                </div>
                {model.fabrics.length ? (
                  model.fabrics.map((row) => {
                    const fabric = fabrics.find((item) => item.id === row.fabricId);
                    return (
                      <div className="recipe-row" key={row.id}>
                        <span className="recipe-name">
                          {fabric?.name || '-'}
                          <span className={`recipe-tag ${row.role === 'main' ? 'main' : ''}`}>{getRoleLabel(row.role)}</span>
                        </span>
                        <span className="recipe-val">{row.consumption} {unitLabel}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="recipe-empty">لا توجد أقمشة</div>
                )}
              </div>
              <div className="recipe-block">
                <div className="recipe-head">
                  <span className="recipe-title">المستلزمات</span>
                  <span className="recipe-count">{model.accessories.length}</span>
                </div>
                {model.accessories.length ? (
                  model.accessories.map((row) => (
                    <div className="recipe-row" key={row.id}>
                      <span className="recipe-name">{row.name}</span>
                      <span className="recipe-val">{row.consumption}</span>
                    </div>
                  ))
                ) : (
                  <div className="recipe-empty">لا توجد مستلزمات</div>
                )}
              </div>
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
