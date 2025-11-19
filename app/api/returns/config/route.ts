import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/returns/config
 * Public-safe configuration for the customer returns page
 */
export async function GET() {
  try {
    const returnFeeSetting = await prisma.settings.findUnique({
      where: { key: 'return_fee' },
    });

    const allowMultipleSetting = await prisma.settings.findUnique({
      where: { key: 'allow_multiple_return_requests' },
    });

    return NextResponse.json({
      success: true,
      returnFee: returnFeeSetting ? Number(returnFeeSetting.value) || 0 : 0,
      allowMultipleRequests: allowMultipleSetting?.value === 'true',
    });
  } catch (error) {
    log.error('Failed to load returns config', { error });
    return NextResponse.json(
      { error: 'تعذر جلب إعدادات الإرجاع' },
      { status: 500 }
    );
  }
}
