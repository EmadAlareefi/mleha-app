export const PRODUCT_REVIEW_NAMES = [
  'ريم',
  'نورة',
  'سارة',
  'جواهر',
  'عبير',
  'مشاعل',
  'شهد',
  'هدى',
  'منال',
  'العنود',
  'لينا',
  'دانة',
  'أروى',
  'غادة',
  'لطيفة',
  'أمل',
  'هيا',
  'رغد',
  'لمى',
  'مها',
] as const;

export const PRODUCT_REVIEW_CITIES = [
  'الرياض',
  'جدة',
  'مكة',
  'المدينة',
  'الدمام',
  'الخبر',
  'الطائف',
  'أبها',
  'تبوك',
  'القصيم',
  'حائل',
  'جازان',
  'ينبع',
  'الأحساء',
] as const;

export const PRODUCT_REVIEW_PHRASES = [
  'وصلني أجمل من الصور، القماش مرتب والتفاصيل واضحة وحلوة.',
  'المقاس مضبوط والخامة جميلة، جدًا سعيدة بالطلب.',
  'الفستان أنيق ولبسته في مناسبة وكل من شافه سألني عنه.',
  'التفاصيل على الطبيعة أجمل، والتغليف كان مرتب جدًا.',
  'أول تجربة لي مع المتجر وبالتأكيد لن تكون الأخيرة.',
  'الخامة مريحة والقصة جميلة على الجسم، أنصح فيه.',
  'نفس الوصف والصور تمامًا، ووصل بحالة ممتازة.',
  'اللون جميل جدًا والمقاس جاء مناسب من أول مرة.',
  'الجودة ممتازة بالنسبة للسعر والتوصيل كان سريعًا.',
  'قطعة فخمة ومرتبة، مناسبة للمناسبات والسهرات.',
  'طلبته وأنا مترددة لكن النتيجة كانت أجمل مما توقعت.',
  'القصة أنيقة والخياطة نظيفة، أعجبني جدًا.',
  'لبسته أكثر من مرة وما زال محافظًا على شكله.',
  'أحببت نعومة القماش وطريقة وقوف الفستان على الجسم.',
  'التعامل ممتاز والقطعة وصلت مثل ما تمنيت.',
  'جميل وناعم بدون مبالغة، بالضبط مثل الصور.',
  'التطريز مرتب وما فيه أي عيوب، شكرًا مليحة.',
  'مناسب جدًا للمناسبة والخامة أفخم من المتوقع.',
  'أعجبني اللون والتصميم، والمقاسات موضحة بشكل دقيق.',
  'قطعة مميزة وجودتها واضحة من أول لبسة.',
] as const;

export type ReviewPresetField = 'reviewerName' | 'reviewerCity' | 'body';

export type ReviewDraftProduct = {
  id: string;
  name: string;
  sku?: string | null;
  imageUrl?: string | null;
};

export type ProductReviewDraft = {
  draftId: string;
  productId: string;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  reviewerName: string;
  reviewerCity: string;
  body: string;
  reviewImageData: string | null;
  rating: number;
  isVerifiedPurchase: boolean;
};

function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.min(values.length - 1, Math.floor(random() * values.length));
  return values[Math.max(0, index)];
}

export function randomReviewPreset(field: ReviewPresetField, random = Math.random): string {
  if (field === 'reviewerName') return pick(PRODUCT_REVIEW_NAMES, random);
  if (field === 'reviewerCity') return pick(PRODUCT_REVIEW_CITIES, random);
  return pick(PRODUCT_REVIEW_PHRASES, random);
}

export function generateProductReviewDrafts(
  products: ReviewDraftProduct[],
  countPerProduct: number,
  random = Math.random
): ProductReviewDraft[] {
  const count = Math.min(10, Math.max(1, Math.floor(countPerProduct)));
  let sequence = 0;

  return products.flatMap((product) => {
    const phraseOffset = Math.floor(random() * PRODUCT_REVIEW_PHRASES.length);
    return Array.from({ length: count }, (_, index) => {
      sequence += 1;
      return {
        draftId: `review-${Date.now()}-${sequence}-${Math.floor(random() * 1_000_000)}`,
        productId: product.id,
        productName: product.name,
        productSku: product.sku ?? null,
        productImageUrl: product.imageUrl ?? null,
        reviewerName: randomReviewPreset('reviewerName', random),
        reviewerCity: randomReviewPreset('reviewerCity', random),
        body: PRODUCT_REVIEW_PHRASES[(phraseOffset + index) % PRODUCT_REVIEW_PHRASES.length],
        reviewImageData: null,
        rating: 5,
        isVerifiedPurchase: false,
      };
    });
  });
}
