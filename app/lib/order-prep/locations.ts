import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { LocationRecord } from './payload';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Shelf-location rows that can match the given items: exact SKU, a location SKU
 * the item SKU starts with (locations are kept per parent SKU, 4+ chars), or the
 * product id. matchLocation() in payload.ts picks the best one per item. The
 * table is small (~1.3k rows), so this is one cheap query.
 */
export async function loadLocations(
  skus: Array<string | null | undefined>,
  productIds: Array<string | null | undefined>,
  db: Db = prisma,
): Promise<LocationRecord[]> {
  const skuList = [...new Set(skus.map((sku) => sku?.trim()).filter((sku): sku is string => Boolean(sku)))];
  const productList = [...new Set(productIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  if (skuList.length === 0 && productList.length === 0) return [];
  return db.$queryRaw<LocationRecord[]>`
    SELECT l."sku", l."productId", l."location", l."notes"
    FROM "SallaProductLocation" l
    WHERE EXISTS (
        SELECT 1 FROM unnest(${skuList}::text[]) AS i(sku)
        WHERE upper(i.sku) = upper(l."sku")
           OR (length(l."sku") >= 4 AND left(upper(i.sku), length(l."sku")) = upper(l."sku"))
      )
      OR l."productId" = ANY(${productList}::text[])
  `;
}
