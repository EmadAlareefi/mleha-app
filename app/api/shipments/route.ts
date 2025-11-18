import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { detectShipmentCompany, isValidTrackingNumber } from '@/lib/shipment-detector';

// GET /api/shipments - Get all shipments with optional filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'incoming' or 'outgoing'
    const company = searchParams.get('company');
    const date = searchParams.get('date'); // ISO date string
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: any = {};

    if (type) {
      where.type = type;
    }

    if (company) {
      where.company = company;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      where.scannedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: {
        scannedAt: 'desc',
      },
      take: limit,
    });

    return NextResponse.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الشحنات' },
      { status: 500 }
    );
  }
}

// POST /api/shipments - Create a new shipment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trackingNumber, type, scannedBy, notes } = body;

    // Validate tracking number
    if (!trackingNumber || !isValidTrackingNumber(trackingNumber)) {
      return NextResponse.json(
        { error: 'رقم التتبع غير صالح' },
        { status: 400 }
      );
    }

    // Validate type
    if (!type || (type !== 'incoming' && type !== 'outgoing')) {
      return NextResponse.json(
        { error: 'نوع الشحنة يجب أن يكون وارد أو صادر' },
        { status: 400 }
      );
    }

    // Check if tracking number already exists
    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber: trackingNumber.trim() },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: 'رقم التتبع موجود مسبقاً',
          existing: existing
        },
        { status: 409 }
      );
    }

    // Detect company
    const company = detectShipmentCompany(trackingNumber);

    // Create shipment
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: trackingNumber.trim(),
        company: company.id,
        type,
        scannedBy,
        notes,
      },
    });

    // If this is an incoming shipment, check if it's linked to a return request
    if (type === 'incoming') {
      const returnRequest = await prisma.returnRequest.findUnique({
        where: { smsaTrackingNumber: trackingNumber.trim() },
      });

      if (returnRequest) {
        // Update return request status to 'delivered'
        await prisma.returnRequest.update({
          where: { id: returnRequest.id },
          data: {
            status: 'delivered',
            updatedAt: new Date(),
          },
        });

        console.log(`Updated return request ${returnRequest.id} status to 'delivered'`);
      }
    }

    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    console.error('Error creating shipment:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الشحنة' },
      { status: 500 }
    );
  }
}
