export const EVENING_DRESS_CATEGORY = 'فساتين سهرة';
export const EVENING_DRESS_CATEGORY_ALIASES = new Set(['فساتين سهرة', 'فساتين سهرات']);

export const DISCOUNTED_CATEGORY_ALIASES = new Set([
  'فساتين بـ 195 ريال',
  'فستانين بـ 95 ريال',
  'فستان بـ 95 ريال',
]);

export const normalizeCategoryName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
};

export const isEveningDressCategory = (value: unknown): boolean => {
  const categoryName = normalizeCategoryName(value);
  return Boolean(categoryName && EVENING_DRESS_CATEGORY_ALIASES.has(categoryName));
};

export const isDiscountedCategory = (value: unknown): boolean => {
  const categoryName = normalizeCategoryName(value);
  return Boolean(categoryName && DISCOUNTED_CATEGORY_ALIASES.has(categoryName));
};
