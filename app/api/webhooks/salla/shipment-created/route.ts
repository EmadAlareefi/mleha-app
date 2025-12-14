import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPrintJob } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';

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
    log.info('Received shipment.created webhook from Salla');

    // Parse webhook payload
    const payload = await request.json();

    log.info('Webhook payload received', {
      event: payload.event,
      merchant: payload.merchant,
      orderId: payload.data?.reference_id,
    });

    // Validate webhook event type
    if (payload.event !== 'order.shipment.created') {
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
    const referenceId = data.reference_id;
    const shipmentInfo = data.shipping?.shipment || {};
    const receiver = data.shipping?.receiver || {};
    const shippingCompany = data.shipping?.company;
    const trackingLink = shipmentInfo.tracking_link;
    const shipmentUrl = shipmentInfo.label?.url; // PDF URL for the shipping label
    const shipmentReference = data.shipping?.shipment_reference || '';
    const city = data.shipping?.address?.city || '';
    const status = data.status?.name || 'created';

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
      const sallaOrder = await prisma.sallaOrder.findFirst({
        where: {
          merchantId,
          orderNumber: referenceId,
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

    // Store shipment info in database
    try {
      await prisma.sallaShipment.upsert({
        where: {
          merchantId_orderId: {
            merchantId,
            orderId: orderId || referenceId,
          },
        },
        create: {
          merchantId,
          orderId: orderId || referenceId,
          orderNumber: referenceId,
          trackingNumber: trackingLink || shipmentReference || shipmentInfo.id || '',
          courierName: shippingCompany || 'Unknown',
          courierCode: (shippingCompany || '').toLowerCase().replace(/\s+/g, '_'),
          status,
          shipmentData: {
            shipment_id: shipmentInfo.id,
            tracking_link: trackingLink,
            label_url: shipmentUrl,
            receiver_name: receiver.name,
            receiver_phone: receiver.phone,
            city,
            shipment_reference: shipmentReference,
            raw_payload: data,
          } as any,
        },
        update: {
          trackingNumber: trackingLink || shipmentReference || shipmentInfo.id || '',
          courierName: shippingCompany || 'Unknown',
          courierCode: (shippingCompany || '').toLowerCase().replace(/\s+/g, '_'),
          status,
          shipmentData: {
            shipment_id: shipmentInfo.id,
            tracking_link: trackingLink,
            label_url: shipmentUrl,
            receiver_name: receiver.name,
            receiver_phone: receiver.phone,
            city,
            shipment_reference: shipmentReference,
            raw_payload: data,
          } as any,
        },
      });

      log.info('Shipment stored in database', {
        referenceId,
        trackingLink,
      });
    } catch (dbError) {
      log.error('Failed to store shipment in database', {
        referenceId,
        error: dbError,
      });
    }

    // Send label to PrintNode if URL is available
    if (shipmentUrl) {
      try {
        log.info('Sending label to PrintNode', {
          referenceId,
          labelUrl: shipmentUrl,
        });

        const printResult = await sendPrintJob({
          title: `Shipment Label - Order ${referenceId}`,
          contentType: 'pdf_uri',
          content: shipmentUrl,
          copies: 1,
        });

        if (printResult.success) {
          log.info('Label sent to PrintNode successfully', {
            referenceId,
            jobId: printResult.jobId,
          });
        } else {
          log.error('Failed to send label to PrintNode', {
            referenceId,
            error: printResult.error,
          });
        }
      } catch (printError) {
        log.error('Error sending label to PrintNode', {
          referenceId,
          error: printError,
        });
      }
    } else {
      log.warn('No label URL available for printing', { referenceId });
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
