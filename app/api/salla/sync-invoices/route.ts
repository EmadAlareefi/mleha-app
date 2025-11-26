import { NextRequest, NextResponse } from 'next/server';
import { syncSallaInvoices } from '@/app/lib/salla-invoices-v2';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

function getCronSecret(): string | null {
  const raw = process.env.CRON_SECRET;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return true;
  }

  const authHeader = request.headers.get('authorization');
  const bareHeader = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : authHeader?.trim();

  const headerCandidates = [
    bareHeader,
    request.headers.get('x-cron-secret')?.trim(),
    request.headers.get('x-api-key')?.trim(),
  ].filter(Boolean);

  const querySecret = new URL(request.url).searchParams.get('cronSecret')?.trim();

  return headerCandidates.some((value) => value === cronSecret) || querySecret === cronSecret;
}

async function handle(request: NextRequest) {
  try {
    // Auth disabled for local use
    // if (!isAuthorized(request)) {
    //   log.warn('Unauthorized invoice sync attempt', {
    //     hasAuthorization: Boolean(request.headers.get('authorization')),
    //     hasCronHeader: Boolean(request.headers.get('x-cron-secret')),
    //     hasApiKeyHeader: Boolean(request.headers.get('x-api-key')),
    //     hasQuerySecret: Boolean(new URL(request.url).searchParams.get('cronSecret')),
    //   });
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    const url = new URL(request.url);
    const merchantId = url.searchParams.get('merchantId') ?? undefined;
    const perPageParam = url.searchParams.get('perPage');
    const parsedPerPage = perPageParam ? Number.parseInt(perPageParam, 10) : undefined;
    const perPage =
      parsedPerPage && Number.isFinite(parsedPerPage)
        ? Math.min(Math.max(parsedPerPage, 10), 200)
        : undefined;

    // Date filtering
    const startDate = url.searchParams.get('startDate') ?? undefined;
    const endDate = url.searchParams.get('endDate') ?? undefined;

    log.info('Starting invoice sync', { merchantId, perPage, startDate, endDate });
    const stats = await syncSallaInvoices({ merchantId, perPage, startDate, endDate });

    const failedMerchants = stats.filter(
      (stat) => stat.ordersPagesProcessed === 0 && stat.invoicesFetched === 0 && stat.errors.length > 0
    );

    if (failedMerchants.length > 0) {
      const failedIds = failedMerchants.map((stat) => stat.merchantId);
      log.error('Invoice sync completed with failures', { failedMerchants: failedIds });

      const status = failedMerchants.length === stats.length ? 502 : 207;
      const errorMessage =
        failedMerchants.length === stats.length
          ? 'Failed to sync invoices for all merchants'
          : 'Failed to sync invoices for some merchants';

      return NextResponse.json(
        {
          success: false,
          merchantsProcessed: stats.length,
          stats,
          failedMerchants: failedIds,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      merchantsProcessed: stats.length,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Invoice sync failed', { error });
    return NextResponse.json({ error: 'Invoice sync failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
