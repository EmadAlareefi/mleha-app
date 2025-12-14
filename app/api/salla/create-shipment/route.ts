import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/salla/create-shipment
 * Creates a shipping policy for an order via Salla orders/actions API
 * Documentation: https://docs.salla.dev/7549669e0
 */
export async function POST(request: NextRequest) {
  try {
    log.info('Create shipment request received');

    const body = await request.json();
    const { assignmentId } = body;

    log.info('Request body parsed', { assignmentId });

    if (!assignmentId) {
      log.warn('Missing assignmentId in request');
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
        { status: 400 }
      );
    }

    // Get assignment with order data
    log.info('Fetching assignment from database', { assignmentId });
    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      log.warn('Assignment not found', { assignmentId });
      return NextResponse.json(
        { error: 'الطلب غير موجود' },
        { status: 404 }
      );
    }

    log.info('Assignment found', {
      assignmentId,
      orderId: assignment.orderId,
      orderNumber: assignment.orderNumber
    });

    // Use Salla's orders/actions API to create shipping policy
    // Based on: https://docs.salla.dev/7549669e0
    const actionRequestData = {
      operations: [
        {
          action_name: 'create_shipping_policy',
        },
      ],
      filters: {
        order_ids: [parseInt(assignment.orderId)],
      },
    };

    log.info('Creating shipping policy via Salla orders/actions API', {
      assignmentId,
      orderId: assignment.orderId,
      orderNumber: assignment.orderNumber,
      requestData: actionRequestData,
    });

    // Call Salla API to create shipping policy
    const response = await sallaMakeRequest<any>(
      assignment.merchantId,
      '/orders/actions',
      {
        method: 'POST',
        body: JSON.stringify(actionRequestData),
      }
    );

    log.info('Salla API response received', {
      orderId: assignment.orderId,
      response: response,
    });

    if (!response || !response.success) {
      const errorMessage = response?.error?.message || response?.message || 'فشل إنشاء سياسة الشحن';

      log.error('Failed to create shipping policy', {
        assignmentId,
        orderId: assignment.orderId,
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
        orderId: assignment.orderId,
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

    if (shipmentOperation.status !== 'success' && shipmentOperation.status !== 'in_progress') {
      log.error('Shipping policy creation failed', {
        orderId: assignment.orderId,
        operation: shipmentOperation,
      });

      return NextResponse.json(
        {
          success: false,
          error: shipmentOperation.message || 'فشل إنشاء سياسة الشحن',
        },
        { status: 400 }
      );
    }

    const operationId = shipmentOperation.operation_id;
    const shipmentStatus = shipmentOperation.status;

    log.info('Shipping policy created successfully', {
      assignmentId,
      orderId: assignment.orderId,
      operationId,
      shipmentStatus,
    });

    // Update the SallaOrder record
    await prisma.sallaOrder.updateMany({
      where: {
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
      },
      data: {
        fulfillmentStatus: 'processing',
      },
    });

    // Update the assignment status to 'shipped' instead of deleting it
    // This allows the order to remain visible until user clicks "go to new order"
    await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'shipped',
        completedAt: new Date(),
        notes: `تم إنشاء سياسة الشحن - معرف العملية: ${operationId}`,
      },
    });

    // Wait for Salla's webhook to process and store shipment info
    // The webhook will automatically print the label via PrintNode
    let trackingNumber = 'سيتم توفير رقم التتبع قريباً';
    let courierName = 'شركة الشحن المعتمدة';
    let labelPrinted = false;

    try {
      // Wait 3 seconds for Salla webhook to fire and process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if shipment was created by Salla's webhook
      const shipment = await prisma.sallaShipment.findUnique({
        where: {
          merchantId_orderId: {
            merchantId: assignment.merchantId,
            orderId: assignment.orderId,
          },
        },
      });

      if (shipment) {
        log.info('Found shipment info from Salla webhook', {
          orderId: assignment.orderId,
          trackingNumber: shipment.trackingNumber,
          courierName: shipment.courierName,
        });

        trackingNumber = shipment.trackingNumber;
        courierName = shipment.courierName;
        labelPrinted = !!(shipment.shipmentData as any)?.label_url;
      } else {
        log.info('No shipment info yet - Salla webhook may still be processing', {
          orderId: assignment.orderId,
        });
      }
    } catch (lookupError) {
      log.error('Error looking up shipment tracking', {
        orderId: assignment.orderId,
        error: lookupError,
      });
      // Continue with placeholder values
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
