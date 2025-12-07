import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { log } from '@/app/lib/logger';
import { serializeLocalShipment } from '../serializer';

const prisma = new PrismaClient();

const parseDate = (input: string | null, isEnd: boolean = false): Date | null => {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(`${input}T${isEnd ? '23:59:59' : '00:00:00'}`);
    if (Number.isNaN(fallback.getTime())) return null;
    return fallback;
  }

  if (isEnd) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const startParam = searchParams.get('startDate');
    const endParam = searchParams.get('endDate');
    const status = searchParams.get('status');

    // Status filter doesn't require merchantId
    const where: any = {};

    if (merchantId) {
      where.merchantId = merchantId;
    }

    if (status) {
      where.status = status;
    } else if (merchantId) {
      // Only apply date filtering if merchantId is provided (legacy behavior)
      const defaultStart = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      };

      const defaultEnd = () => {
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        return d;
      };

      const startDate = parseDate(startParam) ?? defaultStart();
      const endDate = parseDate(endParam, true) ?? defaultEnd();

      if (startDate > endDate) {
        return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
      }

      where.createdAt = {
        gte: startDate,
        lte: endDate,
      };
    }

    const shipments = await prisma.localShipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      shipments: shipments.map((shipment) => serializeLocalShipment(shipment)),
    });
  } catch (error) {
    log.error('Failed to fetch local shipments', { error });
    return NextResponse.json(
      { error: 'فشل في جلب الشحنات' },
      { status: 500 }
    );
  }
}
