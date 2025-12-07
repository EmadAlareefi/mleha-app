import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/cod-collections
 * Get COD collections (filtered by role)
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

    // Build filter
    const where: any = {};

    if (status) {
      where.status = status;
    }

    // If delivery agent, filter by their collections
    if (user.roles?.includes('delivery_agent')) {
      where.collectedBy = user.username || user.name;
    } else if (deliveryAgentId) {
      where.collectedBy = deliveryAgentId;
    }

    const collections = await prisma.cODCollection.findMany({
      where,
      include: {
        shipment: {
          include: {
            assignment: {
              include: {
                deliveryAgent: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate totals
    const totals = {
      pending: collections.filter((c) => c.status === 'pending').length,
      collected: collections.filter((c) => c.status === 'collected').length,
      deposited: collections.filter((c) => c.status === 'deposited').length,
      reconciled: collections.filter((c) => c.status === 'reconciled').length,
      totalAmount: collections.reduce(
        (sum, c) => sum + Number(c.collectionAmount),
        0
      ),
      collectedAmount: collections
        .filter((c) => c.status !== 'pending' && c.status !== 'failed')
        .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    };

    return NextResponse.json({
      success: true,
      collections,
      totals,
    });
  } catch (error) {
    log.error('Error fetching COD collections', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب بيانات التحصيل' },
      { status: 500 }
    );
  }
}
