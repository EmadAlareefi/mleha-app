import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import {
  applyShippingInfo,
  releaseShippingInfoHold,
  sendShippingInfoMessage,
} from '@/app/lib/shipping-info/service';
import {
  getShippingInfoSettings,
  sanitizeShippingInfoSettingsPatch,
  updateShippingInfoSettings,
} from '@/app/lib/shipping-info/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET: open requests (all of them; the page flags the ones over 48h) and the settings. */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const [open, recent, settings] = await Promise.all([
      prisma.shippingInfoRequest.findMany({
        where: { holdActive: true },
        orderBy: { createdAt: 'asc' },
        take: 300,
      }),
      prisma.shippingInfoRequest.findMany({
        where: { holdActive: false },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      getShippingInfoSettings({ fresh: true }),
    ]);
    const strip = (row: (typeof open)[number]) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      status: row.status,
      country: row.country,
      customerName: row.customerName,
      missingFields: row.missingFields,
      holdStatusSet: row.holdStatusSet,
      sentAt: row.sentAt,
      sendError: row.sendError,
      reminderSentAt: row.reminderSentAt,
      submittedAt: row.submittedAt,
      appliedAt: row.appliedAt,
      lastError: row.lastError,
      resolvedByName: row.resolvedByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return NextResponse.json({
      success: true,
      settings,
      templateConfigured: Boolean(process.env.ZOKO_TPL_SHIPPING_INFO_REQUEST),
      open: open.map(strip),
      recent: recent.map(strip),
    });
  } catch (error) {
    log.error('Shipping-info board failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الصفحة' }, { status: 500 });
  }
}

/** POST { action: 'resend' | 'retry' | 'release', id } or { action: 'settings', settings }. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    if (body.action === 'settings') {
      const patch = sanitizeShippingInfoSettingsPatch((body.settings ?? {}) as Record<string, unknown>);
      const settings = await updateShippingInfoSettings(patch);
      log.info('Shipping-info: settings', { patch, by: auth.actor.name });
      return NextResponse.json({ success: true, settings });
    }

    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });

    if (body.action === 'resend') {
      const result = await sendShippingInfoMessage(id);
      return NextResponse.json({ success: result.sent, error: result.error });
    }
    if (body.action === 'retry') {
      const result = await applyShippingInfo(id);
      return NextResponse.json({ success: result.ok, error: result.error });
    }
    if (body.action === 'release') {
      const result = await releaseShippingInfoHold(id, auth.actor.name);
      log.info('Shipping-info: released by staff', { id, by: auth.actor.name, ok: result.ok });
      return NextResponse.json({ success: result.ok, error: result.error });
    }
    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error) {
    log.error('Shipping-info action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  }
}
