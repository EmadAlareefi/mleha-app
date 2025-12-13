import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/salla/create-shipment/health
 * Health check endpoint to verify dependencies load correctly
 */
export async function GET() {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check Prisma
  try {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = 'ok';
  } catch (error) {
    health.checks.database = 'failed';
    health.checks.databaseError = error instanceof Error ? error.message : 'Unknown error';
    health.status = 'degraded';
  }

  // Check Salla OAuth
  try {
    await import('@/app/lib/salla-oauth');
    health.checks.sallaOAuth = 'ok';
  } catch (error) {
    health.checks.sallaOAuth = 'failed';
    health.checks.sallaOAuthError = error instanceof Error ? error.message : 'Unknown error';
    health.status = 'degraded';
  }

  // Check Logger
  try {
    await import('@/app/lib/logger');
    health.checks.logger = 'ok';
  } catch (error) {
    health.checks.logger = 'failed';
    health.checks.loggerError = error instanceof Error ? error.message : 'Unknown error';
    health.status = 'degraded';
  }

  return NextResponse.json(health);
}
