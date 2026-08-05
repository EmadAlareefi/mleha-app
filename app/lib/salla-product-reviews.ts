export const PRODUCT_REVIEW_SERVICE_KEY = 'salla-product-reviews' as const;
export const MAX_PRODUCT_REVIEWS_PER_BATCH = 100;

const LIMITS = {
  productId: 32,
  productName: 250,
  sku: 120,
  imageUrl: 500,
  reviewerName: 80,
  reviewerCity: 100,
  body: 1000,
} as const;

export type ProductReviewCreateInput = {
  productId: string;
  productName: string;
  productSku: string | null;
  productImageUrl: string | null;
  reviewerName: string;
  reviewerCity: string;
  body: string;
  rating: number;
};

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} مطلوب`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new Error(`${label} يتجاوز الحد المسموح`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} غير صالح`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`${label} يتجاوز الحد المسموح`);
  return text;
}

export function parseProductId(value: unknown): string {
  const productId = requiredText(value, 'رقم المنتج', LIMITS.productId);
  if (!/^\d+$/.test(productId)) throw new Error('رقم المنتج غير صحيح');
  return productId;
}

export function parseRating(value: unknown): number {
  const rating = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('التقييم يجب أن يكون بين 1 و5');
  }
  return rating;
}

export function parseProductReviewCreate(value: unknown): ProductReviewCreateInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات التقييم غير صالحة');
  const input = value as Record<string, unknown>;
  const imageUrl = optionalText(input.productImageUrl, 'رابط صورة المنتج', LIMITS.imageUrl);
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) throw new Error('رابط صورة المنتج غير صالح');

  return {
    productId: parseProductId(input.productId),
    productName: requiredText(input.productName, 'اسم المنتج', LIMITS.productName),
    productSku: optionalText(input.productSku, 'SKU', LIMITS.sku),
    productImageUrl: imageUrl,
    reviewerName: requiredText(input.reviewerName, 'اسم المقيّمة', LIMITS.reviewerName),
    reviewerCity: requiredText(input.reviewerCity, 'المدينة', LIMITS.reviewerCity),
    body: requiredText(input.body, 'نص التقييم', LIMITS.body),
    rating: parseRating(input.rating),
  };
}

export function parseReviewText(value: unknown, field: 'reviewerName' | 'reviewerCity' | 'body') {
  const config = {
    reviewerName: ['اسم المقيّمة', LIMITS.reviewerName],
    reviewerCity: ['المدينة', LIMITS.reviewerCity],
    body: ['نص التقييم', LIMITS.body],
  }[field] as [string, number];
  return requiredText(value, config[0], config[1]);
}
