import type { SallaProductSummary } from './salla-api';
import { parseSizeGuideDocument, sizeGuideSkuKey } from './salla-size-guides';
import { extractSallaSizeOptions } from './salla-size-guide-products';

export type LinkableSallaProduct = {
  id: string | number;
  sku: string;
  name: string;
  imageUrl?: string | null;
};

function normalizedSizeLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
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
