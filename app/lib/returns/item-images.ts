export type ImageLike =
  | string
  | {
      url?: string;
      image?: string;
      src?: string;
    };

export type OrderItemImageSource = {
  id?: string | number | null;
  name?: string | null;
  sku?: string | null;
  product?: {
    id?: string | number | null;
    name?: string | null;
    sku?: string | null;
    thumbnail?: string | null;
    images?: ImageLike[];
  };
  product_id?: string | number | null;
  productId?: string | number | null;
  productSku?: string | null;
  variant?: {
    id?: string | number | null;
    name?: string | null;
  };
  variant_id?: string | number | null;
  variantId?: string | number | null;
  images?: ImageLike[];
  files?: ImageLike[];
  codes?: ImageLike[];
  thumbnail?: string | null;
  image?: string | null;
  featured_image?: string | null;
  media?: ImageLike[];
};

export type ReturnItemImageSource = {
  productId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  variantId?: string | null;
  variantName?: string | null;
};

const stringsEqual = (a?: string | number | null, b?: string | number | null) => {
  if (a === undefined || a === null || b === undefined || b === null) {
    return false;
  }
  return String(a).trim() === String(b).trim();
};

export const extractOrderItemImage = (
  item: OrderItemImageSource | undefined
): string | null => {
  if (!item) {
    return null;
  }

  const directCandidates = [
    item.product?.thumbnail,
    item.thumbnail,
    item.image,
    item.featured_image,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  const collections = [
    item.images,
    item.product?.images,
    item.files,
    item.codes,
    item.media,
  ];

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue;
    }
    for (const entry of collection) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const maybe =
          (entry as any).url ||
          (entry as any).image ||
          (entry as any).src;
        if (typeof maybe === 'string' && maybe.trim()) {
          return maybe;
        }
      }
    }
  }

  return null;
};

export const resolveReturnItemImage = (
  item: ReturnItemImageSource,
  orderItems?: OrderItemImageSource[] | null
): string | null => {
  if (!orderItems || orderItems.length === 0) {
    return null;
  }

  const productId = item.productId ? String(item.productId) : null;
  const variantId = item.variantId ? String(item.variantId) : null;

  const productMatch = orderItems.find((orderItem) => {
    const orderProductId =
      orderItem.product?.id ??
      orderItem.product_id ??
      orderItem.productId ??
      orderItem.id;
    if (!productId || !orderProductId) {
      return false;
    }
    if (String(orderProductId) !== productId) {
      return false;
    }
    if (!variantId) {
      return true;
    }
    const orderVariantId =
      orderItem.variant?.id ??
      orderItem.variant_id ??
      orderItem.variantId;
    return orderVariantId ? String(orderVariantId) === variantId : false;
  });

  if (productMatch) {
    return extractOrderItemImage(productMatch);
  }

  if (item.productSku) {
    const skuMatch = orderItems.find(
      (orderItem) =>
        stringsEqual(orderItem.product?.sku, item.productSku) ||
        stringsEqual(orderItem.sku, item.productSku)
    );
    if (skuMatch) {
      return extractOrderItemImage(skuMatch);
    }
  }

  const nameMatch = orderItems.find(
    (orderItem) =>
      stringsEqual(orderItem.product?.name, item.productName) ||
      stringsEqual(orderItem.name, item.productName)
  );

  if (nameMatch) {
    return extractOrderItemImage(nameMatch);
  }

  return null;
};
