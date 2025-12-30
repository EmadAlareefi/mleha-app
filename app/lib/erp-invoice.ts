/**
 * ERP Invoice Service
 *
 * Transforms SallaOrder data to ERP invoice format and posts to ERP system
 */

import { SallaOrder } from '@prisma/client';
import { getERPAccessToken } from './erp-auth';
import { log as logger } from './logger';
import { sallaMakeRequest } from './salla-oauth';

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

/**
 * Normalize SKU before sending to ERP.
 * Removes any X/x characters Salla uses for size markers.
 */
function normalizeSkuForERP(rawSku: string): string {
  const sanitized = rawSku.replace(/x/gi, '').trim();
  return sanitized || rawSku;
}

/**
 * Fetch barcode from ERP API for a given item number (cmbkey)
 */
async function fetchBarcodeFromERP(itemNo: string): Promise<string> {
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
      throw new Error(`لم يتم العثور على الباركود في استجابة ERP للمنتج ${itemNo}`);
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
  if (paymentMethod.includes('mada') || paymentMethod.includes('visa') || paymentMethod.includes('mastercard') || paymentMethod.includes('credit')) {
    return '04'; // Mada/Credit Card
  }

  // Default for COD and other payment methods
  return '01';
}

/**
 * Determine invoice type based on order status
 */
function getInvoiceType(order: SallaOrder): '06' | '26' {
  const statusSlug = order.statusSlug?.toLowerCase() || '';

  // Refund/return statuses
  if (statusSlug.includes('refund') ||
      statusSlug.includes('return') ||
      statusSlug.includes('cancelled')) {
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
 * Extract items from raw order JSON or Salla API
 */
async function extractOrderItems(order: SallaOrder): Promise<ERPInvoiceItem[]> {
  const items: ERPInvoiceItem[] = [];

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

    if (item.amounts?.price_without_tax?.amount && item.amounts?.tax?.amount?.amount) {
      // Salla API format: price with tax = price_without_tax + tax
      const priceWithoutTax = parseFloat(item.amounts.price_without_tax.amount);
      const taxAmount = parseFloat(item.amounts.tax.amount.amount);
      price = priceWithoutTax + taxAmount;
    } else if (item.amounts?.total?.amount) {
      // Fallback to total amount
      price = parseFloat(item.amounts.total.amount);
    } else {
      // Final fallback
      price = parseFloat(item.price || item.amount || '0');
    }

    // Calculate discount percentage
    let discpc = 0;
    if (item.amounts?.total_discount?.amount) {
      const discountAmount = parseFloat(item.amounts.total_discount.amount);
      if (price > 0 && discountAmount > 0) {
        // Discount percentage based on single item price
        discpc = (discountAmount / price) * 100;
      }
    }

    // Fetch barcode from ERP
    const barcode = await fetchBarcodeFromERP(sku);

    logger.info('Extracted item for ERP', {
      orderId: order.orderId,
      sku,
      rawSku,
      barcode,
      qty,
      price,
      discpc,
      itemName: item.name,
    });

    items.push({
      cmbkey: sku,
      barcode: barcode,
      qty: qty,
      fqty: 0,
      price: price,
      discpc: Math.round(discpc * 100) / 100, // Round to 2 decimal places
    });

    // Add extra options (like packaging) if available
    if (item.options && Array.isArray(item.options)) {
      for (const option of item.options) {
        // Check if option has a price
        if (option.value?.price?.amount && parseFloat(option.value.price.amount) > 0) {
          const optionPrice = parseFloat(option.value.price.amount);

          items.push({
            cmbkey: '0000',
            barcode: '05147',
            qty: qty, // Same quantity as the product
            fqty: 0,
            price: optionPrice,
            discpc: 0,
          });

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

  return items;
}

/**
 * Transform SallaOrder to ERP invoice payload
 */
export async function transformOrderToERPInvoice(order: SallaOrder): Promise<ERPInvoicePayload> {
  const invoiceType = getInvoiceType(order);
  const salesCenter = getSalesCenterCode(order);
  const items = await extractOrderItems(order);

  // Extract amounts - try from database first, then fetch from Salla API if needed
  const taxAmount = parseFloat(order.taxAmount?.toString() || '0');
  let shippingAmount = parseFloat(order.shippingAmount?.toString() || '0');
  const discountAmount = parseFloat(order.discountAmount?.toString() || '0');

  // If shippingAmount is 0, try to extract from raw order data or fetch from API
  if (shippingAmount === 0) {
    const rawOrder = order.rawOrder as any;
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

    shippingAmount = parseFloat(rawShipping.toString());

    logger.info('Extracted shipping amount', {
      orderId: order.orderId,
      shippingAmount,
      source: rawShipping === 0 ? 'none' : 'raw/api',
    });
  }

  if (!Number.isFinite(shippingAmount) || Number.isNaN(shippingAmount)) {
    logger.warn('Shipping amount is not a valid number, defaulting to 0', {
      orderId: order.orderId,
      rawValue: order.shippingAmount,
    });
    shippingAmount = 0;
  }

  // Add shipping as a line item if there's a shipping cost
  if (shippingAmount > 0) {
    // Shipping price should include tax (15%)
    const shippingWithTax = shippingAmount * 1.15;

    items.push({
      cmbkey: '0',
      barcode: '019',
      qty: 1,
      fqty: 0,
      price: Math.round(shippingWithTax * 100) / 100, // Round to 2 decimal places
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

  if (isCOD) {
    // Extract COD fee from raw order or API
    const rawOrder = order.rawOrder as any;
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

    const codFeeAmount = parseFloat(codFee.toString());

    if (codFeeAmount > 0) {
      // COD fee with tax (15%)
      const codFeeWithTax = codFeeAmount * 1.15;

      items.push({
        cmbkey: '000',
        barcode: '000',
        qty: 1,
        fqty: 0,
        price: Math.round(codFeeWithTax * 100) / 100,
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

  // Log extracted items for debugging
  logger.info('Extracted items from order', {
    orderId: order.orderId,
    itemsCount: items.length,
    items: items,
    hasShipping: shippingAmount > 0,
    isCOD,
  });

  // Validate total: Calculate total from items and compare with order total
  let calculatedTotal = 0;
  for (const item of items) {
    // Calculate item total: (price * qty) - (price * qty * discpc / 100)
    const itemSubtotal = item.price * item.qty;
    const itemDiscount = itemSubtotal * (item.discpc / 100);
    const itemTotal = itemSubtotal - itemDiscount;
    calculatedTotal += itemTotal;
  }

  // Add discount at invoice level
  calculatedTotal -= discountAmount;

  // Round to 2 decimal places for comparison
  calculatedTotal = Math.round(calculatedTotal * 100) / 100;

  // Get expected total from order
  const rawOrder = order.rawOrder as any;
  const expectedTotal = parseFloat(
    rawOrder?.total?.amount ||
    order.totalAmount?.toString() ||
    '0'
  );

  // Allow small difference due to rounding (0.01 SAR tolerance)
  const totalDifference = Math.abs(calculatedTotal - expectedTotal);
  const TOLERANCE = 0.01;

  logger.info('Total validation', {
    orderId: order.orderId,
    calculatedTotal,
    expectedTotal,
    difference: totalDifference,
    isValid: totalDifference <= TOLERANCE,
  });

  if (totalDifference > TOLERANCE) {
    const errorMsg = `Total mismatch: calculated ${calculatedTotal} SAR but expected ${expectedTotal} SAR (difference: ${totalDifference} SAR)`;
    logger.error('Invoice total validation failed', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      calculatedTotal,
      expectedTotal,
      difference: totalDifference,
      items,
    });

    throw new Error(errorMsg);
  }

  // Calculate discount percentage on total
  const subtotal = parseFloat(order.subtotalAmount?.toString() || '0');
  const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;

  // Generate description for refunds
  const description = invoiceType === '26'
    ? `مرتجع رقم ${order.orderNumber || order.orderId}`
    : `فاتورة رقم ${order.orderNumber || order.orderId}`;

  // Use current sync date
  const syncDate = new Date();

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
    datetime_stamp: syncDate.toISOString(),
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

    return {
      success: true,
      erpInvoiceId: parsedResult?.id || parsedResult?.invoice_id || parsedResult?.invoiceId,
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
    if (order.erpSyncedAt && !force) {
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
