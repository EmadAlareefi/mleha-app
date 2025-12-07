import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

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

    // Only warehouse admins can list delivery agents
    if (!user.roles?.includes('warehouse') && user.role !== 'admin') {
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
        roleAssignments: {
          some: {
            role: 'DELIVERY_AGENT',
          },
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

    if (includeStats) {
      const statsPromises = deliveryAgents.map(async (agent) => {
        const [total, assigned, inTransit, delivered, failed] = await Promise.all([
          prisma.shipmentAssignment.count({
            where: { deliveryAgentId: agent.id },
          }),
          prisma.shipmentAssignment.count({
            where: { deliveryAgentId: agent.id, status: 'assigned' },
          }),
          prisma.shipmentAssignment.count({
            where: { deliveryAgentId: agent.id, status: 'in_transit' },
          }),
          prisma.shipmentAssignment.count({
            where: { deliveryAgentId: agent.id, status: 'delivered' },
          }),
          prisma.shipmentAssignment.count({
            where: { deliveryAgentId: agent.id, status: 'failed' },
          }),
        ]);

        return {
          ...agent,
          stats: {
            total,
            assigned,
            inTransit,
            delivered,
            failed,
          },
        };
      });

      agentsWithStats = await Promise.all(statsPromises);
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
