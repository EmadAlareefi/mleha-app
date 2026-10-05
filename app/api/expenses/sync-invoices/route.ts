import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cronAuthorized, errorResponse } from '@/app/lib/expenses/auth';
import { syncConnection } from '@/app/lib/expenses/invoices';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const connections = await prisma.adInvoiceConnection.findMany({ where: { state: { in: ['active', 'error'] }, nextAttemptAt: { lte: new Date() }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, orderBy: { nextAttemptAt: 'asc' }, take: 2, select: { id: true } });
    const results = await Promise.allSettled(connections.map(c => syncConnection(c.id)));
    return NextResponse.json({ processed: results.length, failed: results.filter(r => r.status === 'rejected').length });
  } catch (e) { return errorResponse(e); }
}
