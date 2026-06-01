import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  buildCarrierFeeConfig,
  parseCarrierFeeConfig,
  RETURN_CARRIER_FEES_SETTING_KEY,
} from '@/lib/returns/carrier-fees';

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

    const exchangeFeeSetting = await prisma.settings.findUnique({
      where: { key: 'exchange_fee' },
    });

    const allowMultipleSetting = await prisma.settings.findUnique({
      where: { key: 'allow_multiple_return_requests' },
    });

    const carrierFeesSetting = await prisma.settings.findUnique({
      where: { key: RETURN_CARRIER_FEES_SETTING_KEY },
    });

    const fallbackReturnFee = returnFeeSetting ? Number(returnFeeSetting.value) || 0 : 0;
    const fallbackExchangeFee = exchangeFeeSetting ? Number(exchangeFeeSetting.value) || 0 : 0;

    return NextResponse.json({
      success: true,
      returnFee: fallbackReturnFee,
      exchangeFee: fallbackExchangeFee,
      carrierFees: buildCarrierFeeConfig(
        parseCarrierFeeConfig(carrierFeesSetting?.value),
        fallbackReturnFee,
        fallbackExchangeFee,
      ),
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
