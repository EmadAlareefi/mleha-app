import { resolveSallaMerchantId } from '../app/api/salla/products/merchant';
import { listAllSallaProducts, type SallaProductSummary } from '../app/lib/salla-api';
import {
  isSizeGuideProductFamilySku,
  productMatchesSizeGuideRows,
  sizeGuideProductLinkData,
  type LinkableSallaProduct,
} from '../app/lib/salla-size-guide-links';
import { numericSkuKey, sizeGuideSkuKey } from '../app/lib/salla-size-guides';
import { prisma } from '../lib/prisma';

type Guide = Awaited<ReturnType<typeof loadGuides>>[number];

type PlannedUpdate = {
  guide: Guide;
  product: SallaProductSummary & { sku: string };
  skuChanged: boolean;
};

type PlannedProductLink = {
  guide: Guide;
  product: LinkableSallaProduct;
};

const APPLY = process.argv.includes('--apply');
const SAMPLE_LIMIT = 30;

function loadGuides() {
  return prisma.sallaSizeGuide.findMany({
    select: {
      id: true,
      sku: true,
      skuKey: true,
      productId: true,
      productName: true,
      productImageUrl: true,
      draftData: true,
      productLinks: { select: { productId: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  map.set(key, [...(map.get(key) || []), value]);
}

async function main() {
  const merchant = await resolveSallaMerchantId();
  if (!merchant.merchantId) throw new Error(merchant.error);

  const [guides, catalog] = await Promise.all([
    loadGuides(),
    listAllSallaProducts(merchant.merchantId),
  ]);
  if (!catalog.complete) {
    throw new Error(
      `Salla catalog is incomplete (${catalog.products.length}/${catalog.total}); refusing to repair`
    );
  }

  const products = catalog.products.filter(
    (product): product is SallaProductSummary & { sku: string } =>
      typeof product.sku === 'string' && Boolean(sizeGuideSkuKey(product.sku))
  );
  const productsByKey = new Map<string, Array<SallaProductSummary & { sku: string }>>();
  const productsByNumericKey = new Map<string, Array<SallaProductSummary & { sku: string }>>();
  products.forEach((product) => {
    pushToMap(productsByKey, sizeGuideSkuKey(product.sku), product);
    const numericKey = numericSkuKey(product.sku);
    if (numericKey) pushToMap(productsByNumericKey, numericKey, product);
  });

  const guidesBySkuKey = new Map(guides.map((guide) => [guide.skuKey, guide]));
  const guidesByProductId = new Map(
    guides.filter((guide) => guide.productId).map((guide) => [guide.productId as string, guide])
  );
  const linkedProductOwners = new Map(
    guides.flatMap((guide) => guide.productLinks.map((link) => [link.productId, guide] as const))
  );
  const planned: PlannedUpdate[] = [];
  const unmatched: Guide[] = [];
  const ambiguous: Array<{ guide: Guide; skus: string[] }> = [];
  const collisions: Array<{ guide: Guide; reason: string }> = [];
  let alreadyCurrent = 0;

  guides.forEach((guide) => {
    const numericKey = numericSkuKey(guide.sku);
    const numericCandidates = numericKey ? productsByNumericKey.get(numericKey) || [] : [];
    const exactCandidates = productsByKey.get(guide.skuKey) || [];
    const candidates = numericKey && numericCandidates.length > 1 && /^0/.test(guide.sku)
      ? exactCandidates
      : numericKey
        ? numericCandidates
        : exactCandidates;

    if (candidates.length === 0) {
      unmatched.push(guide);
      return;
    }
    if (candidates.length > 1) {
      ambiguous.push({ guide, skus: candidates.map((product) => product.sku) });
      return;
    }

    const product = candidates[0];
    const targetSkuKey = sizeGuideSkuKey(product.sku);
    const skuOwner = guidesBySkuKey.get(targetSkuKey);
    if (skuOwner && skuOwner.id !== guide.id) {
      collisions.push({ guide, reason: `SKU ${product.sku} belongs to guide ${skuOwner.id}` });
      return;
    }
    const productOwner = guidesByProductId.get(String(product.id));
    if (productOwner && productOwner.id !== guide.id) {
      collisions.push({ guide, reason: `product ${product.id} belongs to guide ${productOwner.id}` });
      return;
    }
    const linkedOwner = linkedProductOwners.get(String(product.id));
    if (linkedOwner && linkedOwner.id !== guide.id) {
      collisions.push({ guide, reason: `product ${product.id} is linked to guide ${linkedOwner.id}` });
      return;
    }

    const isCurrent =
      guide.sku === product.sku &&
      guide.skuKey === targetSkuKey &&
      guide.productId === String(product.id) &&
      guide.productName === product.name &&
      guide.productImageUrl === product.imageUrl;
    if (isCurrent) {
      alreadyCurrent += 1;
      return;
    }
    planned.push({
      guide,
      product,
      skuChanged: guide.sku !== product.sku || guide.skuKey !== targetSkuKey,
    });
  });

  const familyLinks: PlannedProductLink[] = [];
  const familyPrimaryProducts = new Map<string, LinkableSallaProduct>();
  const familySizeMismatches: Array<{ guide: Guide; sku: string }> = [];
  guides.forEach((guide) => {
    const candidates = products
      .filter((product) => isSizeGuideProductFamilySku(guide.sku, product.sku))
      .sort((left, right) => left.sku.localeCompare(right.sku, 'en'));
    candidates.forEach((product) => {
      if (!productMatchesSizeGuideRows(product, guide.draftData)) {
        familySizeMismatches.push({ guide, sku: product.sku });
        return;
      }
      const exactGuide = guidesBySkuKey.get(sizeGuideSkuKey(product.sku));
      const legacyOwner = guidesByProductId.get(String(product.id));
      const linkedOwner = linkedProductOwners.get(String(product.id));
      const owner = exactGuide || legacyOwner || linkedOwner;
      if (owner && owner.id !== guide.id) {
        collisions.push({ guide, reason: `family product ${product.sku} belongs to guide ${owner.id}` });
        return;
      }
      if (linkedOwner?.id === guide.id) return;
      familyLinks.push({ guide, product });
      if (!guide.productId && !familyPrimaryProducts.has(guide.id)) {
        familyPrimaryProducts.set(guide.id, product);
      }
    });
  });

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    catalogProducts: catalog.products.length,
    guides: guides.length,
    planned: planned.length,
    skuCorrections: planned.filter((item) => item.skuChanged).length,
    productLinks: planned.filter((item) => item.guide.productId !== String(item.product.id)).length,
    familyLinks: familyLinks.length,
    familyGuides: new Set(familyLinks.map((item) => item.guide.id)).size,
    familyPrimaryProducts: familyPrimaryProducts.size,
    familySizeMismatches: familySizeMismatches.length,
    alreadyCurrent,
    unmatched: unmatched.length,
    ambiguous: ambiguous.length,
    collisions: collisions.length,
  };

  console.log(JSON.stringify({
    summary,
    corrections: planned.filter((item) => item.skuChanged).slice(0, SAMPLE_LIMIT).map((item) => ({
      from: item.guide.sku,
      to: item.product.sku,
      productId: item.product.id,
      productName: item.product.name,
    })),
    ambiguous: ambiguous.slice(0, SAMPLE_LIMIT).map((item) => ({
      sku: item.guide.sku,
      sallaSkus: item.skus,
    })),
    collisions: collisions.slice(0, SAMPLE_LIMIT).map((item) => ({
      sku: item.guide.sku,
      reason: item.reason,
    })),
    unmatched: unmatched.slice(0, SAMPLE_LIMIT).map((guide) => guide.sku),
    familyLinks: familyLinks.slice(0, SAMPLE_LIMIT).map((item) => ({
      guideSku: item.guide.sku,
      productId: item.product.id,
      productSku: item.product.sku,
    })),
    familySizeMismatches: familySizeMismatches.slice(0, SAMPLE_LIMIT).map((item) => ({
      guideSku: item.guide.sku,
      productSku: item.sku,
    })),
  }, null, 2));

  if (!APPLY || (planned.length === 0 && familyLinks.length === 0)) return;

  for (let start = 0; start < planned.length; start += 100) {
    const batch = planned.slice(start, start + 100);
    await prisma.$transaction(batch.map(({ guide, product }) => {
      const productLink = sizeGuideProductLinkData(product);
      return prisma.sallaSizeGuide.update({
        where: { id: guide.id },
        data: {
          sku: product.sku,
          skuKey: sizeGuideSkuKey(product.sku),
          productId: String(product.id),
          productName: product.name,
          productImageUrl: product.imageUrl,
          productLinks: {
            upsert: {
              where: { productId: String(product.id) },
              create: productLink,
              update: productLink,
            },
          },
          updatedById: null,
          updatedByName: 'Salla SKU repair',
          updatedByUsername: 'system',
        },
      });
    }));
  }

  for (let start = 0; start < familyLinks.length; start += 100) {
    const batch = familyLinks.slice(start, start + 100);
    await prisma.$transaction(batch.map(({ guide, product }) => {
      const link = sizeGuideProductLinkData(product);
      return prisma.sallaSizeGuideProductLink.upsert({
        where: { productId: link.productId },
        create: { ...link, guideId: guide.id },
        update: link,
      });
    }));
  }

  for (const [guideId, product] of familyPrimaryProducts) {
    await prisma.sallaSizeGuide.update({
      where: { id: guideId },
      data: {
        productId: String(product.id),
        productName: product.name,
        productImageUrl: product.imageUrl || null,
        updatedById: null,
        updatedByName: 'Salla family link repair',
        updatedByUsername: 'system',
      },
    });
  }

  console.log(JSON.stringify({
    applied: planned.length,
    skuCorrections: summary.skuCorrections,
    familyLinks: familyLinks.length,
    familyPrimaryProducts: familyPrimaryProducts.size,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
