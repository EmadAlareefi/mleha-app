import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/salla/create-shipment
 * Creates a shipping policy for an order via Salla orders/actions API
 * Documentation: https://docs.salla.dev/7549669e0
 */
export async function POST(request: NextRequest) {
  try {
    log.info('Create shipment request received');

    const body = await request.json();
    const {
      assignmentId,
      orderId: providedOrderId,
      orderNumber: providedOrderNumber,
      merchantId: providedMerchantId,
    } = body || {};

    log.info('Request body parsed', {
      assignmentId,
      providedOrderId,
      providedOrderNumber,
      providedMerchantId,
    });

    if (!assignmentId && !providedOrderId) {
      log.warn('Missing identifiers in request');
      return NextResponse.json(
        { error: 'يلزم تقديم معرف الطلب أو رقم الطلب' },
        { status: 400 }
      );
    }

    let assignment: Awaited<ReturnType<typeof prisma.orderAssignment.findUnique>> | null = null;

    if (assignmentId) {
      log.info('Fetching assignment from database', { assignmentId });
      assignment = await prisma.orderAssignment.findUnique({
        where: { id: assignmentId },
      });

      if (!assignment) {
        log.warn('Assignment not found, continuing with provided identifiers', {
          assignmentId,
          providedOrderId,
        });
      } else {
        log.info('Assignment found', {
          assignmentId,
          orderId: assignment.orderId,
          orderNumber: assignment.orderNumber,
        });
      }
    }

    const resolvedMerchantId = assignment?.merchantId || providedMerchantId || MERCHANT_ID;
    const targetOrderIdValue =
      assignment?.orderId ??
      (typeof providedOrderId === 'number' || typeof providedOrderId === 'string'
        ? String(providedOrderId)
        : null);

    if (!targetOrderIdValue) {
      log.warn('Missing orderId after resolving data', { assignmentId, providedOrderId });
      return NextResponse.json(
        { error: 'لا يمكن تحديد الطلب المطلوب لإنشاء الشحنة' },
        { status: 400 }
      );
    }

    const targetOrderNumber =
      assignment?.orderNumber ??
      (typeof providedOrderNumber === 'number' || typeof providedOrderNumber === 'string'
        ? String(providedOrderNumber)
        : targetOrderIdValue);

    // Use Salla's orders/actions API to create shipping policy
    // Based on: https://docs.salla.dev/7549669e0
    const parsedOrderId = parseInt(targetOrderIdValue, 10);
    const normalizedOrderId = Number.isNaN(parsedOrderId) ? targetOrderIdValue : parsedOrderId;

    const actionRequestData = {
      operations: [
        {
          action_name: 'create_shipping_policy',
          value: [normalizedOrderId],
        },
      ],
      filters: {
        order_ids: [normalizedOrderId],
      },
    };

    log.info('Creating shipping policy via Salla orders/actions API', {
      assignmentId: assignment?.id ?? assignmentId ?? null,
      orderId: targetOrderIdValue,
      orderNumber: targetOrderNumber,
      requestData: actionRequestData,
    });

    // Call Salla API to create shipping policy
    const response = await sallaMakeRequest<any>(
      resolvedMerchantId,
      '/orders/actions',
      {
        method: 'POST',
        body: JSON.stringify(actionRequestData),
      }
    );

    log.info('Salla API response received', {
      orderId: targetOrderIdValue,
      response: response,
    });

    if (!response || !response.success) {
      const errorMessage = response?.error?.message || response?.message || 'فشل إنشاء سياسة الشحن';

      log.error('Failed to create shipping policy', {
        assignmentId,
        orderId: targetOrderIdValue,
        error: errorMessage,
        response: response,
      });

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          details: response?.error || undefined,
        },
        { status: 400 }
      );
    }

    // Check operation results
    const operations = response.data || [];
    const shipmentOperation = operations.find((op: any) => op.action_name === 'create_shipping_policy');

    if (!shipmentOperation) {
      log.error('No shipping policy operation found in response', {
        orderId: targetOrderIdValue,
        operations,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'لم يتم العثور على عملية إنشاء الشحنة في الاستجابة',
        },
        { status: 400 }
      );
    }

    const operationStatus = String(shipmentOperation.status || '').toLowerCase();
    const operationId = shipmentOperation.operation_id;
    const shipmentStatus = operationStatus;
    const operationMessage =
      typeof shipmentOperation.message === 'string'
        ? shipmentOperation.message
        : typeof response?.message === 'string'
          ? response.message
          : undefined;

    if (operationStatus !== 'success' && operationStatus !== 'in_progress') {
      log.error('Shipping policy creation failed', {
        orderId: targetOrderIdValue,
        operation: shipmentOperation,
      });

      return NextResponse.json(
        {
          success: false,
          error: operationMessage || 'فشل إنشاء سياسة الشحن',
          details: `status=${operationStatus || 'unknown'} | opId=${operationId ?? 'n/a'}`,
        },
        { status: 400 }
      );
    }

    log.info('Shipping policy request accepted by Salla', {
      assignmentId: assignment?.id ?? assignmentId ?? null,
      orderId: targetOrderIdValue,
      operationId,
      shipmentStatus,
    });

    // Update the SallaOrder record
    await prisma.sallaOrder.updateMany({
      where: {
        merchantId: resolvedMerchantId,
        orderId: targetOrderIdValue,
      },
      data: {
        fulfillmentStatus: 'processing',
      },
    });

    // Wait for Salla's webhook to process and store shipment info
    // The webhook will automatically print the label via PrintNode
    let trackingNumber = 'سيتم توفير رقم التتبع قريباً';
    let courierName = 'شركة الشحن المعتمدة';
    let labelPrinted = false;
    let labelUrl: string | null = null;
    let labelPrintedAt: string | null = null;
    let shipment: Awaited<ReturnType<typeof prisma.sallaShipment.findUnique>> | null = null;

    try {
      // Wait 3 seconds for Salla webhook to fire and process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if shipment was created by Salla's webhook
      shipment = await prisma.sallaShipment.findUnique({
        where: {
          merchantId_orderId: {
            merchantId: resolvedMerchantId,
            orderId: targetOrderIdValue,
          },
        },
      });

      if (shipment) {
        const rawShipmentData = shipment.shipmentData as any;
        log.info('Found shipment info from Salla webhook', {
          orderId: targetOrderIdValue,
          trackingNumber: shipment.trackingNumber,
          courierName: shipment.courierName,
        });

        trackingNumber = shipment.trackingNumber || trackingNumber;
        courierName = shipment.courierName || courierName;
        labelPrinted = shipment.labelPrinted || !!rawShipmentData?.label_url;
        labelPrintedAt = shipment.labelPrintedAt ? shipment.labelPrintedAt.toISOString() : null;
        labelUrl = shipment.labelUrl || rawShipmentData?.label_url || rawShipmentData?.label?.url || null;
      } else {
        log.info('No shipment info yet - Salla webhook may still be processing', {
          orderId: targetOrderIdValue,
          operationStatus,
        });
      }
    } catch (lookupError) {
      log.error('Error looking up shipment tracking', {
        orderId: targetOrderIdValue,
        error: lookupError,
      });
      // Continue with placeholder values
    }

    if (!shipment) {
      const pending = operationStatus === 'in_progress';
      const errorMessage = pending
        ? 'تم إرسال الطلب إلى سلة لكنه ما زال قيد المعالجة، يرجى الانتظار ثم الضغط على "تحديث معلومات الطلب".'
        : 'لم نستلم تأكيداً من سلة بأن الشحنة أُنشئت. تحقق من لوحة سلة أو حاول مرة أخرى.';
      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          details: operationMessage || `opId=${operationId ?? 'n/a'}`,
        },
        { status: pending ? 202 : 409 }
      );
    }

    if (assignment) {
      // Update the assignment status to 'shipped' instead of deleting it
      // This allows the order to remain visible until user clicks "go to new order"
      await prisma.orderAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'shipped',
          completedAt: new Date(),
          notes: `تم إنشاء سياسة الشحن - معرف العملية: ${operationId}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: labelPrinted
        ? 'تم إنشاء الشحنة بنجاح وإرسالها للطباعة'
        : 'تم إنشاء سياسة الشحن بنجاح',
      data: {
        operationId,
        status: shipmentStatus,
        trackingNumber,
        courierName,
        labelPrinted,
        labelPrintedAt,
        labelUrl,
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    const errorName = error instanceof Error ? error.name : 'Error';

    log.error('Error creating shipment', {
      name: errorName,
      error: errorMessage,
      stack: errorStack,
    });

    // Always return JSON, never let it fall through to HTML error page
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء إنشاء الشحنة',
        details: process.env.NODE_ENV === 'development' ? `${errorName}: ${errorMessage}` : undefined,
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
