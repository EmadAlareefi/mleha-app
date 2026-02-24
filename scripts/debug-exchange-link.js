#!/usr/bin/env node

/**
 * Replay the exchange-linking logic for a webhook payload.
 * Usage examples:
 *   DATABASE_URL=... node scripts/debug-exchange-link.js --file ./payload.json [merchantIdOverride] [orderIdOverride]
 *   DATABASE_URL=... node scripts/debug-exchange-link.js --event <webhookEventId>
 *   DATABASE_URL=... node scripts/debug-exchange-link.js --order <orderId> [merchantIdOverride]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COUPON_KEYS = [
  'coupon',
  'coupon_code',
  'couponCode',
  'discount_code',
  'discountCode',
  'promotion_code',
  'promotionCode',
  'applied_coupon',
  'appliedCoupon',
];

const COUPON_COLLECTION_KEYS = [
  'coupons',
  'coupon_codes',
  'couponCodes',
  'applied_coupons',
  'appliedCoupons',
  'discounts',
  'discount_codes',
  'discountCodes',
  'promotions',
  'promotion_codes',
  'promotionCodes',
];

const COUPON_OBJECT_KEYS = ['code', 'coupon', 'coupon_code', 'name', 'title', 'value'];

function normalizeString(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function normalizeCoupon(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function extractAppliedCouponCodes(order) {
  const codes = new Set();

  const push = (value) => {
    const normalized = normalizeCoupon(value);
    if (normalized) {
      codes.add(normalized);
    }
  };

  COUPON_KEYS.forEach((key) => {
    if (key in order) {
      push(order[key]);
    }
  });

  COUPON_COLLECTION_KEYS.forEach((key) => {
    const collection = order[key];
    if (collection === undefined || collection === null) {
      return;
    }
    if (Array.isArray(collection)) {
      collection.forEach((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
          push(entry);
          return;
        }
        if (entry && typeof entry === 'object') {
          for (const objectKey of COUPON_OBJECT_KEYS) {
            if (objectKey in entry) {
              push(entry[objectKey]);
              break;
            }
          }
        }
      });
      return;
    }

    if (collection && typeof collection === 'object') {
      for (const objectKey of COUPON_OBJECT_KEYS) {
        if (objectKey in collection) {
          push(collection[objectKey]);
        }
      }
    }
  });

  if (order.discount && typeof order.discount === 'object') {
    const discount = order.discount;
    if (discount.coupon) {
      push(discount.coupon);
    }
    if (discount.code) {
      push(discount.code);
    }
  }

  return Array.from(codes);
}

function deriveMerchantId(order, fallback) {
  return (
    normalizeString(order?.merchant_id) ||
    normalizeString(order?.store_id) ||
    normalizeString(order?.store?.id) ||
    normalizeString(order?.merchantId) ||
    normalizeString(order?.storeId) ||
    normalizeString(fallback)
  );
}

function deriveOrderId(order, fallback) {
  return (
    normalizeString(order?.id) ||
    normalizeString(order?.order_id) ||
    normalizeString(order?.orderId) ||
    normalizeString(fallback)
  );
}

function parsePayload(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(raw);
}

function getNested(obj, path) {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

const ORDER_PATHS = [
  ['order'],
  ['data', 'order'],
  ['payload', 'order'],
  ['data'],
  ['payload'],
];

function resolveOrderPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  for (const path of ORDER_PATHS) {
    const candidate = getNested(payload, path);
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }
  return payload;
}

function deriveOrderNumberFallback(orderLike) {
  if (!orderLike || typeof orderLike !== 'object') {
    return null;
  }
  return (
    normalizeString(orderLike.order_number) ||
    normalizeString(orderLike.orderNumber) ||
    normalizeString(orderLike.reference_id) ||
    normalizeString(orderLike.referenceId) ||
    normalizeString(orderLike.reference) ||
    null
  );
}

async function loadPayloadFromDb({ eventId, orderId }) {
  if (!eventId && !orderId) {
    throw new Error('loadPayloadFromDb requires eventId or orderId');
  }

  if (eventId) {
    const event = await prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new Error(`WebhookEvent ${eventId} not found`);
    }
    return { payload: event.rawPayload, event };
  }

  const event = await prisma.webhookEvent.findFirst({
    where: { orderId },
    orderBy: { receivedAt: 'desc' },
  });
  if (!event) {
    throw new Error(`No WebhookEvent rows for order ${orderId}`);
  }
  return { payload: event.rawPayload, event };
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {};

  while (args.length) {
    const current = args.shift();
    if (current === '--file') {
      options.file = args.shift();
      continue;
    }
    if (current === '--event') {
      options.eventId = args.shift();
      continue;
    }
    if (current === '--order') {
      options.orderId = args.shift();
      continue;
    }
    if (!options.merchantOverride) {
      options.merchantOverride = current;
      continue;
    }
    if (!options.orderOverride) {
      options.orderOverride = current;
      continue;
    }
  }

  return options;
}

function summarizeRequest(request) {
  if (!request) {
    return null;
  }
  return {
    id: request.id,
    status: request.status,
    type: request.type,
    couponCode: request.couponCode,
    merchantId: request.merchantId,
    exchangeOrderId: request.exchangeOrderId,
    exchangeOrderNumber: request.exchangeOrderNumber,
    smsaTrackingNumber: request.smsaTrackingNumber,
  };
}

async function main() {
  const {
    file: filePath,
    eventId,
    orderId: orderFilter,
    merchantOverride,
    orderOverride,
  } = parseArgs(process.argv.slice(2));

  if (!filePath && !eventId && !orderFilter) {
    console.error(
      'Usage: node scripts/debug-exchange-link.js (--file ./payload.json | --event <webhookEventId> | --order <orderId>) [merchantIdOverride] [orderIdOverride]'
    );
    process.exit(1);
  }

  const loaded = filePath
    ? { payload: parsePayload(filePath), event: null }
    : await loadPayloadFromDb({ eventId, orderId: orderFilter });
  const rawPayload = loaded.payload ?? {};
  let order = resolveOrderPayload(rawPayload);
  const fallbackOrderId = orderOverride || loaded.event?.orderId || orderFilter || null;
  let orderId =
    deriveOrderId(order, fallbackOrderId) || deriveOrderId(rawPayload, fallbackOrderId);
  let merchantId =
    deriveMerchantId(order, merchantOverride) ||
    deriveMerchantId(rawPayload, merchantOverride);

  if (!orderId && fallbackOrderId) {
    orderId = fallbackOrderId;
  }

  const orderNumberCandidate =
    deriveOrderNumberFallback(order) ||
    deriveOrderNumberFallback(rawPayload) ||
    fallbackOrderId;

  let sallaOrderMeta = null;
  const orderLookupCandidates = Array.from(
    new Set([orderId, fallbackOrderId, orderNumberCandidate].filter(Boolean))
  );
  for (const candidate of orderLookupCandidates) {
    sallaOrderMeta = await prisma.sallaOrder.findFirst({
      where: {
        OR: [{ orderId: candidate }, { orderNumber: candidate }],
      },
      select: { merchantId: true, rawOrder: true },
    });
    if (sallaOrderMeta) {
      break;
    }
  }

  if (!merchantId && sallaOrderMeta?.merchantId) {
    merchantId = normalizeString(sallaOrderMeta.merchantId);
  }

  if ((!order || Object.keys(order).length === 0) && sallaOrderMeta?.rawOrder) {
    order = sallaOrderMeta.rawOrder;
  }

  if (!merchantId && merchantOverride) {
    merchantId = merchantOverride;
  }

  const coupons = extractAppliedCouponCodes(order);

  console.log('--- Exchange Link Debug ---');
  console.log('Merchant ID:', merchantId || '(missing)');
  console.log('Order ID:', orderId || '(missing)');
  console.log('Coupons found:', coupons);

  if (!merchantId || !orderId) {
    console.log('Cannot continue without merchantId and orderId.');
    return;
  }

  const exchangeCoupons = coupons.filter((code) => code.startsWith('EX'));
  if (exchangeCoupons.length === 0) {
    console.log('No exchange coupons detected.');
    return;
  }

  const request = await prisma.returnRequest.findFirst({
    where: {
      merchantId,
      type: 'exchange',
      OR: exchangeCoupons.map((code) => ({
        couponCode: {
          equals: code,
          mode: 'insensitive',
        },
      })),
    },
    include: {
      items: true,
    },
  });

  console.log('Matching return request:', summarizeRequest(request));
  if (request) {
    const allApproved = request.items.every((item) => item.conditionStatus === 'good');
    console.log('Items fully approved:', allApproved);
    if (request.exchangeOrderId === orderId) {
      console.log('Exchange already linked to this order.');
    } else {
      console.log('Exchange currently linked to:', request.exchangeOrderId || '(none)');
    }
  }
}

main()
  .catch((error) => {
    console.error('Failed to debug exchange linking:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
