import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/shipments/stats - Get shipment statistics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date'); // ISO date string

    let where: any = {};

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

    // Get counts by type
    const [incoming, outgoing] = await Promise.all([
      prisma.shipment.count({
        where: { ...where, type: 'incoming' },
      }),
      prisma.shipment.count({
        where: { ...where, type: 'outgoing' },
      }),
    ]);

    // Get counts by company
    const byCompany = await prisma.shipment.groupBy({
      by: ['company'],
      where,
      _count: {
        company: true,
      },
    });

    // Get counts by company and type
    const byCompanyAndType = await prisma.shipment.groupBy({
      by: ['company', 'type'],
      where,
      _count: {
        company: true,
      },
    });

    return NextResponse.json({
      total: incoming + outgoing,
      incoming,
      outgoing,
      byCompany: byCompany.map(item => ({
        company: item.company,
        count: item._count.company,
      })),
      byCompanyAndType: byCompanyAndType.map(item => ({
        company: item.company,
        type: item.type,
        count: item._count.company,
      })),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
