import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';

export const runtime = 'nodejs';

const ALLOWED_SERVICES: ServiceKey[] = [
  'warehouse',
  'order-shipping',
  'order-prep',
  'shipment-assignments',
  'local-shipping',
];

/**
 * GET /api/delivery-agents
 * Get all delivery agents
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;

    const hasWarehouseRole = Array.isArray(user.roles) && user.roles.includes('warehouse');
    const hasAllowedService =
      hasWarehouseRole || hasServiceAccess(session, ALLOWED_SERVICES);

    if (!hasAllowedService) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لعرض قائمة المناديب' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const includeStats = searchParams.get('includeStats') === 'true';

    // Get all users with delivery_agent role
    const deliveryAgents = await prisma.orderUser.findMany({
      where: {
        isActive: true,
        servicePermissions: {
          some: { serviceKey: 'my-deliveries' },
        },
      },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // If stats requested, get assignment counts
    let agentsWithStats = deliveryAgents;

    if (includeStats && deliveryAgents.length > 0) {
      const agentIds = deliveryAgents.map((agent) => agent.id);
      const groupedAssignments = await prisma.shipmentAssignment.groupBy({
        where: {
          deliveryAgentId: { in: agentIds },
        },
        by: ['deliveryAgentId', 'status'],
        _count: { _all: true },
      });

      const statsByAgent = groupedAssignments.reduce<
        Record<
          string,
          { total: number; assigned: number; inTransit: number; delivered: number; failed: number }
        >
      >((acc, entry) => {
        if (!acc[entry.deliveryAgentId]) {
          acc[entry.deliveryAgentId] = {
            total: 0,
            assigned: 0,
            inTransit: 0,
            delivered: 0,
            failed: 0,
          };
        }

        const stats = acc[entry.deliveryAgentId];
        const count = entry._count._all || 0;
        stats.total += count;

        switch (entry.status) {
          case 'assigned':
            stats.assigned += count;
            break;
          case 'in_transit':
            stats.inTransit += count;
            break;
          case 'delivered':
            stats.delivered += count;
            break;
          case 'failed':
            stats.failed += count;
            break;
          default:
            break;
        }

        return acc;
      }, {});

      agentsWithStats = deliveryAgents.map((agent) => ({
        ...agent,
        stats:
          statsByAgent[agent.id] ?? {
            total: 0,
            assigned: 0,
            inTransit: 0,
            delivered: 0,
            failed: 0,
          },
      }));
    }

    return NextResponse.json({
      success: true,
      deliveryAgents: agentsWithStats,
    });
  } catch (error) {
    log.error('Error fetching delivery agents', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب قائمة المناديب' },
      { status: 500 }
    );
  }
}
