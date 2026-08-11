import { getSallaProductBySku, getSallaProductDetails } from './salla-api';
import {
  compareSizeGuideRowsToSalla,
  extractSallaSizeOptions,
  reconcileSizeGuideRows,
  type SizeGuideSallaProduct,
  toSizeGuideSallaProduct,
} from './salla-size-guide-products';
import {
  parseSizeGuideDocument,
  validateSizeGuideDocument,
  type SizeGuideDocument,
  type ValidatedSizeGuide,
} from './salla-size-guides';

export class SallaSizeGuideError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export async function loadSallaSizeGuideProduct(
  merchantId: string,
  identifier: { productId?: string | number; sku?: string; optionId?: string | null }
): Promise<SizeGuideSallaProduct> {
  let productId = identifier.productId;
  if (!productId && identifier.sku) {
    const match = await getSallaProductBySku(merchantId, identifier.sku);
    if (!match) throw new SallaSizeGuideError('لم يتم العثور على منتج مطابق في سلة', 'product_not_found');
    productId = match.id;
  }
  if (!productId) throw new SallaSizeGuideError('رقم منتج سلة مطلوب', 'product_id_required');

  const product = await getSallaProductDetails(merchantId, productId);
  const resolution = extractSallaSizeOptions(product.options);
  if (resolution.matches.length > 1 && !identifier.optionId) {
    throw new SallaSizeGuideError(
      'يوجد أكثر من خيار مقاس في المنتج؛ اختر الخيار المطلوب',
      'ambiguous_size_option',
      { sizeOptions: resolution.matches }
    );
  }

  try {
    return toSizeGuideSallaProduct(product, identifier.optionId);
  } catch (error) {
    throw new SallaSizeGuideError(
      error instanceof Error ? error.message : 'تعذر قراءة مقاسات المنتج من سلة',
      'invalid_salla_product',
      { sizeOptions: resolution.matches }
    );
  }
}

export function validateDocumentAgainstSallaProduct(
  value: unknown,
  product: SizeGuideSallaProduct
): ValidatedSizeGuide {
  const document = parseSizeGuideDocument(value);
  const labels = product.sizeOption.values.map((entry) => entry.label);
  const comparison = compareSizeGuideRowsToSalla(document.rows, labels);
  if (comparison.missing.length || comparison.extra.length) {
    throw new SallaSizeGuideError(
      'تغيرت مقاسات المنتج في سلة؛ حدّث الدليل قبل الحفظ',
      'salla_sizes_changed',
      comparison
    );
  }

  const reconciled = reconcileSizeGuideRows(document.rows, labels);
  const normalized: SizeGuideDocument = {
    unit: 'in',
    twoPiece: document.twoPiece,
    sallaSizeOptionId: product.sizeOption.id,
    rows: reconciled.rows,
  };
  return validateSizeGuideDocument(normalized);
}
