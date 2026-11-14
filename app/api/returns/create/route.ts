import { isReturnableOrderStatus } from '@/lib/returns/order-status';
import { ONE_RIYAL_OFFER_ERROR } from '@/lib/returns/categories';
import { NextRequest, NextResponse } from 'next/server';
import { areExchangeOrdersEnabled } from '@/app/lib/settings';
import { prisma } from '@/lib/prisma';
import { getSallaOrder } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { getOriginalShippingFee } from '@/lib/returns/fees';
import {
  deriveRequestType,
  legacyItemsToPieces,
  resolveRequestedPieces,
  type RequestedPiece,
  type ResolvedPiece,
} from '@/lib/returns/pieces';
import { splitRequestFinancials } from '@/lib/returns/request-financials';
import { loadPieceRules } from '@/app/lib/returns/piece-context';
import {
  createExchangeOrderForRequest,
  EXCHANGE_PAYMENT_METHODS,
  priceExchangeCart,
  type RequestedExchangeLine,
} from '@/app/lib/returns/exchange-order-flow';
import { planExchangeSettlement } from '@/lib/returns/exchange-settlement';
import { returnStatusPath } from '@/app/lib/returns/status-token';
import {
  isPhoneProofRequired,
  orderBelongsToPhone,
} from '@/app/lib/returns/customer-phone';
import {
  extractGeneratedReturnTrackingNumber,
  extractGeneratedReturnTrackingNumbers,
} from '@/app/lib/returns/salla-return-tracking';
import { extractSallaTrackingNumber } from '@/app/lib/salla-shipment';
import { extractAppliedCouponCodes } from '@/app/lib/returns/exchange-order';
import { normalizePhoneWithDialCode } from '@/app/lib/phone';
import {
  buildMissingReturnFeeRateMessage,
  getReturnFeeQuoteForOrder,
  MissingReturnFeeExchangeRateError,
} from '@/app/lib/returns/fee-quote';
import {
  CREATE_RETURN_POLICY_ACTION,
  requestSallaReturnPolicy,
} from '@/app/lib/returns/salla-return-policy';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';
import { cancelAjexShipment, type AjexShipmentResult } from '@/app/lib/ajex-api';
import {
  bookAjexReturnShipment,
  buildAjexSmsaResponse,
  publishAjexReturnLabel,
} from '@/app/lib/returns/ajex-return-shipment';
import {
  resolveReturnShipmentProvider,
  type ReturnShipmentProvider,
} from '@/lib/returns/return-provider';

export const runtime = 'nodejs';

interface ReturnItemRequest {
  /**
   * Salla order-item id. The only key that maps a submitted line back to the
   * order unambiguously: `productId` can repeat across lines of the same
   * product in different variants, and the browser falls back to the item id
   * when Salla omits the product object, so the two id spaces overlap.
   */
  orderItemId: number | string;
  productId: string;
  quantity: number;
  ribbonRemoved: boolean[];
}

interface CreateReturnRequest {
  merchantId: string;
  orderId: string;
  /** Pre-v2 payloads only: one type for the whole request. */
  type?: 'return' | 'exchange';
  reason: string;
  reasonDetails?: string;
  /** Pre-v2 payloads only. */
  items?: ReturnItemRequest[];
  /** v2: one entry per physical piece, each with its own type. */
  pieces?: RequestedPiece[];
  /** v3: replacements for the exchange pieces instead of a coupon. */
  exchange?: {
    mode?: 'order' | 'coupon';
    lines?: RequestedExchangeLine[];
    paymentMethod?: string;
  };
  /** Proof the requester owns the order; see `RETURNS_REQUIRE_PHONE`. */
  customerMobile?: string;

  // Merchant/warehouse address for return shipment destination
  merchantName: string;
  merchantPhone: string;
  merchantAddress: string;
  merchantCity: string;
  merchantAddressLine2?: string;
  merchantDistrict?: string;
  merchantPostalCode?: string;
  merchantCountry?: string;
  merchantCoordinates?: string;
}

/**
 * POST /api/returns/create
 *
 * Creates a return/exchange request:
 * 1. Validates the order
 * 2. Creates Salla return policy
 * 3. Stores return request in database
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateReturnRequest = await request.json();

    // Validate required fields
    const hasPieces = Array.isArray(body.pieces) && body.pieces.length > 0;
    const hasLegacyItems = Boolean(body.type) && Array.isArray(body.items) && body.items.length > 0;
    if (!body.merchantId || !body.orderId || !body.reason || (!hasPieces && !hasLegacyItems)) {
      return NextResponse.json(
        { error: 'الرجاء تقديم جميع الحقول المطلوبة' },
        { status: 400 }
      );
    }

    if (!body.merchantName || !body.merchantPhone || !body.merchantAddress || !body.merchantCity) {
      return NextResponse.json(
        { error: 'معلومات عنوان المرتجع مطلوبة' },
        { status: 400 }
      );
    }

    // Check if multiple return requests are allowed
    let allowMultiple = false;
    try {
      const multipleSetting = await prisma.settings.findUnique({
        where: { key: 'allow_multiple_return_requests' },
      });
      if (multipleSetting && multipleSetting.value === 'true') {
        allowMultiple = true;
      }
    } catch (err) {
      log.warn('Failed to fetch multiple requests setting', { error: err });
    }

    // If multiple requests are not allowed, check if there's already a request for this order
    if (!allowMultiple) {
      const existingRequest = await prisma.returnRequest.findFirst({
        where: {
          orderId: body.orderId.toString(),
          merchantId: body.merchantId,
          status: {
            notIn: ['rejected', 'cancelled'], // Don't count rejected/cancelled requests
          },
        },
      });

      if (existingRequest) {
        return NextResponse.json(
          { error: 'يوجد طلب إرجاع نشط لهذا الطلب. لا يمكن إنشاء طلب جديد.' },
          { status: 400 }
        );
      }
    }

    // Fetch order from Salla to validate and get customer details
    log.info('Fetching order from Salla', { merchantId: body.merchantId, orderId: body.orderId });

    const order = await getSallaOrder(body.merchantId, body.orderId);

    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب' },
        { status: 404 }
      );
    }

    // Orders that already carry an exchange coupon (EX…) are the result of a
    // previous exchange and cannot be returned or exchanged again.
    const appliedCouponCodes = extractAppliedCouponCodes(order as any);
    if (appliedCouponCodes.some((code) => code.toUpperCase().startsWith('EX'))) {
      log.warn('Rejected return/exchange request for already-exchanged order', {
        merchantId: body.merchantId,
        orderId: body.orderId,
      });

      return NextResponse.json({
        error: 'هذا الطلب تم استبداله مسبقاً ولا يمكن إرجاعه أو استبداله مرة أخرى',
        errorCode: 'ORDER_ALREADY_EXCHANGED',
        message: 'تم استخدام كوبون استبدال على هذا الطلب سابقاً، لذلك لا يمكن إنشاء طلب إرجاع أو استبدال جديد له.',
      }, { status: 400 });
    }

    // Proof the requester owns this order. The lookup endpoint applies the same
    // check, but this route takes a raw order id and is reachable on its own.
    if (isPhoneProofRequired() && !orderBelongsToPhone(order, body.customerMobile)) {
      log.warn('Rejected return request without matching customer mobile', {
        merchantId: body.merchantId,
        orderId: body.orderId,
      });

      return NextResponse.json(
        { error: 'رقم الجوال لا يطابق الطلب' },
        { status: 403 }
      );
    }

    // Match every submitted piece back to the order and price it from the
    // order. Nothing in the request body influences the refund. Browsers still
    // on the pre-v2 bundle send one type plus per-line quantities.
    const requestedPieces = Array.isArray(body.pieces) && body.pieces.length > 0
      ? body.pieces
      : legacyItemsToPieces(body.items, body.type);

    const pieceRules = await loadPieceRules(body.merchantId, order);
    const deliveryDateResult = pieceRules.deliveryDateResult;
    const deliveryDate = deliveryDateResult.date;

    if (!deliveryDate && !pieceRules.windowOverride) {
      log.error('No delivery date found for return window validation', {
        merchantId: body.merchantId,
        orderId: body.orderId,
        orderDateCandidates: deliveryDateResult.fallbackCandidates,
      });

      return NextResponse.json({
        error: 'لا يمكن التحقق من تاريخ الطلب',
        errorCode: 'MISSING_ORDER_DATE',
        message: 'لم يتم العثور على تاريخ وصول الشحنة للتحقق من صلاحية الإرجاع.',
      }, { status: 400 });
    }

    const resolution = resolveRequestedPieces(order, requestedPieces, {
      rules: pieceRules.rules,
      claimed: pieceRules.claimed,
    });

    if (!resolution.ok) {
      log.warn('Rejected return request piece', {
        merchantId: body.merchantId,
        orderId: body.orderId,
        code: resolution.code,
        orderItemId: resolution.piece?.orderItemId,
        unitIndex: resolution.piece?.unitIndex,
        productId: resolution.piece?.productId,
      });

      return NextResponse.json({
        error: resolution.code === 'ONE_RIYAL_OFFER' ? ONE_RIYAL_OFFER_ERROR : resolution.error,
        errorCode: PIECE_ERROR_CODES[resolution.code] ?? resolution.code,
        message: resolution.error,
        productId: resolution.piece?.productId,
        productName: resolution.piece?.productName,
        orderItemId: resolution.piece?.orderItemId,
        unitIndex: resolution.piece?.unitIndex,
      }, { status: 400 });
    }

    const resolvedPieces = resolution.pieces;
    const requestType = deriveRequestType(resolvedPieces.map((piece) => piece.type));
    // Lines and quantities for the carrier waybill.
    const resolvedItems = groupPiecesIntoLines(resolvedPieces);

    // Allow shipped/delivering orders when the carrier's Salla update is missing.
    if (!isReturnableOrderStatus(order.status)) {
      return NextResponse.json(
        { error: 'هذا الطلب غير قابل للإرجاع. يجب أن يكون الطلب مكتملاً أو تم توصيله أو جاري توصيله أو تم شحنه.' },
        { status: 400 }
      );
    }

    const orderReference = String(order.reference_id || order.id);

    // Start from what the customer paid for the selected pieces plus original
    // shipping, then deduct one processing fee (one return shipment). Return
    // pieces become money, exchange pieces become coupon credit.
    const originalShipping = getOriginalShippingFee(order.amounts);

    // Flat policy fee is configured in SAR, then converted into the order currency.
    let feeQuote;
    let exchangeFeeQuote;
    try {
      feeQuote = getReturnFeeQuoteForOrder(order, requestType === 'exchange' ? 'exchange' : 'return');
      exchangeFeeQuote = getReturnFeeQuoteForOrder(order, 'exchange');
    } catch (error) {
      if (error instanceof MissingReturnFeeExchangeRateError) {
        return NextResponse.json(
          {
            error: buildMissingReturnFeeRateMessage(error.currency),
            errorCode: 'MISSING_RETURN_FEE_EXCHANGE_RATE',
          },
          { status: 400 },
        );
      }
      throw error;
    }

    const split = splitRequestFinancials({
      pieces: resolvedPieces.map((piece) => ({ type: piece.type, price: piece.unitPrice })),
      originalShipping,
      returnProcessingFee: feeQuote.processingFee,
      exchangeProcessingFee: exchangeFeeQuote.processingFee,
    });
    const returnFee = split.processingFee;
    // Pre-v2 meaning kept: for an exchange-only request this is the credit.
    const totalRefundAmount = requestType === 'exchange' ? split.couponAmount : split.refundAmount;
    const declaredValue = split.refundAmount + split.couponAmount;

    // Exchange v3: replacements picked in the form, priced from Salla now so a
    // stock or price problem is reported before the return shipment is booked.
    const wantsExchangeOrder =
      body.exchange?.mode === 'order' && resolvedPieces.some((piece) => piece.type === 'exchange');
    let exchangeCart: Extract<Awaited<ReturnType<typeof priceExchangeCart>>, { ok: true }> | null = null;
    const exchangePaymentMethod =
      typeof body.exchange?.paymentMethod === 'string' ? body.exchange.paymentMethod : null;
    if (wantsExchangeOrder && !(await areExchangeOrdersEnabled())) {
      return NextResponse.json(
        {
          error: 'الاستبدال بطلب جديد غير متاح حالياً؛ سيكون الاستبدال بكوبون. أرسلي الطلب مرة أخرى.',
          errorCode: 'EXCHANGE_ORDERS_DISABLED',
        },
        { status: 409 },
      );
    }
    if (wantsExchangeOrder) {
      const priced = await priceExchangeCart(body.merchantId, body.exchange?.lines);
      if (!priced.ok) {
        return NextResponse.json({ error: priced.error, errorCode: 'EXCHANGE_CART_INVALID' }, { status: 400 });
      }
      const settlement = planExchangeSettlement(split.couponAmount, priced.total);
      if (settlement.needsPayment && (!exchangePaymentMethod || !EXCHANGE_PAYMENT_METHODS.includes(exchangePaymentMethod))) {
        return NextResponse.json(
          { error: 'الرجاء اختيار طريقة دفع الفرق', errorCode: 'EXCHANGE_PAYMENT_METHOD_REQUIRED' },
          { status: 400 },
        );
      }
      exchangeCart = priced;
    }

    const parsedOrderId = parseInt(body.orderId, 10);
    const normalizedOrderId = Number.isNaN(parsedOrderId) ? body.orderId : parsedOrderId;

    // Orders AJEX delivered are returned through AJEX directly; every other
    // courier keeps Salla's `create_return_policy` flow.
    let shipmentProvider: ReturnShipmentProvider = 'salla';
    try {
      shipmentProvider = await resolveReturnShipmentProvider(body.merchantId, order);
    } catch (err) {
      log.warn('Failed to resolve return shipment provider', { orderId: body.orderId, error: err });
    }

    let generatedReturnTrackingNumber: string | null;
    let smsaResponse: Record<string, unknown>;
    let operationId: string | undefined;
    let operationStatus: string | undefined;
    let ajexShipment: AjexShipmentResult | null = null;

    if (shipmentProvider === 'ajex') {
      ajexShipment = await bookAjexReturnShipment({
        merchantId: body.merchantId,
        order,
        // The lines and quantities the customer selected on /returns.
        items: resolvedItems,
        declaredValue,
        currency: feeQuote.currency,
      });

      if (!ajexShipment.success || !ajexShipment.trackingNumber) {
        log.error('AJEX return shipment creation failed', {
          orderId: body.orderId,
          error: ajexShipment.error,
          errorCode: ajexShipment.errorCode,
        });
        return NextResponse.json(
          { error: 'تعذر إنشاء بوليصة الإرجاع مع أجكس. حاول مرة أخرى لاحقاً.', details: ajexShipment.error },
          { status: 400 }
        );
      }

      generatedReturnTrackingNumber = ajexShipment.trackingNumber;
      smsaResponse = buildAjexSmsaResponse(ajexShipment);
    } else {
      const sallaResult = await requestSallaReturnPolicyShipment(
        body,
        order,
        normalizedOrderId,
        orderReference
      );
      if ('errorResponse' in sallaResult) return sallaResult.errorResponse;
      ({ generatedReturnTrackingNumber, smsaResponse, operationId, operationStatus } = sallaResult);
    }

    // Update Salla order status to 'restoring' (قيد الاسترجاع)
    try {
      const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
      const accessToken = await getSallaAccessToken(body.merchantId);

      if (accessToken) {
        const baseUrl = 'https://api.salla.dev/admin/v2';
        const url = `${baseUrl}/orders/${body.orderId}/status`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ slug: 'restoring' }),
        });

        if (response.ok) {
          log.info('Salla order status updated to restoring', {
            orderId: body.orderId,
          });
        } else {
          const errorText = await response.text();
          log.warn('Failed to update Salla order status to restoring', {
            orderId: body.orderId,
            status: response.status,
            error: errorText,
          });
        }
      }
    } catch (error) {
      log.error('Error updating Salla order status to restoring', {
        orderId: body.orderId,
        error
      });
      // Continue with return request creation even if Salla update fails
    }

    // Store return request in database
    log.info('Storing return request in database', {
      orderId: body.orderId,
      sallaReturnPolicyOperationId: operationId,
    });

    const returnRequest = await prisma.returnRequest.create({
      data: {
        merchantId: body.merchantId,
        orderId: body.orderId.toString(),
        orderNumber: order.reference_id ? String(order.reference_id) : order.id.toString(),
        customerId: order.customer.id.toString(),
        customerName: `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim(),
        customerEmail: order.customer.email ? String(order.customer.email) : '',
        customerPhone: normalizePhoneWithDialCode(
          order.customer.mobile ?? order.customer.phone,
          order.customer.mobile_code ??
            order.customer.mobileCode ??
            order.customer.phone_code ??
            order.customer.phoneCode ??
            order.customer.dial_code ??
            order.customer.dialCode ??
            order.customer.country_code ??
            order.customer.countryCode,
        ),

        type: requestType,
        status: 'pending_review',
        reason: body.reason,
        reasonDetails: body.reasonDetails,

        smsaTrackingNumber: generatedReturnTrackingNumber,
        smsaAwbNumber: generatedReturnTrackingNumber,
        smsaResponse: smsaResponse as any,

        totalRefundAmount,
        couponAmount: split.couponAmount > 0 ? split.couponAmount : null,
        ...(exchangeCart
          ? {
              exchangeMode: 'order',
              exchangeCreditAmount: split.couponAmount,
              exchangePaymentMethod,
              exchangeLines: {
                create: exchangeCart.lines.map((line) => ({
                  productId: line.productId,
                  skuId: line.skuId,
                  sku: line.sku,
                  name: line.name,
                  variantName: line.variantName,
                  imageUrl: line.imageUrl,
                  options: line.options,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  currency: line.currency,
                })),
              },
            }
          : {}),
        returnFee,
        shippingAmount: originalShipping,
        currency: feeQuote.currency,
        feeExchangeRate: feeQuote.exchangeRate,
        feeExchangeRateSource: feeQuote.exchangeRateSource,

        items: {
          // One row per piece so each can be inspected, refunded and restocked on its own.
          create: resolvedPieces.map((piece) => ({
            orderItemId: piece.orderItemId,
            unitIndex: piece.unitIndex,
            type: piece.type,
            ribbonRemoved: false,
            productId: piece.productId,
            productName: piece.productName,
            productSku: piece.productSku,
            variantId: piece.variantId,
            variantName: piece.variantName,
            quantity: 1,
            price: piece.unitPrice,
          })),
        },
      },
      include: {
        items: true,
      },
    }).catch(async (error) => {
      // Don't leave a booked AJEX pickup behind for a request that was never stored.
      if (ajexShipment?.trackingNumber) {
        await cancelAjexShipment(ajexShipment.trackingNumber).catch(() => undefined);
      }
      throw error;
    });

    // Jeddah orders delivered by our own agent are collected by that agent.
    await syncLocalReturnPickupTask(returnRequest.id);

    if (ajexShipment) {
      // AJEX hands the waybill back synchronously, so the label goes out now
      // instead of waiting on the backfill cron.
      await publishAjexReturnLabel(returnRequest, ajexShipment, 'returns-create-ajex').catch((error) =>
        log.error('Failed to publish AJEX return label', { returnRequestId: returnRequest.id, error })
      );
    }

    // The return is stored; now the replacement order. A failure falls back to
    // the classic coupon and never undoes the return itself.
    const exchangeOrder = exchangeCart ? await createExchangeOrderForRequest(returnRequest.id) : null;

    log.info('Return request created successfully', {
      returnRequestId: returnRequest.id,
      shipmentProvider,
      sallaReturnPolicyOperationId: operationId,
      sallaReturnPolicyStatus: operationStatus,
      generatedReturnTrackingNumber,
    });

    return NextResponse.json({
      success: true,
      returnRequest: {
        id: returnRequest.id,
        orderNumber: returnRequest.orderNumber,
        type: returnRequest.type,
        status: returnRequest.status,
        smsaTrackingNumber: returnRequest.smsaTrackingNumber,
        smsaLabelDataUrl: null,
        sallaReturnPolicyOperationId: operationId,
        sallaReturnPolicyStatus: operationStatus,
        totalRefundAmount: returnRequest.totalRefundAmount,
        refundAmount: split.refundAmount,
        couponAmount: split.couponAmount,
        currency: returnRequest.currency,
        returnFee: returnRequest.returnFee,
        createdAt: returnRequest.createdAt,
        statusUrl: returnStatusPath(returnRequest.id),
        exchangeOrder: exchangeOrder
          ? exchangeOrder.ok
            ? {
                created: true,
                orderNumber: exchangeOrder.orderNumber,
                amountDue: exchangeOrder.amountDue,
                paymentUrl: exchangeOrder.paymentUrl,
                leftover: exchangeOrder.leftover,
              }
            : { created: false, fellBackToCoupon: true }
          : null,
      },
    });

  } catch (error) {
    log.error('Error creating return request', {
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء طلب الإرجاع' },
      { status: 500 }
    );
  }
}

/** Asks Salla to issue the return waybill (`create_return_policy`). */
async function requestSallaReturnPolicyShipment(
  body: CreateReturnRequest,
  order: NonNullable<Awaited<ReturnType<typeof getSallaOrder>>>,
  normalizedOrderId: string | number,
  orderReference: string
) {
  const policyResult = await requestSallaReturnPolicy(body.merchantId, body.orderId);

  if (!policyResult.success) {
    return {
      errorResponse: NextResponse.json(
        { error: policyResult.error, details: policyResult.details },
        { status: 400 }
      ),
    };
  }

  const actionRequestData = policyResult.request;
  const actionResponse = policyResult.response;
  const returnPolicyOperation = policyResult.operation;
  const operationStatus = policyResult.operationStatus;
  const operationId = policyResult.operationId;

  // The `create_return_policy` action response echoes the existing order, which
  // still carries the ORIGINAL (outbound) shipment's tracking number/link. Salla
  // issues the return waybill (بوليصة الرجيع) asynchronously, so it is usually not
  // in this response yet. Without excluding the outbound tracking, the extractor
  // would latch onto it and link the original shipment's label to the return
  // request. Collect every tracking value already present on the order and exclude
  // it, so we only accept a genuinely new (return) tracking number here — otherwise
  // the value stays null and the return-type-filtered backfill in
  // /api/returns/check and /api/returns/tracking-status populates it later.
  const originalOrderTrackingNumbers = Array.from(
    new Set(
      [
        extractSallaTrackingNumber(order as any),
        ...extractGeneratedReturnTrackingNumbers(order),
      ].filter((value): value is string => Boolean(value))
    )
  );

  const generatedReturnTrackingNumber = extractGeneratedReturnTrackingNumber(
    {
      operation: returnPolicyOperation,
      response: actionResponse,
    },
    [
      body.orderId,
      normalizedOrderId,
      order.id,
      order.reference_id,
      orderReference,
      operationId,
      ...originalOrderTrackingNumbers,
    ]
  );

  return {
    generatedReturnTrackingNumber,
    operationId,
    operationStatus,
    smsaResponse: {
      provider: 'salla',
      action: CREATE_RETURN_POLICY_ACTION,
      operationId: operationId ?? null,
      operationStatus,
      trackingNumber: generatedReturnTrackingNumber,
      operation: returnPolicyOperation,
      request: actionRequestData,
      response: actionResponse,
    } as Record<string, unknown>,
  };
}

const PIECE_ERROR_CODES: Record<string, string> = {
  ONE_RIYAL_OFFER: 'ONE_RIYAL_OFFER_NOT_RETURNABLE',
  DISCOUNTED_CATEGORY: 'DISCOUNTED_CATEGORY_NOT_RETURNABLE',
  EXCHANGE_ONLY: 'EXCHANGE_ONLY_ITEM',
  RETURN_ONLY: 'RETURN_ONLY_ITEM',
  RETURN_PERIOD_EXPIRED: 'RETURN_PERIOD_EXPIRED',
  RIBBON_REMOVED: 'PROTECTION_RIBBON_REMOVED',
  ALREADY_REQUESTED: 'PIECE_ALREADY_REQUESTED',
};

/** Pieces back to order lines with quantities, for the carrier waybill. */
function groupPiecesIntoLines(pieces: ResolvedPiece[]) {
  const lines = new Map<string, { productId: string; productName: string; productSku?: string; variantId?: string; variantName?: string; quantity: number; price: number }>();
  for (const piece of pieces) {
    const line = lines.get(piece.orderItemId);
    if (line) {
      line.quantity += 1;
    } else {
      lines.set(piece.orderItemId, {
        productId: piece.productId,
        productName: piece.productName,
        productSku: piece.productSku,
        variantId: piece.variantId,
        variantName: piece.variantName,
        quantity: 1,
        price: piece.unitPrice,
      });
    }
  }
  return Array.from(lines.values());
}
