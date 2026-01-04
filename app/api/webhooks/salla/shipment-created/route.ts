import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPrintJob, PRINTNODE_LABEL_PAPER_NAME, PRINTNODE_DEFAULT_DPI } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { printCommercialInvoiceIfInternational } from '@/app/lib/international-printing';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/salla/shipment-created
 * Webhook handler for Salla's order.shipment.created event
 * Documentation: https://docs.salla.dev/433804m0
 *
 * This webhook fires AFTER Salla has created the shipment with the courier (SMSA/Aramex/DHL)
 * We receive the shipment details including tracking number and label URL
 */
export async function POST(request: NextRequest) {
  try {
    log.info('Received shipment webhook from Salla');

    // Parse webhook payload
    const payload = await request.json();

    const supportedEvents = ['order.shipment.created', 'order.updated'];
    log.info('Webhook payload received', {
      event: payload.event,
      merchant: payload.merchant,
      orderId: payload.data?.reference_id,
    });

    // Validate webhook event type
    if (!supportedEvents.includes(payload.event)) {
      log.warn('Invalid webhook event type', { event: payload.event });
      return NextResponse.json(
        { success: false, error: 'Invalid event type' },
        { status: 400 }
      );
    }

    // Extract data from webhook payload (following Salla's structure)
    const data = payload.data;
    const merchantId = payload.merchant?.toString();

    if (!data || !merchantId) {
      log.error('Missing required data in webhook', { hasData: !!data, hasMerchant: !!merchantId });
      return NextResponse.json(
        { success: false, error: 'Missing data or merchant' },
        { status: 400 }
      );
    }

    // Extract shipment information
    const orderIdFromPayload = data.id ? data.id.toString() : null;
    const referenceIdValue = data.reference_id ?? data.referenceId ?? data.reference ?? null;
    const referenceId = referenceIdValue ? referenceIdValue.toString() : orderIdFromPayload ?? '';
    const shipmentsArray = Array.isArray(data.shipments) ? data.shipments : [];
    const fallbackShipment = shipmentsArray.find((shipment: any) => shipment?.label?.url) || shipmentsArray[0] || {};
    const shipmentInfo = data.shipping?.shipment || fallbackShipment || {};
    const receiver = data.shipping?.receiver || shipmentInfo.receiver || shipmentInfo.ship_to || {};
    const shippingCompany = data.shipping?.company || shipmentInfo.courier_name || shipmentInfo.courier || shipmentInfo.courierName || 'Unknown';
    const trackingLink = shipmentInfo.tracking_link || shipmentInfo.trackingLink || shipmentInfo.tracking_url || '';
    const shipmentUrl =
      shipmentInfo.label?.url ||
      shipmentInfo.label_url ||
      shipmentInfo.labelUrl ||
      (typeof shipmentInfo.label === 'string' ? shipmentInfo.label : null); // PDF URL for the shipping label
    const shipmentReference =
      (data.shipping?.shipment_reference || shipmentInfo.shipment_reference || shipmentInfo.reference || shipmentInfo.reference_id || '')?.toString() || '';
    const city = data.shipping?.address?.city || shipmentInfo.ship_to?.city || '';
    const status = shipmentInfo.status || data.status?.name || 'created';
    const trackingNumberValue = (
      shipmentInfo.tracking_number ||
      shipmentInfo.trackingNumber ||
      shipmentInfo.shipping_number ||
      shipmentInfo.tracking_no ||
      shipmentInfo.id ||
      shipmentReference ||
      trackingLink ||
      ''
    ).toString();

    log.info('Processing shipment.created', {
      referenceId,
      shipmentId: shipmentInfo.id,
      shippingCompany,
      trackingLink,
      hasLabelUrl: !!shipmentUrl,
    });

    // Find the order in our database
    let orderId: string | null = null;
    try {
      const lookupConditions: Record<string, string>[] = [];
      if (orderIdFromPayload) lookupConditions.push({ orderId: orderIdFromPayload });
      if (referenceId) lookupConditions.push({ referenceId });
      if (referenceId) lookupConditions.push({ orderNumber: referenceId });

      const sallaOrder = await prisma.sallaOrder.findFirst({
        where: {
          merchantId,
          ...(lookupConditions.length ? { OR: lookupConditions } : {}),
        },
      });

      if (sallaOrder) {
        orderId = sallaOrder.orderId;
      } else {
        log.warn('Order not found in database', { referenceId, merchantId });
      }
    } catch (dbError) {
      log.error('Error finding order', { error: dbError });
    }

    const resolvedOrderId =
      orderId ||
      orderIdFromPayload ||
      referenceId ||
      shipmentReference ||
      shipmentInfo.order_number?.toString() ||
      shipmentInfo.order_id?.toString() ||
      trackingNumberValue ||
      shipmentInfo.id?.toString() ||
      '';

    if (!resolvedOrderId) {
      log.error('Unable to resolve order ID for shipment payload', {
        merchantId,
        referenceId,
      });
      return NextResponse.json(
        { success: false, error: 'Missing order identifier' },
        { status: 400 }
      );
    }

    let storedShipment: any = null;
    let alreadyPrinted = false;

    // Store shipment info in database
    try {
      storedShipment = await prisma.sallaShipment.upsert({
        where: {
          merchantId_orderId: {
            merchantId,
            orderId: resolvedOrderId,
          },
        },
        create: {
          merchantId,
          orderId: resolvedOrderId,
          orderNumber: referenceId || resolvedOrderId,
          trackingNumber: trackingNumberValue,
          courierName: shippingCompany || 'Unknown',
          courierCode: (shippingCompany || '').toString().toLowerCase().replace(/\s+/g, '_'),
          status,
          labelUrl: shipmentUrl || undefined,
          shipmentData: {
            shipment_id: shipmentInfo.id,
            tracking_link: trackingLink,
            tracking_number: trackingNumberValue,
            label_url: shipmentUrl,
            receiver_name: receiver.name,
            receiver_phone: receiver.phone,
            city,
            shipment_reference: shipmentReference,
            raw_payload: data,
          } as any,
        },
        update: {
          trackingNumber: trackingNumberValue,
          courierName: shippingCompany || 'Unknown',
          courierCode: (shippingCompany || '').toString().toLowerCase().replace(/\s+/g, '_'),
          status,
          labelUrl: shipmentUrl || undefined,
          shipmentData: {
            shipment_id: shipmentInfo.id,
            tracking_link: trackingLink,
            tracking_number: trackingNumberValue,
            label_url: shipmentUrl,
            receiver_name: receiver.name,
            receiver_phone: receiver.phone,
            city,
            shipment_reference: shipmentReference,
            raw_payload: data,
          } as any,
        },
      });

      alreadyPrinted =
        storedShipment.labelPrinted ||
        (storedShipment.printCount ?? 0) > 0 ||
        Boolean((storedShipment.shipmentData as any)?.labelPrinted);

      log.info('Shipment stored in database', {
        referenceId,
        orderId: resolvedOrderId,
        trackingNumber: trackingNumberValue,
        hasLabelUrl: !!shipmentUrl,
      });
    } catch (dbError) {
      log.error('Failed to store shipment in database', {
        referenceId,
        error: dbError,
      });
      alreadyPrinted = false;
    }

    // Send label to PrintNode if URL is available
    if (!shipmentUrl) {
      log.warn('No label URL available for printing', { referenceId, orderId: resolvedOrderId });
    } else if (alreadyPrinted) {
      log.info('Label already printed - skipping PrintNode request', {
        referenceId,
        orderId: resolvedOrderId,
        printCount: storedShipment?.printCount,
      });
    } else {
      if (!storedShipment) {
        log.warn('Proceeding with label print even though shipment was not stored', {
          referenceId,
          orderId: resolvedOrderId,
        });
      }

      try {
        log.info('Sending label to PrintNode', {
          referenceId,
          orderId: resolvedOrderId,
          labelUrl: shipmentUrl,
        });

        const printResult = await sendPrintJob({
          title: `Shipment Label - Order ${referenceId || resolvedOrderId}`,
          contentType: 'pdf_uri',
          content: shipmentUrl,
          copies: 1,
          paperName: PRINTNODE_LABEL_PAPER_NAME,
          fitToPage: false,
          dpi: PRINTNODE_DEFAULT_DPI,
          rotate: 0,
        });

        if (printResult.success) {
          if (storedShipment?.id) {
            await prisma.sallaShipment.update({
              where: { id: storedShipment.id },
              data: {
                labelPrinted: true,
                labelPrintedAt: new Date(),
                labelPrintedBy: 'system',
                labelPrintedByName: 'Salla webhook',
                labelUrl: shipmentUrl,
                printJobId: printResult.jobId ? String(printResult.jobId) : storedShipment.printJobId,
                printCount: (storedShipment.printCount ?? 0) + 1,
              },
            });
          }

          log.info('Label sent to PrintNode successfully', {
            referenceId,
            orderId: resolvedOrderId,
            jobId: printResult.jobId,
          });

          await printCommercialInvoiceIfInternational({
            orderId: resolvedOrderId,
            orderNumber: referenceId || resolvedOrderId,
            merchantId,
            source: 'shipment-webhook',
          });
        } else {
          log.error('Failed to send label to PrintNode', {
            referenceId,
            orderId: resolvedOrderId,
            error: printResult.error,
          });
        }
      } catch (printError) {
        log.error('Error sending label to PrintNode', {
          referenceId,
          orderId: resolvedOrderId,
          error: printError,
        });
      }
    }

    // Return success response to Salla
    return NextResponse.json({
      success: true,
      message: 'Shipment processed successfully',
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';

    log.error('Error in shipment.creating webhook', {
      error: errorMessage,
      stack: errorStack,
    });

    // Return error response to Salla
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error while creating shipment',
      },
      { status: 500 }
    );
  }
}
