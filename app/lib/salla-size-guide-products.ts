import type { SallaProductOption, SallaProductSummary } from './salla-api';
import type { SizeGuideRow } from './salla-size-guides';

export const SIZE_OPTION_ALIASES = ['المقاس', 'مقاس', 'size', 'sizes'] as const;

export type NormalizedSallaSizeOption = {
  id: string;
  name: string;
  values: Array<{ id: string; label: string; isOutOfStock: boolean }>;
};

export type SizeOptionResolution = {
  matches: NormalizedSallaSizeOption[];
  selected: NormalizedSallaSizeOption | null;
  error: 'missing' | 'ambiguous' | 'empty' | null;
};

export type SizeGuideSallaProduct = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  sizeOption: NormalizedSallaSizeOption;
};

export function normalizeSizeLabel(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

function normalizeOptionName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\s_-]+/g, '');
}

function optionNames(option: SallaProductOption): string[] {
  const names = [option.name];
  Object.values(option.translations || {}).forEach((translation) => {
    if (translation?.option_name) names.push(translation.option_name);
    if (translation?.name) names.push(translation.name);
  });
  return names;
}

export function extractSallaSizeOptions(options: SallaProductOption[] | undefined): SizeOptionResolution {
  const aliases = new Set(SIZE_OPTION_ALIASES.map(normalizeOptionName));
  const matches = (options || [])
    .filter((option) => optionNames(option).some((name) => aliases.has(normalizeOptionName(name))))
    .map((option) => {
      const seen = new Set<string>();
      const values = option.values.flatMap((value) => {
        const label = value.name.trim();
        const key = normalizeSizeLabel(label);
        if (!key || seen.has(key)) return [];
        seen.add(key);
        return [{ id: String(value.id), label, isOutOfStock: value.isOutOfStock === true }];
      });
      return { id: String(option.id), name: option.name, values };
    });

  if (matches.length === 0) return { matches, selected: null, error: 'missing' };
  if (matches.length > 1) return { matches, selected: null, error: 'ambiguous' };
  if (matches[0].values.length === 0) return { matches, selected: null, error: 'empty' };
  return { matches, selected: matches[0], error: null };
}

export function toSizeGuideSallaProduct(
  product: SallaProductSummary,
  optionId?: string | null
): SizeGuideSallaProduct {
  const sku = product.sku?.trim() || '';
  if (!sku) throw new Error('منتج سلة لا يحتوي على SKU');

  const resolution = extractSallaSizeOptions(product.options);
  const selected = optionId
    ? resolution.matches.find((option) => option.id === optionId) || null
    : resolution.selected;
  if (!selected) {
    if (resolution.error === 'ambiguous') throw new Error('يوجد أكثر من خيار مقاس في المنتج؛ اختر الخيار المطلوب');
    if (resolution.error === 'empty') throw new Error('خيار المقاس في سلة لا يحتوي على قيم');
    throw new Error('لم يتم العثور على خيار المقاس في منتج سلة');
  }

  return {
    id: String(product.id),
    sku,
    name: product.name,
    imageUrl: product.imageUrl || null,
    sizeOption: selected,
  };
}

function blankRow(size: string): SizeGuideRow {
  return {
    size,
    CHEST: '',
    WAIST: '',
    HIP: '',
    SHOULDER: '',
    LENGTH: '',
    SLEEVE: '',
    BLOUSE_LEN: '',
    SKIRT_LEN: '',
  };
}

export function reconcileSizeGuideRows(currentRows: SizeGuideRow[], sizeLabels: string[]) {
  const currentBySize = new Map<string, SizeGuideRow>();
  currentRows.forEach((row) => {
    const key = normalizeSizeLabel(row.size);
    if (key && !currentBySize.has(key)) currentBySize.set(key, row);
  });

  const nextKeys = new Set(sizeLabels.map(normalizeSizeLabel));
  const rows = sizeLabels.map((label) => {
    const current = currentBySize.get(normalizeSizeLabel(label));
    return current ? { ...current, size: label } : blankRow(label);
  });
  const added = rows.filter((row) => !currentBySize.has(normalizeSizeLabel(row.size))).map((row) => row.size);
  const removed = currentRows.filter((row) => !nextKeys.has(normalizeSizeLabel(row.size)));

  return { rows, added, removed };
}

export function compareSizeGuideRowsToSalla(currentRows: SizeGuideRow[], sizeLabels: string[]) {
  const currentKeys = new Set(currentRows.map((row) => normalizeSizeLabel(row.size)).filter(Boolean));
  const sallaKeys = new Set(sizeLabels.map(normalizeSizeLabel).filter(Boolean));
  return {
    missing: sizeLabels.filter((label) => !currentKeys.has(normalizeSizeLabel(label))),
    extra: currentRows.map((row) => row.size).filter((label) => !sallaKeys.has(normalizeSizeLabel(label))),
  };
}
