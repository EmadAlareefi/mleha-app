import type { SallaProductSummary } from './salla-api';
import { parseSizeGuideDocument, sizeGuideSkuKey } from './salla-size-guides';
import {
  extractSallaSizeOptions,
  normalizeSizeLabel,
  type SizeGuideSallaProduct,
} from './salla-size-guide-products';

export type LinkableSallaProduct = {
  id: string | number;
  sku: string;
  name: string;
  imageUrl?: string | null;
};

function normalizedSizeLabel(value: string) {
  return normalizeSizeLabel(value);
}

export function sharedSizeGuideFamilySku(skus: string[]): string | null {
  if (skus.length < 2) return null;
  const parsed = skus.map((value) => {
    const sku = value.trim();
    const separator = sku.lastIndexOf('-');
    if (separator <= 0 || separator === sku.length - 1) return null;
    return { base: sku.slice(0, separator), key: sku.slice(0, separator).toLocaleUpperCase('en-US') };
  });
  if (!parsed.length || parsed.some((entry) => !entry)) return null;
  const first = parsed[0]!;
  return parsed.every((entry) => entry?.key === first.key) ? first.base : null;
}

export function sizeGuideProductsShareSizes(
  primary: SizeGuideSallaProduct,
  candidate: SizeGuideSallaProduct
): boolean {
  const primaryLabels = primary.sizeOption.values.map((value) => normalizeSizeLabel(value.label));
  const candidateLabels = candidate.sizeOption.values.map((value) => normalizeSizeLabel(value.label));
  return primaryLabels.length === candidateLabels.length &&
    primaryLabels.every((label, index) => label === candidateLabels[index]);
}

export function isSizeGuideProductFamilySku(guideSku: string, productSku: string): boolean {
  const guide = guideSku.trim().toLocaleUpperCase('en-US');
  const product = productSku.trim().toLocaleUpperCase('en-US');
  return Boolean(guide && product.startsWith(`${guide}-`) && product.length > guide.length + 1);
}

export function productMatchesSizeGuideRows(product: SallaProductSummary, document: unknown): boolean {
  const rows = parseSizeGuideDocument(document).rows;
  const resolution = extractSallaSizeOptions(product.options);
  if (!resolution.selected) return false;
  const guideLabels = rows.map((row) => normalizedSizeLabel(row.size));
  const productLabels = resolution.selected.values.map((value) => normalizedSizeLabel(value.label));
  return guideLabels.length === productLabels.length &&
    guideLabels.every((label, index) => label === productLabels[index]);
}

export function sizeGuideProductLinkData(product: LinkableSallaProduct) {
  return {
    productId: String(product.id),
    sku: product.sku.trim(),
    skuKey: sizeGuideSkuKey(product.sku),
    productName: product.name,
    productImageUrl: product.imageUrl || null,
  };
}
