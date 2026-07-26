import type {
  SallaProductSummary,
  SallaProductVariation,
} from '@/app/lib/salla-api';

export type PendingVariantEntry = {
  key: string;
  variantId: string;
  sku: string;
  skuTokens: Set<string>;
  name: string;
};

export type PendingVariantEntrySet = {
  keys: string[];
  entries: PendingVariantEntry[];
};

export function normalizeStockSku(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input.trim().toUpperCase();
}

export function resolveProductVariations(
  product: SallaProductSummary,
  loadedVariations?: SallaProductVariation[]
): SallaProductVariation[] {
  if (loadedVariations && loadedVariations.length > 0) {
    return loadedVariations;
  }

  if (product.variations && product.variations.length > 0) {
    return product.variations;
  }

  return [
    {
      id: product.id,
      name: product.name,
      sku: product.sku,
      availableQuantity: product.availableQuantity ?? null,
      barcode: undefined,
    },
  ];
}

export function getPendingVariantKey(
  productId: number | string,
  variation: SallaProductVariation
): string {
  return `${productId}:${String(variation.id ?? variation.sku ?? variation.name)}`;
}

export function collectPendingVariantEntries(
  products: SallaProductSummary[],
  loadedVariations: Record<number, SallaProductVariation[]>
): PendingVariantEntrySet {
  const entries: PendingVariantEntry[] = [];

  products.forEach((product) => {
    const parentSku = normalizeStockSku(product.sku);
    const variations = resolveProductVariations(product, loadedVariations[product.id]);

    variations.forEach((variation) => {
      const sku = normalizeStockSku(variation.sku) || parentSku;
      if (!sku) {
        return;
      }

      entries.push({
        key: getPendingVariantKey(product.id, variation),
        variantId: String(variation.id),
        sku,
        skuTokens: new Set(generateSkuVariants(sku)),
        name: normalizeVariantLabel(variation.name),
      });
    });
  });

  return {
    keys: entries.map((entry) => entry.key),
    entries,
  };
}

export function findPendingVariantKey(
  item: Record<string, any>,
  entries: PendingVariantEntry[]
): string | null {
  const itemVariantIds = extractItemVariantIds(item);

  for (const variantId of itemVariantIds) {
    const exactVariant = entries.find((entry) => entry.variantId === variantId);
    if (exactVariant) {
      return exactVariant.key;
    }
  }

  const itemSku = normalizeStockSku(
    item?.sku ?? item?.product?.sku ?? item?.variant?.sku ?? item?.product_sku
  );
  if (!itemSku) {
    return null;
  }

  let bestScore = 0;
  let skuMatches: PendingVariantEntry[] = [];

  entries.forEach((entry) => {
    const score = getSkuMatchScore(itemSku, entry);
    if (score > bestScore) {
      bestScore = score;
      skuMatches = [entry];
    } else if (score > 0 && score === bestScore) {
      skuMatches.push(entry);
    }
  });

  if (skuMatches.length === 1) {
    return skuMatches[0].key;
  }
  if (skuMatches.length === 0) {
    return null;
  }

  const optionLabels = extractItemOptionLabels(item);
  const optionMatch = skuMatches.filter(
    (entry) => entry.name && optionLabels.has(entry.name)
  );

  return optionMatch.length === 1 ? optionMatch[0].key : null;
}

function extractItemVariantIds(item: Record<string, any>): string[] {
  const candidates = [
    item?.product_sku_id,
    item?.productSkuId,
    item?.variant_id,
    item?.variantId,
    item?.variant?.id,
  ];

  return candidates
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .map((value) => String(value).trim());
}

function extractItemOptionLabels(item: Record<string, any>): Set<string> {
  const labels = new Set<string>();
  const options = Array.isArray(item?.options) ? item.options : [];

  options.forEach((option: any) => {
    const candidates = [
      option?.value?.name,
      option?.value?.option_value,
      option?.value?.value,
      typeof option?.value === 'string' ? option.value : null,
    ];

    candidates.forEach((candidate) => {
      const normalized = normalizeVariantLabel(candidate);
      if (normalized) {
        labels.add(normalized);
      }
    });
  });

  const variantName = normalizeVariantLabel(item?.variant?.name);
  if (variantName) {
    labels.add(variantName);
  }

  return labels;
}

function normalizeVariantLabel(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toUpperCase()
    : '';
}

function generateSkuVariants(value: string): string[] {
  const variants = new Set<string>([value]);

  value
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .forEach((segment) => variants.add(segment));

  const withoutTrailingLetters = value.replace(/[A-Z]+$/g, '');
  if (withoutTrailingLetters && withoutTrailingLetters !== value) {
    variants.add(withoutTrailingLetters);
  }

  const withoutTrailingDigits = value.replace(/\d+$/g, '');
  if (withoutTrailingDigits && withoutTrailingDigits !== value) {
    variants.add(withoutTrailingDigits);
  }

  return Array.from(variants).filter((sku) => sku.length >= 3);
}

function getSkuMatchScore(candidate: string, entry: PendingVariantEntry): number {
  if (entry.sku === candidate) {
    return 10_000 + candidate.length;
  }

  if (candidate.includes(entry.sku) || entry.sku.includes(candidate)) {
    return 1_000 + Math.min(entry.sku.length, candidate.length);
  }

  let bestTokenScore = 0;
  entry.skuTokens.forEach((token) => {
    if (token === candidate || candidate.includes(token) || token.includes(candidate)) {
      bestTokenScore = Math.max(bestTokenScore, token.length);
    }
  });

  return bestTokenScore;
}
