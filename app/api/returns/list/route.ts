import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { listReturnRequests } from '@/app/lib/returns/list-return-requests';

export const runtime = 'nodejs';

/**
 * GET /api/returns/list
 * Get all return requests with filtering and search
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasServiceAccess(session, ['returns-management', 'returns-analytics'])) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  return listReturnRequests(request);
}
