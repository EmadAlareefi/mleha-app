/**
 * ERP Invoice Service
 *
 * Transforms SallaOrder data to ERP invoice format and posts to ERP system
 */

import type { SallaOrder } from '@prisma/client';
import { getERPAccessToken } from './erp-auth';
import { log as logger } from './logger';
import { sallaMakeRequest } from './salla-oauth';
import {
  buildFreeOrderInternalTransferMessage,
  buildNegativeERPInvoiceIdError,
  extractERPInvoiceId,
  extractERPInvoiceIdFromText,
  hasSuccessfulERPSync,
  isFreeERPOrder,
  isNegativeERPInvoiceId,
} from '@/lib/erp-order-sync';
import {
  ERP_SUPPORTED_CURRENCY,
  buildMissingERPSarRateMessage,
  buildUnsupportedERPCurrencyMessage,
  normalizeERPCurrency,
  resolveERPOrderCurrency,
  resolveERPSarRate,
} from '@/lib/erp-currency';
import { isPotentialRefundStatus } from '@/lib/refund-status';

// ERP Invoice payload based on your specifications
export interface ERPInvoiceItem {
  cmbkey: string;      // SKU
  barcode: string;     // Barcode from ERP
  qty: number;         // Quantity
  fqty: number;        // Free quantity (always 0)
  price: number;       // Original price with taxes before discounts
  discpc: number;      // Discount percentage
}

export interface ERPInvoicePayload {
  ltrtype: string;          // "06" for sale, "26" for refund
  SLCNTR: string;           // Sales center code (01 = salla, will be mapped later)
  BRANCH: string;           // Branch code (default "01")
  SLPRSN: string;           // Sales person code (default "01")
  USRID: string;            // User ID (default "web")
  lcustcode: string;        // Customer code (empty for now)
  hinvdsvl: number;         // Invoice discount value
  hinvdspc: number;         // Invoice discount percentage
  hvat_amt_rcvd: number;    // VAT amount received
  htaxfree_sales: number;   // Tax-free sales amount
  datetime_stamp: string;   // ISO date string
  Description: string;      // Description (for refunds: "مرتجع رقم {orderNumber}")
  Taxno: string;            // Tax number (empty for now)
  remarks2: string;         // Order number
  hrtnref: number;          // Return reference (default 0)
  transport_code: string;   // Transport code (empty for now)
  transport_amt: number;    // Transport amount
  transport_onus: number;   // Transport onus (default 1)
  other_amt: number;        // Other amount (default 0)
  other_acct: string;       // Other account (empty for now)
  API_Inv: ERPInvoiceItem[]; // Invoice items
}

export interface ERPInvoiceResult {
  success: boolean;
  erpInvoiceId?: string;
  error?: string;
  message?: string;
}

interface ERPBarcodeResult {
  barcode: string;
  itemNoUsed: string;
  isFallback: boolean;
}

interface ExtractOrderItemsResult {
  items: ERPInvoiceItem[];
  explicitOptionNetTotal: number;
}

class BarcodeNotFoundError extends Error {
  itemNo: string;

  constructor(itemNo: string) {
    super(`لم يتم العثور على الباركود في استجابة ERP للمنتج ${itemNo}`);
    this.name = 'BarcodeNotFoundError';
    this.itemNo = itemNo;
  }
}

/**
 * Normalize SKU before sending to ERP.
 * Removes any X/x characters Salla uses for size markers.
 */
function normalizeSkuForERP(rawSku: string): string {
  const sanitized = rawSku.replace(/x/gi, '').trim();
  return sanitized || rawSku;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toHalalas(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function fromHalalas(value: number): number {
  return value / 100;
}

function parseMoney(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('amount' in record) {
      return parseMoney(record.amount);
    }
    if ('value' in record) {
      return parseMoney(record.value);
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse a Salla money value and convert it to SAR.
 * Values labeled with an explicit SAR currency (Salla labels zero-value
 * defaults as SAR even on foreign-currency orders) are kept as-is; everything
 * else is assumed to be in the order currency and multiplied by `sarRate`.
 */
function convertMoneyToSar(value: unknown, sarRate: number): number {
  const amount = parseMoney(value);

  if (amount === 0 || sarRate === 1) {
    return amount;
  }

  if (value && typeof value === 'object') {
    const label = normalizeERPCurrency((value as Record<string, unknown>).currency);
    if (label === ERP_SUPPORTED_CURRENCY) {
      return amount;
    }
  }

  return amount * sarRate;
}

function calculateERPLineTotalHalalas(item: ERPInvoiceItem): number {
  const grossHalalas = toHalalas(item.price) * item.qty;
  const discountHalalas = Math.round(grossHalalas * (item.discpc / 100));
  return grossHalalas - discountHalalas;
}

function calculateERPItemsTotalHalalas(items: ERPInvoiceItem[]): number {
  return items.reduce((total, item) => total + calculateERPLineTotalHalalas(item), 0);
}

function calculateERPLineDiscountHalalas(item: ERPInvoiceItem): number {
  const grossHalalas = toHalalas(item.price) * item.qty;
  return Math.round(grossHalalas * (item.discpc / 100));
}

function deriveDiscountPercentageForExactHalalas(
  grossHalalas: number,
  discountHalalas: number
): number {
  if (grossHalalas <= 0 || discountHalalas <= 0) {
    return 0;
  }

  const boundedDiscountHalalas = Math.min(Math.max(discountHalalas, 0), grossHalalas);
  const exactPercentage = (boundedDiscountHalalas / grossHalalas) * 100;

  for (const decimals of [2, 3, 4, 5, 6]) {
    const candidate = Number(exactPercentage.toFixed(decimals));
    if (Math.round(grossHalalas * (candidate / 100)) === boundedDiscountHalalas) {
      return candidate;
    }
  }

  return Number(exactPercentage.toFixed(6));
}

function tryAdjustItemDiscountToMatchTotal(items: ERPInvoiceItem[], deltaHalalas: number): boolean {
  const candidateIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.qty > 0 && toHalalas(item.price) > 0)
    .sort((left, right) => {
      const leftDiscount = calculateERPLineDiscountHalalas(left.item);
      const rightDiscount = calculateERPLineDiscountHalalas(right.item);
      return rightDiscount - leftDiscount;
    })
    .map(({ index }) => index);

  for (const index of candidateIndexes) {
    const item = items[index];
    const grossHalalas = toHalalas(item.price) * item.qty;
    const currentDiscountHalalas = calculateERPLineDiscountHalalas(item);
    const targetDiscountHalalas = currentDiscountHalalas - deltaHalalas;

    if (targetDiscountHalalas < 0 || targetDiscountHalalas > grossHalalas) {
      continue;
    }

    item.discpc = deriveDiscountPercentageForExactHalalas(grossHalalas, targetDiscountHalalas);
    return true;
  }

  return false;
}

/**
 * Resolve the original Salla order date for ERP payloads.
 * Prefers the raw `date.created` field, falling back to stored timestamps.
 */
function getSallaOrderDate(order: SallaOrder): Date {
  const rawOrder = order.rawOrder as any;

  const candidates: Array<string | Date | null | undefined> = [
    rawOrder?.date?.created,
    rawOrder?.date?.updated,
    order.placedAt,
    order.updatedAtRemote,
    order.createdAt,
    order.updatedAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const date =
      candidate instanceof Date
        ? candidate
        : new Date(candidate);

    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date();
}

/**
 * Perform the actual ERP barcode lookup without fallback handling
 */
async function lookupBarcodeFromERP(itemNo: string): Promise<string> {
  const barcodeApiUrl = process.env.ERP_BARCODE_API_URL;
  const apiKey = process.env.ERP_API_KEY;

  if (!barcodeApiUrl || !apiKey) {
    throw new Error('ERP Barcode API not configured. Please set ERP_BARCODE_API_URL and ERP_API_KEY in environment variables.');
  }

  try {
    // Build full URL: https://desktop-gt2mtiv.tail6f05fc.ts.net/mleha-api/api/getItemDetails/{itemNo}
    const url = `${barcodeApiUrl}/getItemDetails/${itemNo}`;

    logger.info('Fetching barcode from ERP', { itemNo, url });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'ApiKey': apiKey,
      },
    });

    if (response.status === 404) {
      throw new BarcodeNotFoundError(itemNo);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch barcode from ERP API: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseText = await response.text();
    let parsedData: Record<string, any> | null = null;

    if (responseText.trim()) {
      try {
        parsedData = JSON.parse(responseText);
      } catch (parseError) {
        logger.warn('ERP Barcode API returned non-JSON body', {
          itemNo,
          responsePreview: responseText.slice(0, 200),
          parseError: (parseError as Error).message,
        });
      }
    }

    const barcode =
      parsedData?.barcode ||
      parsedData?.Barcode ||
      (responseText.trim() ? responseText.trim() : null);

    if (!barcode) {
      throw new BarcodeNotFoundError(itemNo);
    }

    logger.info('Fetched barcode from ERP', {
      itemNo,
      barcode,
    });

    return barcode;
  } catch (error: any) {
    logger.error('Error fetching barcode from ERP', {
      itemNo,
      error: error.message,
    });
    throw error; // Re-throw the error instead of falling back
  }
}

/**
 * Fetch barcode from ERP API for a given item number (cmbkey) with fallback handling.
 * Falls back to SKU 2020 (or ERP_FALLBACK_SKU env override) when the target SKU is missing.
 */
async function fetchBarcodeFromERP(itemNo: string): Promise<ERPBarcodeResult> {
  const fallbackSku = (process.env.ERP_FALLBACK_SKU || '2020').trim();

  try {
    const barcode = await lookupBarcodeFromERP(itemNo);
    return {
      barcode,
      itemNoUsed: itemNo,
      isFallback: false,
    };
  } catch (error: any) {
    const canFallback = error instanceof BarcodeNotFoundError && itemNo !== fallbackSku;

    if (canFallback) {
      logger.warn('Barcode not found for SKU, falling back to default SKU', {
        requestedItemNo: itemNo,
        fallbackSku,
      });

      try {
        const fallbackBarcode = await lookupBarcodeFromERP(fallbackSku);

        logger.info('Using fallback SKU barcode for missing item', {
          requestedItemNo: itemNo,
          fallbackSku,
        });

        return {
          barcode: fallbackBarcode,
          itemNoUsed: fallbackSku,
          isFallback: true,
        };
      } catch (fallbackError: any) {
        logger.error('Fallback SKU barcode lookup failed', {
          requestedItemNo: itemNo,
          fallbackSku,
          error: fallbackError.message,
        });
        throw fallbackError;
      }
    }

    throw error;
  }
}

/**
 * Sales center mapping
 * Maps payment methods to ERP sales center codes
 */
function getSalesCenterCode(order: SallaOrder): string {
  const paymentMethod = order.paymentMethod?.toLowerCase() || '';

  // Map payment methods to sales center codes
  if (paymentMethod.includes('tamara')) {
    return '03'; // Tamara
  }
  if (paymentMethod.includes('tabby')) {
    return '02'; // Tabby
  }
  if (paymentMethod.includes('mada') || paymentMethod.includes('stc_pay') || paymentMethod.includes('apple_pay') || paymentMethod.includes('visa') || paymentMethod.includes('mastercard') || paymentMethod.includes('credit')) {
    return '04'; // Mada/Credit Card
  }
  // Default for COD and other payment methods
  return '01';
}

/**
 * Determine invoice type based on order status
 */
function getInvoiceType(order: SallaOrder): '06' | '26' {
  if (
    isPotentialRefundStatus(order.statusSlug) ||
    isPotentialRefundStatus(order.statusName)
  ) {
    return '26'; // Refund invoice
  }

  // Default to sale invoice
  return '06';
}

/**
 * Fetch full order details from Salla API to get accurate amounts
 */
async function fetchOrderDetailsFromSalla(merchantId: string, orderId: string): Promise<any | null> {
  try {
    logger.info('Fetching full order details from Salla API', {
      merchantId,
      orderId,
    });

    const endpoint = `/orders/${orderId}`;

    const response: any = await sallaMakeRequest(
      merchantId,
      endpoint,
      { method: 'GET' }
    );

    if (response?.success && response?.data) {
      logger.info('Fetched order details from Salla API', {
        orderId,
        hasAmounts: !!response.data.amounts,
      });
      return response.data;
    }

    logger.warn('Failed to fetch order details from Salla API', {
      orderId,
      response,
    });
    return null;
  } catch (error: any) {
    logger.error('Error fetching order details from Salla API', {
      orderId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Fetch order items from Salla API
 */
async function fetchOrderItemsFromSalla(merchantId: string, orderId: string): Promise<any[]> {
  try {
    logger.info('Fetching order items from Salla API', {
      merchantId,
      orderId,
    });

    // Build URL with query parameters
    const endpoint = `/orders/items?order_id=${orderId}`;

    const response: any = await sallaMakeRequest(
      merchantId,
      endpoint,
      { method: 'GET' }
    );

    if (response?.success && response?.data) {
      logger.info('Fetched order items from Salla API', {
        orderId,
        itemCount: response.data.length,
      });
      return response.data;
    }

    logger.warn('Failed to fetch items from Salla API', {
      orderId,
      response,
    });
    return [];
  } catch (error: any) {
    logger.error('Error fetching items from Salla API', {
      orderId,
      error: error.message,
    });
    return [];
  }
}

/**
 * Extract items from raw order JSON or Salla API.
 * Item prices arrive in the order currency and are converted to SAR
 * using `sarRate` (1 for SAR orders).
 */
async function extractOrderItems(order: SallaOrder, sarRate: number): Promise<ExtractOrderItemsResult> {
  const items: ERPInvoiceItem[] = [];
  let explicitOptionNetTotal = 0;

  // Try to fetch items from Salla API first
  let orderItems = await fetchOrderItemsFromSalla(order.merchantId, order.orderId);

  // If API fetch failed, fall back to raw order data
  if (!orderItems || orderItems.length === 0) {
    logger.info('Falling back to raw order data for items', {
      orderId: order.orderId,
    });

    const rawOrder = order.rawOrder as any;
    orderItems = rawOrder?.items || rawOrder?.order?.items || [];
  }

  logger.info('Order items to process', {
    orderId: order.orderId,
    itemsLength: orderItems.length,
    isArray: Array.isArray(orderItems),
    firstItem: orderItems[0] ? JSON.stringify(orderItems) : 'no items',
  });

  for (const item of orderItems) {
    // Extract SKU (try multiple possible field names)
    const rawSku = (item.sku || item.product?.sku || item.variant?.sku || '').toString();
    const sku = normalizeSkuForERP(rawSku);

    if (!rawSku) {
      logger.warn('Item missing SKU', {
        orderId: order.orderId,
        itemId: item.id,
        itemName: item.name,
        availableKeys: Object.keys(item),
      });
      continue;
    }

    // Extract quantity
    const qty = parseInt(item.quantity || item.qty || '1', 10);

    // Extract price from Salla API structure
    // Price should be: price_without_tax + tax (original price with tax, before discounts)
    let price = 0;

    if (item.amounts?.price_without_tax?.amount != null && item.amounts?.tax?.amount?.amount != null) {
      // Salla API format: price with tax = price_without_tax + tax
      // (use != null, not truthiness: a fully-discounted item legitimately has tax amount 0)
      const priceWithoutTax = convertMoneyToSar(item.amounts.price_without_tax, sarRate);
      const taxAmount = convertMoneyToSar(item.amounts.tax.amount, sarRate);
      price = priceWithoutTax + taxAmount;
    } else if (item.amounts?.total?.amount != null) {
      // Fallback to total amount
      price = convertMoneyToSar(item.amounts.total, sarRate);
    } else {
      // Final fallback
      price = convertMoneyToSar(item.price ?? item.amount ?? 0, sarRate);
    }
    price = roundMoney(price);

    // Calculate discount percentage from exact line halalas, not rounded unit percentages.
    let discpc = 0;
    const grossLineHalalas = toHalalas(price) * qty;
    if (grossLineHalalas > 0) {
      const discountAmount = convertMoneyToSar(item.amounts?.total_discount, sarRate);
      let discountHalalas = toHalalas(discountAmount);

      if (discountHalalas <= 0) {
        const lineTotalAmount = convertMoneyToSar(item.amounts?.total, sarRate);
        const desiredNetHalalas = toHalalas(lineTotalAmount);

        if (lineTotalAmount > 0 && desiredNetHalalas <= grossLineHalalas) {
          discountHalalas = grossLineHalalas - desiredNetHalalas;
        }
      }

      if (discountHalalas > 0) {
        discpc = deriveDiscountPercentageForExactHalalas(grossLineHalalas, discountHalalas);
      }
    }

    // Fetch barcode from ERP (with fallback for missing SKUs)
    const { barcode, itemNoUsed, isFallback } = await fetchBarcodeFromERP(sku);
    const erpSku = itemNoUsed;

    // A line whose net value is 0 (fully discounted, or a genuinely free/gift
    // item with no original price) is a free item, not a discounted sale.
    // Record it via fqty (free quantity) rather than qty + discpc, since the
    // ERP appears to reject invoices whose net total settles to 0 SAR.
    const netLineHalalas = grossLineHalalas - Math.round(grossLineHalalas * (discpc / 100));
    const isFullyFree = qty > 0 && netLineHalalas === 0;
    const finalQty = isFullyFree ? 0 : qty;
    const finalFqty = isFullyFree ? qty : 0;
    const finalDiscpc = isFullyFree ? 0 : discpc;

    logger.info('Extracted item for ERP', {
      orderId: order.orderId,
      requestedSku: sku,
      erpSku,
      rawSku,
      barcode,
      usedFallbackBarcode: isFallback,
      qty: finalQty,
      fqty: finalFqty,
      price,
      discpc: finalDiscpc,
      isFullyFree,
      itemName: item.name,
    });

    items.push({
      cmbkey: erpSku,
      barcode: barcode,
      qty: finalQty,
      fqty: finalFqty,
      price: price,
      discpc: finalDiscpc,
    });

    // Add extra options (like packaging) if available
    if (item.options && Array.isArray(item.options)) {
      for (const option of item.options) {
        // Check if option has a price
        if (option.value?.price?.amount && parseFloat(option.value.price.amount) > 0) {
          const optionPrice = roundMoney(convertMoneyToSar(option.value.price, sarRate));

          items.push({
            cmbkey: '0000',
            barcode: '05147',
            qty: qty, // Same quantity as the product
            fqty: 0,
            price: optionPrice,
            discpc: 0,
          });

          explicitOptionNetTotal += optionPrice * qty;

          logger.info('Added product option as item', {
            orderId: order.orderId,
            optionName: option.name,
            optionValue: option.value.name,
            price: optionPrice,
          });
        }
      }
    }
  }

  return {
    items,
    explicitOptionNetTotal: roundMoney(explicitOptionNetTotal),
  };
}

/**
 * Transform SallaOrder to ERP invoice payload
 */
export async function transformOrderToERPInvoice(order: SallaOrder): Promise<ERPInvoicePayload> {
  const rawOrder = order.rawOrder as any;

  // ERP only accepts SAR. Non-SAR orders are converted using the exchange
  // rate Salla ships in the raw order payload (or the configured env rates).
  const orderCurrency = resolveERPOrderCurrency(order.currency, rawOrder);
  if (!orderCurrency) {
    throw new Error(buildUnsupportedERPCurrencyMessage(order.currency));
  }

  const sarRate = resolveERPSarRate(orderCurrency, rawOrder);
  if (sarRate === null) {
    throw new Error(buildMissingERPSarRateMessage(orderCurrency));
  }

  if (orderCurrency !== ERP_SUPPORTED_CURRENCY) {
    logger.info('Converting order amounts to SAR for ERP', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      orderCurrency,
      sarRate,
    });
  }

  const invoiceType = getInvoiceType(order);
  const salesCenter = getSalesCenterCode(order);
  const extractedItems = await extractOrderItems(order, sarRate);
  const items = extractedItems.items;

  // Extract amounts - try from database first, then fetch from Salla API if needed
  const taxAmount = roundMoney(convertMoneyToSar(order.taxAmount, sarRate));
  let shippingAmount = roundMoney(convertMoneyToSar(order.shippingAmount, sarRate));
  const discountAmount = roundMoney(convertMoneyToSar(order.discountAmount, sarRate));
  const optionsTotalAmount = roundMoney(convertMoneyToSar(rawOrder?.amounts?.options_total, sarRate));
  const expectedTotal = roundMoney(
    convertMoneyToSar(rawOrder?.amounts?.total, sarRate) ||
      convertMoneyToSar(rawOrder?.total, sarRate) ||
      convertMoneyToSar(order.totalAmount, sarRate)
  );

  // If shippingAmount is 0, try to extract from raw order data or fetch from API
  if (shippingAmount === 0) {
    let rawShipping = rawOrder?.amounts?.shipping?.amount ||
                      rawOrder?.amounts?.shipping ||
                      rawOrder?.amounts?.shipping_cost?.amount ||
                      rawOrder?.amounts?.shipping_cost ||
                      rawOrder?.shipping_cost?.amount ||
                      rawOrder?.shipping_cost ||
                      0;

    // If still 0, fetch full order details from Salla API
    if (rawShipping === 0) {
      const orderDetails = await fetchOrderDetailsFromSalla(order.merchantId, order.orderId);
      if (orderDetails?.amounts) {
        rawShipping = orderDetails.amounts.shipping?.amount ||
                     orderDetails.amounts.shipping ||
                     orderDetails.amounts.shipping_cost?.amount ||
                     orderDetails.amounts.shipping_cost ||
                     0;

        logger.info('Fetched shipping from Salla API', {
          orderId: order.orderId,
          shippingAmount: rawShipping,
          amounts: orderDetails.amounts,
        });
      }
    }

    shippingAmount = roundMoney(convertMoneyToSar(rawShipping, sarRate));

    logger.info('Extracted shipping amount', {
      orderId: order.orderId,
      shippingAmount,
      source: rawShipping === 0 ? 'none' : 'raw/api',
    });
  }

  const extraChargeItems: ERPInvoiceItem[] = [];

  // Add shipping as a line item if there's a shipping cost
  if (shippingAmount > 0) {
    const shippingWithTax = roundMoney(shippingAmount * 1.15);

    extraChargeItems.push({
      cmbkey: '0',
      barcode: '019',
      qty: 1,
      fqty: 0,
      price: shippingWithTax,
      discpc: 0,
    });

    logger.info('Added shipping as item', {
      orderId: order.orderId,
      shippingAmount,
      shippingWithTax,
    });
  }

  // Add COD fee as a line item if payment method is COD
  const paymentMethod = order.paymentMethod?.toLowerCase() || '';
  const isCOD = paymentMethod.includes('cod') || paymentMethod.includes('cash');
  let codFeeAmount = 0;

  if (isCOD) {
    // Extract COD fee from raw order or API
    let codFee = rawOrder?.amounts?.cash_on_delivery?.amount ||
                 rawOrder?.amounts?.cash_on_delivery ||
                 rawOrder?.amounts?.cod_cost?.amount ||
                 rawOrder?.amounts?.cod_cost ||
                 rawOrder?.cod_cost?.amount ||
                 rawOrder?.cod_cost ||
                 rawOrder?.payment_fee?.amount ||
                 rawOrder?.payment_fee ||
                 0;

    // If still 0, try to fetch from Salla API
    if (codFee === 0) {
      const orderDetails = await fetchOrderDetailsFromSalla(order.merchantId, order.orderId);
      if (orderDetails?.amounts) {
        codFee = orderDetails.amounts.cash_on_delivery?.amount ||
                orderDetails.amounts.cash_on_delivery ||
                orderDetails.amounts.cod_cost?.amount ||
                orderDetails.amounts.cod_cost ||
                0;

        logger.info('Fetched COD fee from Salla API', {
          orderId: order.orderId,
          codFee,
          amounts: orderDetails.amounts,
        });
      }
    }

    codFeeAmount = roundMoney(convertMoneyToSar(codFee, sarRate));

    if (codFeeAmount > 0) {
      const codFeeWithTax = roundMoney(codFeeAmount * 1.15);

      extraChargeItems.push({
        cmbkey: '000',
        barcode: '000',
        qty: 1,
        fqty: 0,
        price: codFeeWithTax,
        discpc: 0,
      });

      logger.info('Added COD fee as item', {
        orderId: order.orderId,
        codFee: codFeeAmount,
        codFeeWithTax,
      });
    } else {
      logger.info('COD order but no COD fee found in order data', {
        orderId: order.orderId,
        paymentMethod: order.paymentMethod,
      });
    }
  }

  const optionRemainderNet = roundMoney(
    Math.max(0, optionsTotalAmount - extractedItems.explicitOptionNetTotal)
  );

  if (optionRemainderNet > 0) {
    const optionsWithTax = roundMoney(optionRemainderNet * 1.15);

    extraChargeItems.push({
      cmbkey: '0000',
      barcode: '05147',
      qty: 1,
      fqty: 0,
      price: optionsWithTax,
      discpc: 0,
    });

    logger.info('Added options total as item', {
      orderId: order.orderId,
      optionsTotalAmount,
      explicitOptionNetTotal: extractedItems.explicitOptionNetTotal,
      optionRemainderNet,
      optionsWithTax,
    });
  }

  items.push(...extraChargeItems);

  // Log extracted items for debugging
  logger.info('Extracted items from order', {
    orderId: order.orderId,
    itemsCount: items.length,
    items: items,
    hasShipping: shippingAmount > 0,
    isCOD,
  });

  // Reconcile non-product lines back to Salla's exact total in halalas.
  const invoiceDiscountHalalas = toHalalas(discountAmount);
  let calculatedTotalHalalas = calculateERPItemsTotalHalalas(items) - invoiceDiscountHalalas;
  let deltaHalalas = toHalalas(expectedTotal) - calculatedTotalHalalas;

  if (deltaHalalas !== 0) {
    const lastAdjustmentItem = extraChargeItems[extraChargeItems.length - 1] || null;
    let adjusted = false;

    if (lastAdjustmentItem) {
      lastAdjustmentItem.price = roundMoney(lastAdjustmentItem.price + fromHalalas(deltaHalalas));
      adjusted = true;
    } else if (items.length > 0 && items[items.length - 1].qty === 1 && items[items.length - 1].discpc === 0) {
      items[items.length - 1].price = roundMoney(items[items.length - 1].price + fromHalalas(deltaHalalas));
      adjusted = true;
    } else if (tryAdjustItemDiscountToMatchTotal(items, deltaHalalas)) {
      adjusted = true;
    } else if (deltaHalalas > 0) {
      items.push({
        cmbkey: '0000',
        barcode: '05147',
        qty: 1,
        fqty: 0,
        price: fromHalalas(deltaHalalas),
        discpc: 0,
      });
      adjusted = true;
    }

    if (adjusted) {
      calculatedTotalHalalas = calculateERPItemsTotalHalalas(items) - invoiceDiscountHalalas;
      deltaHalalas = toHalalas(expectedTotal) - calculatedTotalHalalas;
    }
  }

  const calculatedTotal = fromHalalas(calculatedTotalHalalas);
  const totalDifference = Math.abs(deltaHalalas);

  logger.info('Total validation', {
    orderId: order.orderId,
    orderCurrency,
    sarRate,
    calculatedTotal,
    expectedTotal,
    differenceHalalas: totalDifference,
    isValid: totalDifference === 0,
    shippingAmount,
    codFeeAmount,
    optionsTotalAmount,
    explicitOptionNetTotal: extractedItems.explicitOptionNetTotal,
  });

  if (totalDifference !== 0) {
    const errorMsg = `Total mismatch: calculated ${calculatedTotal} SAR but expected ${expectedTotal} SAR (difference: ${fromHalalas(totalDifference)} SAR)`;
    logger.error('Invoice total validation failed', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      calculatedTotal,
      expectedTotal,
      differenceHalalas: totalDifference,
      items,
    });

    throw new Error(errorMsg);
  }

  // Calculate discount percentage on total (both sides in SAR)
  const subtotal = convertMoneyToSar(order.subtotalAmount, sarRate);
  const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;

  // Generate description for refunds
  const description = invoiceType === '26'
    ? `مرتجع رقم ${order.orderNumber || order.orderId}`
    : `فاتورة رقم ${order.orderNumber || order.orderId}`;

  // Use the original Salla order date if available
  const orderDate = getSallaOrderDate(order);

  return {
    ltrtype: invoiceType,
    SLCNTR: salesCenter,
    BRANCH: '05',
    SLPRSN: '01',
    USRID: 'web',
    lcustcode: '',
    hinvdsvl: discountAmount,
    hinvdspc: Math.round(discountPercentage * 100) / 100,
    hvat_amt_rcvd: taxAmount,
    htaxfree_sales: 0,
    datetime_stamp: orderDate.toISOString(),
    Description: description,
    Taxno: '',
    remarks2: order.orderNumber || order.orderId,
    hrtnref: 0,
    transport_code: '',
    transport_amt: Math.round(shippingAmount * 100) / 100,
    transport_onus: 1,
    other_amt: 0,
    other_acct: '',
    API_Inv: items,
  };
}

/**
 * Post invoice to ERP system
 */
export async function postInvoiceToERP(payload: ERPInvoicePayload): Promise<ERPInvoiceResult> {
  const erpInvoiceUrl = process.env.ERP_INVOICE_URL;
  const debugMode = process.env.ERP_DEBUG_MODE === 'true';

  if (!erpInvoiceUrl) {
    return {
      success: false,
      error: 'ERP_INVOICE_URL not configured',
      message: 'ERP invoice URL not set in environment variables',
    };
  }

  try {
    logger.info('Posting invoice to ERP', {
      orderNumber: payload.remarks2,
      invoiceType: payload.ltrtype,
      itemCount: payload.API_Inv.length,
      items: payload.API_Inv,
      fullPayload: payload,
      debugMode,
    });

    // DEBUG MODE: Skip actual API call
    if (debugMode) {
      logger.warn('⚠️ ERP DEBUG MODE ENABLED - Skipping actual API call', {
        orderNumber: payload.remarks2,
        itemCount: payload.API_Inv.length,
      });

      // Return mock success response
      return {
        success: true,
        erpInvoiceId: 'DEBUG-' + Math.floor(Math.random() * 10000),
        message: 'DEBUG MODE: Invoice logged but not sent to ERP',
      };
    }

    // Get valid access token (automatically refreshes if needed)
    const accessToken = await getERPAccessToken();

    const response = await fetch(erpInvoiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ERP API returned ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();
    let parsedResult: Record<string, any> | null = null;

    if (responseText.trim()) {
      try {
        parsedResult = JSON.parse(responseText);
      } catch (parseError) {
        logger.warn('ERP API returned non-JSON body', {
          orderNumber: payload.remarks2,
          responsePreview: responseText.slice(0, 200),
          parseError: (parseError as Error).message,
        });
      }
    }

    logger.info('Invoice posted to ERP successfully', {
      orderNumber: payload.remarks2,
      erpResponse: parsedResult ?? responseText ?? null,
    });

    const erpInvoiceId =
      extractERPInvoiceId(parsedResult) ||
      extractERPInvoiceIdFromText(responseText);

    if (isNegativeERPInvoiceId(erpInvoiceId)) {
      const errorMessage =
        parsedResult?.message ||
        parsedResult?.error ||
        parsedResult?.status ||
        buildNegativeERPInvoiceIdError(erpInvoiceId);

      logger.error('ERP API returned a negative invoice ID', {
        orderNumber: payload.remarks2,
        erpInvoiceId,
        erpResponse: parsedResult ?? responseText ?? null,
      });

      return {
        success: false,
        error: errorMessage,
        message: errorMessage,
      };
    }

    return {
      success: true,
      erpInvoiceId: erpInvoiceId || undefined,
      message:
        parsedResult?.message ||
        parsedResult?.status ||
        (responseText.trim() || 'Invoice posted to ERP successfully'),
    };
  } catch (error: any) {
    logger.error('Failed to post invoice to ERP', {
      orderNumber: payload.remarks2,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      message: 'Failed to post invoice to ERP',
    };
  }
}

/**
 * High-level function to sync a SallaOrder to ERP
 * Includes duplicate prevention and sync status tracking
 *
 * @param order - The SallaOrder to sync
 * @param force - If true, force sync even if already synced
 */
export async function syncOrderToERP(
  order: SallaOrder,
  force: boolean = false
): Promise<ERPInvoiceResult> {
  try {
    // Check if order is already synced
    if (hasSuccessfulERPSync(order) && !force) {
      logger.info('Order already synced to ERP, skipping', {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        erpSyncedAt: order.erpSyncedAt,
        erpInvoiceId: order.erpInvoiceId,
      });

      return {
        success: true,
        erpInvoiceId: order.erpInvoiceId || undefined,
        message: 'Order already synced to ERP (use force=true to re-sync)',
      };
    }

    // Fully-discounted orders have no revenue to invoice, and the ERP rejects
    // zero-total sale invoices outright. Block the attempt (even with force)
    // rather than repeatedly hitting the ERP for something it will never accept.
    if (!hasSuccessfulERPSync(order) && isFreeERPOrder(order)) {
      const message = buildFreeOrderInternalTransferMessage();

      logger.info('Skipping ERP sync for free order (needs manual internal transfer)', {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
      });

      return {
        success: false,
        error: message,
        message,
      };
    }

    if (order.erpSyncedAt && isNegativeERPInvoiceId(order.erpInvoiceId)) {
      logger.warn('Order has a negative ERP invoice ID and will be retried', {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        erpSyncedAt: order.erpSyncedAt,
        erpInvoiceId: order.erpInvoiceId,
      });
    }

    logger.info('Syncing order to ERP', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      status: order.statusSlug,
      force,
    });

    // Transform order to ERP format
    const payload = await transformOrderToERPInvoice(order);

    // Post to ERP
    const result = await postInvoiceToERP(payload);

    return result;
  } catch (error: any) {
    logger.error('Failed to sync order to ERP', {
      orderId: order.orderId,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      message: 'Failed to sync order to ERP',
    };
  }
}
