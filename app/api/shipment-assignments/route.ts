import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/shipment-assignments
 * Get all shipment assignments (filtered by role)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const deliveryAgentId = searchParams.get('deliveryAgentId');

    // Build filter based on user role
    const where: any = {};

    // If delivery agent, only show their assignments
    if (user.roles?.includes('delivery_agent')) {
      where.deliveryAgentId = user.id;
    } else if (deliveryAgentId) {
      // Warehouse admin can filter by delivery agent
      where.deliveryAgentId = deliveryAgentId;
    }

    if (status) {
      where.status = status;
    }

    const assignments = await prisma.shipmentAssignment.findMany({
      where,
      include: {
        shipment: {
          include: {
            warehouse: true,
            codCollection: true,
          },
        },
        deliveryAgent: {
          select: {
            id: true,
            name: true,
            username: true,
            phone: true,
          },
        },
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    const trackingNumbers = assignments
      .map((assignment) => assignment.shipment?.trackingNumber)
      .filter((trackingNumber): trackingNumber is string => Boolean(trackingNumber));

    const orderNumbers = assignments
      .map((assignment) => assignment.shipment?.orderNumber)
      .filter((orderNumber): orderNumber is string => Boolean(orderNumber));

    const scanRecords =
      trackingNumbers.length > 0
        ? await prisma.shipment.findMany({
            where: {
              trackingNumber: { in: trackingNumbers },
            },
            select: {
              trackingNumber: true,
              type: true,
              scannedAt: true,
            },
            orderBy: {
              scannedAt: 'desc',
            },
          })
        : [];

    const exchangeRequests =
      orderNumbers.length > 0
        ? await prisma.returnRequest.findMany({
            where: {
              type: 'exchange',
              exchangeOrderNumber: { in: orderNumbers },
            },
            select: {
              id: true,
              status: true,
              orderNumber: true,
              exchangeOrderNumber: true,
            },
          })
        : [];

    const directionMap = new Map<string, string>();
    for (const record of scanRecords) {
      if (!directionMap.has(record.trackingNumber)) {
        directionMap.set(record.trackingNumber, record.type);
      }
    }

    const exchangeMap = new Map<string, (typeof exchangeRequests)[number]>();
    for (const request of exchangeRequests) {
      if (request.exchangeOrderNumber) {
        exchangeMap.set(request.exchangeOrderNumber, request);
      }
    }

    const enrichedAssignments = assignments.map((assignment) => {
      const trackingNumber = assignment.shipment?.trackingNumber;
      const orderNumber = assignment.shipment?.orderNumber;
      const direction = trackingNumber ? directionMap.get(trackingNumber) : null;
      const exchangeRequest = orderNumber ? exchangeMap.get(orderNumber) : null;

      return {
        ...assignment,
        shipmentDirection: direction === 'incoming' ? 'incoming' : 'outgoing',
        exchangeRequest: exchangeRequest
          ? {
              id: exchangeRequest.id,
              status: exchangeRequest.status,
              orderNumber: exchangeRequest.orderNumber,
              exchangeOrderNumber: exchangeRequest.exchangeOrderNumber,
            }
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      assignments: enrichedAssignments,
    });
  } catch (error) {
    log.error('Error fetching shipment assignments', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب التعيينات' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/shipment-assignments
 * Assign shipment to delivery agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;

    // Only warehouse admins can assign shipments
    if (!user.roles?.includes('warehouse') && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتعيين الشحنات' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { shipmentId, deliveryAgentId, notes } = body;

    if (!shipmentId || !deliveryAgentId) {
      return NextResponse.json(
        { error: 'معرف الشحنة ومعرف المندوب مطلوبان' },
        { status: 400 }
      );
    }

    // Check if shipment exists and is not already assigned
    const shipment = await prisma.localShipment.findUnique({
      where: { id: shipmentId },
      include: { assignment: true },
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'الشحنة غير موجودة' },
        { status: 404 }
      );
    }

    if (shipment.assignment) {
      return NextResponse.json(
        { error: 'الشحنة مُعيّنة بالفعل لمندوب' },
        { status: 400 }
      );
    }

    // Verify delivery agent exists and has correct role
    const deliveryAgent = await prisma.orderUser.findUnique({
      where: { id: deliveryAgentId },
      select: {
        id: true,
        servicePermissions: {
          select: { serviceKey: true },
        },
      },
    });

    if (!deliveryAgent) {
      return NextResponse.json(
        { error: 'المندوب غير موجود' },
        { status: 404 }
      );
    }

    const hasDeliveryPermission = deliveryAgent.servicePermissions.some(
      (permission) => permission.serviceKey === 'my-deliveries'
    );

    if (!hasDeliveryPermission) {
      return NextResponse.json(
        { error: 'المستخدم المحدد ليس مندوب توصيل' },
        { status: 400 }
      );
    }

    // Create assignment
    const assignment = await prisma.shipmentAssignment.create({
      data: {
        shipmentId,
        deliveryAgentId,
        assignedBy: user.username || user.name,
        notes,
      },
      include: {
        shipment: {
          include: {
            warehouse: true,
          },
        },
        deliveryAgent: {
          select: {
            id: true,
            name: true,
            username: true,
            phone: true,
          },
        },
      },
    });

    // Update shipment status
    await prisma.localShipment.update({
      where: { id: shipmentId },
      data: { status: 'assigned' },
    });

    // If shipment is COD, create COD collection record
    if (shipment.isCOD) {
      await prisma.cODCollection.create({
        data: {
          shipmentId,
          collectionAmount: shipment.orderTotal,
          currency: 'SAR',
          status: 'pending',
        },
      });
    }

    log.info('Shipment assigned to delivery agent', {
      shipmentId,
      deliveryAgentId,
      assignedBy: user.username,
    });

    return NextResponse.json({
      success: true,
      assignment,
    });
  } catch (error) {
    log.error('Error assigning shipment', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تعيين الشحنة' },
      { status: 500 }
    );
  }
}
