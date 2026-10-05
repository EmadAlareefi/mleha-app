import { NextResponse } from 'next/server';
import { cronAuthorized, errorResponse } from '@/app/lib/expenses/auth';
import { processSubscriptions } from '@/app/lib/expenses/subscriptions';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await processSubscriptions()); } catch (e) { return errorResponse(e); }
}
