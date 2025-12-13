import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSMSAB2CShipment, type SMSAB2CRequest } from '@/app/lib/smsa-api';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/salla/shipment-creating
 * Webhook handler for Salla's shipment.creating event
 * Documentation: https://docs.salla.dev/433804m0
 *
 * This is a SYNCHRONOUS webhook - Salla expects an immediate response with shipment details
 */
export async function POST(request: NextRequest) {
  try {
    log.info('Received shipment.creating webhook from Salla');

    // Parse webhook payload
    const payload = await request.json();

    log.info('Webhook payload received', {
      event: payload.event,
      merchant: payload.merchant,
      orderId: payload.data?.order?.id,
    });

    // Validate webhook event type
    if (payload.event !== 'order.shipment.creating') {
      log.warn('Invalid webhook event type', { event: payload.event });
      return NextResponse.json(
        { error: 'Invalid event type' },
        { status: 400 }
      );
    }

    // Extract order and shipment data
    const order = payload.data?.order;
    const merchantId = payload.merchant?.toString();

    if (!order || !merchantId) {
      log.error('Missing required data in webhook', { hasOrder: !!order, hasMerchant: !!merchantId });
      return NextResponse.json(
        { error: 'Missing order or merchant data' },
        { status: 400 }
      );
    }

    // Get merchant's store address for shipping
    // This would typically come from your database or Salla merchant settings
    const storeAddress = {
      ContactName: process.env.STORE_NAME || 'Mleha Store',
      ContactPhoneNumber: process.env.STORE_PHONE || '966500000000',
      AddressLine1: process.env.STORE_ADDRESS || 'Store Address',
      City: process.env.STORE_CITY || 'Riyadh',
      Country: 'SA',
    };

    // Build customer address
    const customer = order.customer;
    const customerAddress = {
      ContactName: `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Customer',
      ContactPhoneNumber: customer?.mobile?.number || customer?.mobile || '966500000000',
      AddressLine1: customer?.address || customer?.address_line || 'Customer Address',
      City: customer?.city || 'Riyadh',
      Country: customer?.country_code || 'SA',
      District: customer?.district,
      PostalCode: customer?.postal_code,
    };

    // Calculate shipment details
    const items = order.items || [];
    const totalWeight = items.reduce((sum: number, item: any) => {
      const weight = item.product?.weight || 1;
      const quantity = item.quantity || 1;
      return sum + (weight * quantity);
    }, 0);

    const declaredValue = parseFloat(order.amounts?.total?.amount || order.total?.amount || 0);
    const codAmount = order.payment_method === 'cod' ? declaredValue : 0;

    // Prepare SMSA B2C shipment request
    const shipmentRequest: SMSAB2CRequest = {
      OrderNumber: order.reference_id || order.id?.toString(),
      DeclaredValue: declaredValue,
      Parcels: 1,
      ShipDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      ShipmentCurrency: order.currency?.code || 'SAR',
      Weight: Math.max(totalWeight, 0.5), // Minimum 0.5kg
      WeightUnit: 'kg',
      ContentDescription: items.map((item: any) => item.name).join(', ').substring(0, 100),
      ConsigneeAddress: customerAddress,
      ShipperAddress: storeAddress,
      CODAmount: codAmount,
      VatPaid: true,
      DutyPaid: true,
    };

    log.info('Creating SMSA B2C shipment', {
      orderId: order.id,
      orderNumber: shipmentRequest.OrderNumber,
      weight: shipmentRequest.Weight,
      codAmount,
    });

    // Create shipment with SMSA
    const shipmentResult = await createSMSAB2CShipment(shipmentRequest);

    if (!shipmentResult.success) {
      log.error('Failed to create SMSA shipment', {
        orderId: order.id,
        error: shipmentResult.error,
      });

      // Return error to Salla - this will prevent the shipment from being created
      return NextResponse.json(
        {
          success: false,
          error: shipmentResult.error || 'Failed to create shipment with courier',
        },
        { status: 400 }
      );
    }

    log.info('SMSA shipment created successfully', {
      orderId: order.id,
      trackingNumber: shipmentResult.trackingNumber,
      sawb: shipmentResult.sawb,
    });

    // Store shipment info in database for later retrieval
    try {
      await prisma.sallaShipment.create({
        data: {
          merchantId,
          orderId: order.id.toString(),
          orderNumber: order.reference_id || order.id.toString(),
          trackingNumber: shipmentResult.trackingNumber!,
          courierName: 'SMSA Express',
          courierCode: 'smsa',
          awbNumber: shipmentResult.awbNumber,
          sawb: shipmentResult.sawb,
          status: 'created',
          shipmentData: shipmentResult.rawResponse as any,
        },
      });
    } catch (dbError) {
      // Log but don't fail the webhook if database insert fails
      log.error('Failed to store shipment in database', {
        orderId: order.id,
        error: dbError,
      });
    }

    // Return shipment details to Salla
    // Salla expects this specific response format
    return NextResponse.json({
      success: true,
      data: {
        tracking_number: shipmentResult.trackingNumber,
        tracking_link: `https://www.smsaexpress.com/track/?tracknumbers=${shipmentResult.trackingNumber}`,
        shipping_company: 'SMSA Express',
        label_url: shipmentResult.rawResponse?.waybills?.[0]?.label_url,
      },
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
