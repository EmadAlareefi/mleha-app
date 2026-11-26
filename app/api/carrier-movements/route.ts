import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { loadCarrierMovements } from '@/app/lib/carrier-movements';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/** Staff screens that show a shipment's carrier movement log. */
const ALLOWED_SERVICES = ['warehouse', 'local-shipping', 'returns-management', 'returns-inspection'] as const;
const TRACKING_PATTERN = /^[A-Za-z0-9-]{4,40}$/;

/**
 * GET /api/carrier-movements?trackingNumber=…
 * Movement history (SMSA scans / AJEX callbacks) for one tracking number.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasServiceAccess(session, [...ALLOWED_SERVICES])) {
    return NextResponse.json({ error: 'غير مصرح بالوصول' }, { status: 401 });
  }

  const trackingNumber = request.nextUrl.searchParams.get('trackingNumber')?.replace(/\s+/g, '') ?? '';
  if (!TRACKING_PATTERN.test(trackingNumber)) {
    return NextResponse.json({ error: 'رقم التتبع غير صالح' }, { status: 400 });
  }

  try {
    const movements = await loadCarrierMovements([trackingNumber]);
    return NextResponse.json({ trackingNumber, movements });
  } catch (error) {
    log.error('Failed to load carrier movements', { trackingNumber, error });
    return NextResponse.json({ error: 'تعذر تحميل سجل الحركات' }, { status: 500 });
  }
}
