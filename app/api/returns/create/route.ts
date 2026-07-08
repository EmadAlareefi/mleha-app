import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSallaOrder } from '@/app/lib/salla-api';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';
import { getOriginalShippingFee } from '@/lib/returns/fees';
import {
  extractGeneratedReturnTrackingNumber,
  extractGeneratedReturnTrackingNumbers,
} from '@/app/lib/returns/salla-return-tracking';
import { extractSallaTrackingNumber } from '@/app/lib/salla-shipment';
import { extractAppliedCouponCodes } from '@/app/lib/returns/exchange-order';
import {
  buildMissingReturnFeeRateMessage,
  getReturnFeeQuoteForOrder,
  MissingReturnFeeExchangeRateError,
} from '@/app/lib/returns/fee-quote';
import {
  evaluateReturnWindowByProductId,
  getCategoryNamesByProductId,
  getDiscountedProductIds,
  getOutletProductIds,
  resolveReturnDeliveryDate,
} from '@/lib/returns/policy';

export const runtime = 'nodejs';

const CREATE_RETURN_POLICY_ACTION = 'create_return_policy';

interface ReturnItemRequest {
  productId: string;
  productName: string;
  productSku?: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  price: number;
}

interface CreateReturnRequest {
  merchantId: string;
  orderId: string;
  type: 'return' | 'exchange';
  reason: string;
  reasonDetails?: string;
  items: ReturnItemRequest[];

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

interface SallaOrderActionOperation {
  operation_id?: string;
  action_name?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

interface SallaOrderActionsResponse {
  status?: number;
  success?: boolean;
  data?: SallaOrderActionOperation[];
  message?: string;
  error?: {
    message?: string;
    [key: string]: unknown;
  };
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
    if (!body.merchantId || !body.orderId || !body.type || !body.reason || !body.items || body.items.length === 0) {
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
        type: body.type,
      });

      return NextResponse.json({
        error: 'هذا الطلب تم استبداله مسبقاً ولا يمكن إرجاعه أو استبداله مرة أخرى',
        errorCode: 'ORDER_ALREADY_EXCHANGED',
        message: 'تم استخدام كوبون استبدال على هذا الطلب سابقاً، لذلك لا يمكن إنشاء طلب إرجاع أو استبدال جديد له.',
      }, { status: 400 });
    }

    const selectedProductIds = body.items.map((item) => item.productId).filter(Boolean);
    const selectedCategoriesByProductId = await getCategoryNamesByProductId(body.merchantId, selectedProductIds);
    const outletProductIds = getOutletProductIds(selectedCategoriesByProductId);
    const outletItem = body.items.find((item) => outletProductIds.has(item.productId));
    if (outletItem && body.type === 'return') {
      log.warn('Rejected return request for outlet category item', {
        merchantId: body.merchantId,
        orderId: body.orderId,
        productId: outletItem.productId,
        productName: outletItem.productName,
        categories: selectedCategoriesByProductId[outletItem.productId],
        type: body.type,
      });

      return NextResponse.json({
        error: 'منتجات اوتليت مليحة متاحة للاستبدال فقط',
        errorCode: 'OUTLET_CATEGORY_EXCHANGE_ONLY',
        message: 'لا يمكن إرجاع منتجات اوتليت مليحة. يمكنك إنشاء طلب استبدال فقط.',
        productId: outletItem.productId,
        productName: outletItem.productName,
      }, { status: 400 });
    }

    const discountedProductIds = getDiscountedProductIds(selectedCategoriesByProductId);
    const discountedItem = body.items.find((item) => discountedProductIds.has(item.productId));
    if (discountedItem) {
      log.warn('Rejected return request for discounted category item', {
        merchantId: body.merchantId,
        orderId: body.orderId,
        productId: discountedItem.productId,
        productName: discountedItem.productName,
        categories: selectedCategoriesByProductId[discountedItem.productId],
        type: body.type,
      });

      return NextResponse.json({
        error: 'منتجات التخفيضات غير قابلة للإرجاع أو الاستبدال',
        errorCode: 'DISCOUNTED_CATEGORY_NOT_RETURNABLE',
        message: 'لا يمكن إرجاع أو استبدال المنتجات ضمن فئات التخفيضات.',
        productId: discountedItem.productId,
        productName: discountedItem.productName,
      }, { status: 400 });
    }

    // Check if shipment delivery date exceeds the category-specific return window.
    const deliveryDateResult = await resolveReturnDeliveryDate(body.merchantId, order as any);
    const deliveryDate = deliveryDateResult.date;

    if (!deliveryDate) {
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

    // Evaluate the return window per selected item using each product's own category, so a
    // mix of evening dresses (24h) and other categories (3 days) only blocks the items whose
    // own window has expired — not the whole selection.
    const selectedWindowEvaluations = evaluateReturnWindowByProductId({
      categoriesByProductId: selectedCategoriesByProductId,
      deliveryDate,
    });

    log.info('Using shipment delivery date for return window validation', {
      merchantId: body.merchantId,
      orderId: body.orderId,
      dateSource: deliveryDateResult.source,
      normalizedDate: deliveryDate.toISOString(),
      selectedCategoriesByProductId,
    });

    const expiredItem = body.items.find((item) => {
      const evaluation = selectedWindowEvaluations[item.productId];
      return evaluation && !evaluation.eligible;
    });

    if (expiredItem) {
      const evaluation = selectedWindowEvaluations[expiredItem.productId];

      log.warn('Selected item exceeds allowed return window', {
        merchantId: body.merchantId,
        orderId: body.orderId,
        productId: expiredItem.productId,
        productName: expiredItem.productName,
        deliveryDate: deliveryDate.toISOString(),
        deliveryDateSource: deliveryDateResult.source,
        elapsedHours: evaluation.elapsedHours.toFixed(2),
        policyWindowHours: evaluation.policy.windowHours,
      });

      return NextResponse.json({
        error: 'انتهت مدة الإرجاع المسموحة',
        errorCode: 'RETURN_PERIOD_EXPIRED',
        message: evaluation.policy.message,
        productId: expiredItem.productId,
        productName: expiredItem.productName,
        daysSinceDelivery: Math.floor(evaluation.daysSinceDelivery),
        elapsedHours: Math.floor(evaluation.elapsedHours),
        allowedHours: evaluation.policy.windowHours,
        deliveryDate: deliveryDate.toISOString(),
        deliveryDateSource: deliveryDateResult.source,
      }, { status: 400 });
    }

    // Validate order status - should be delivered or completed
    const returnableStatuses = ['delivered', 'completed'];
    if (!returnableStatuses.includes(order.status.slug.toLowerCase())) {
      return NextResponse.json(
        { error: 'هذا الطلب غير قابل للإرجاع. يجب أن يكون الطلب مكتملاً أو تم تسليمه.' },
        { status: 400 }
      );
    }

    const orderReference = String(order.reference_id || order.id);

    // Calculate total items amount
    const totalItemsAmount = body.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // The order total returned to the customer is items + the original shipping
    // they paid (gross, incl. VAT). From that we deduct the two shipment legs:
    // the original outbound shipment + the return/exchange shipment.
    const originalShipping = getOriginalShippingFee(order.amounts);
    const orderTotal = totalItemsAmount + originalShipping;

    // Flat policy fee is configured in SAR, then converted into the order currency.
    let feeQuote;
    try {
      feeQuote = getReturnFeeQuoteForOrder(order, body.type);
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
    const returnFee = feeQuote.processingFee;

    // Calculate total refund: (items + original shipping) - return fee
    const totalRefundAmount = Math.max(0, orderTotal - returnFee);

    const parsedOrderId = parseInt(body.orderId, 10);
    const normalizedOrderId = Number.isNaN(parsedOrderId) ? body.orderId : parsedOrderId;
    const actionRequestData = {
      operations: [
        {
          action_name: CREATE_RETURN_POLICY_ACTION,
          value: [normalizedOrderId],
        },
      ],
      filters: {
        order_ids: [normalizedOrderId],
      },
    };

    log.info('Creating Salla return policy', {
      orderId: body.orderId,
      orderReference,
      actionRequestData,
    });

    const actionResponse = await sallaMakeRequest<SallaOrderActionsResponse>(
      body.merchantId,
      '/orders/actions',
      {
        method: 'POST',
        body: JSON.stringify(actionRequestData),
      }
    );

    if (!actionResponse || !actionResponse.success) {
      const errorMessage =
        actionResponse?.error?.message ||
        actionResponse?.message ||
        'فشل إنشاء سياسة الإرجاع';

      log.error('Salla return policy creation failed', {
        orderId: body.orderId,
        error: errorMessage,
        response: actionResponse,
      });

      return NextResponse.json(
        {
          error: errorMessage,
          details: actionResponse?.error || undefined,
        },
        { status: 400 }
      );
    }

    const operations = Array.isArray(actionResponse.data) ? actionResponse.data : [];
    const returnPolicyOperation =
      operations.find((op) => op.action_name === CREATE_RETURN_POLICY_ACTION) ??
      (operations.length === 1 ? operations[0] : undefined);

    if (!returnPolicyOperation) {
      log.error('No return policy operation found in Salla response', {
        orderId: body.orderId,
        operations,
      });

      return NextResponse.json(
        { error: 'لم يتم العثور على عملية إنشاء سياسة الإرجاع في استجابة سلة' },
        { status: 400 }
      );
    }

    const operationStatus = String(returnPolicyOperation.status || '').toLowerCase();
    const operationId = returnPolicyOperation.operation_id;
    const operationMessage =
      typeof returnPolicyOperation.message === 'string'
        ? returnPolicyOperation.message
        : typeof actionResponse.message === 'string'
          ? actionResponse.message
          : undefined;

    if (operationStatus !== 'success' && operationStatus !== 'in_progress') {
      log.error('Salla return policy operation failed', {
        orderId: body.orderId,
        operation: returnPolicyOperation,
      });

      return NextResponse.json(
        {
          error: operationMessage || 'فشل إنشاء سياسة الإرجاع',
          details: `status=${operationStatus || 'unknown'} | opId=${operationId ?? 'n/a'}`,
        },
        { status: 400 }
      );
    }

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
        customerPhone: order.customer.mobile ? String(order.customer.mobile) : '',

        type: body.type,
        status: 'pending_review',
        reason: body.reason,
        reasonDetails: body.reasonDetails,

        smsaTrackingNumber: generatedReturnTrackingNumber,
        smsaAwbNumber: generatedReturnTrackingNumber,
        smsaResponse: {
          provider: 'salla',
          action: CREATE_RETURN_POLICY_ACTION,
          operationId: operationId ?? null,
          operationStatus,
          trackingNumber: generatedReturnTrackingNumber,
          operation: returnPolicyOperation,
          request: actionRequestData,
          response: actionResponse,
        } as any,

        totalRefundAmount,
        returnFee,
        shippingAmount: originalShipping,
        currency: feeQuote.currency,
        feeExchangeRate: feeQuote.exchangeRate,
        feeExchangeRateSource: feeQuote.exchangeRateSource,

        items: {
          create: body.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            variantId: item.variantId,
            variantName: item.variantName,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    log.info('Return request created successfully', {
      returnRequestId: returnRequest.id,
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
        currency: returnRequest.currency,
        returnFee: returnRequest.returnFee,
        createdAt: returnRequest.createdAt,
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
