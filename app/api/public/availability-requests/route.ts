import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizeE164Phone } from '@/app/lib/phone';
import { corsJson, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { getClientIp, hashIp } from '@/app/lib/public-request';
import {
  createAvailabilityRequest,
  findDuplicatePendingRequest,
} from '@/app/lib/salla-availability-requests';

export const runtime = 'nodejs';

/**
 * Public ingest for the "notify me when available" widget injected into mleha.com
 * product pages. Deliberately separate from POST /api/salla/availability-requests,
 * which requires a staff session and stays untouched.
 *
 * Everything the browser sends here is client-controlled, so this endpoint is
 * defended by an origin allowlist, per-IP and per-phone rate limits, a honeypot
 * field and duplicate suppression — not by a token, since any token shipped inside
 * the widget JS would be readable by anyone who views source.
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 10;
const MAX_REQUESTS_PER_PHONE = 5;

const MAX_TEXT_LENGTH = 250;
const MAX_NOTES_LENGTH = 500;
const MAX_URL_LENGTH = 500;

function readString(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

async function isRateLimited(ipHash: string | null, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  // Counted against the database rather than an in-process Map: this runs on
  // serverless, where each instance would otherwise keep its own private counter.
  const [ipCount, phoneCount] = await Promise.all([
    ipHash
      ? prisma.sallaProductAvailabilityRequest.count({
          where: { ipHash, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
    prisma.sallaProductAvailabilityRequest.count({
      where: { customerPhone: phone, createdAt: { gte: since } },
    }),
  ]);

  return ipCount >= MAX_REQUESTS_PER_IP || phoneCount >= MAX_REQUESTS_PER_PHONE;
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = resolveAllowedOrigin(request);
  if (!origin) {
    return corsJson(
      { success: false, error: 'origin_not_allowed' },
      { status: 403, origin: null }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return corsJson({ success: false, error: 'تنسيق البيانات غير صالح' }, { status: 400, origin });
  }

  // Honeypot: a hidden field no human ever fills in. Answer 200 so a bot that
  // trips it learns nothing from the response.
  if (readString((body as Record<string, unknown>).company)) {
    return corsJson({ success: true, duplicate: true }, { origin });
  }

  const productId = Number.parseInt(String((body as Record<string, unknown>).productId), 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return corsJson({ success: false, error: 'رقم المنتج غير صحيح' }, { status: 400, origin });
  }

  const productName = readString((body as Record<string, unknown>).productName);
  if (!productName) {
    return corsJson({ success: false, error: 'اسم المنتج مطلوب' }, { status: 400, origin });
  }

  const rawPhone = readString((body as Record<string, unknown>).customerPhone, 32);
  const phone = rawPhone ? normalizeE164Phone(rawPhone) : null;
  if (!phone) {
    return corsJson(
      { success: false, error: 'رقم الجوال غير صحيح، يرجى إدخال رقم صحيح' },
      { status: 400, origin }
    );
  }

  const record = body as Record<string, unknown>;
  const variationIdRaw = record.variationId;
  const variationId =
    typeof variationIdRaw === 'string' || typeof variationIdRaw === 'number'
      ? String(variationIdRaw).trim() || null
      : null;

  const ipHash = hashIp(getClientIp(request));

  try {
    if (await isRateLimited(ipHash, phone)) {
      return corsJson(
        { success: false, error: 'تم استقبال عدة طلبات، يرجى المحاولة لاحقاً' },
        { status: 429, origin }
      );
    }

    const duplicate = await findDuplicatePendingRequest({
      productId,
      variationId,
      customerPhone: phone,
    });

    if (duplicate) {
      return corsJson({ success: true, duplicate: true }, { origin });
    }

    const customerId = readString(record.customerId, 64);

    const created = await createAvailabilityRequest({
      productId,
      productName,
      productSku: readString(record.productSku, 120),
      productImageUrl: readString(record.productImageUrl, MAX_URL_LENGTH),
      variationId,
      variationName: readString(record.variationName),
      requestedSize: readString(record.requestedSize, 64),
      customerFirstName: readString(record.customerFirstName, 80),
      customerLastName: readString(record.customerLastName, 80),
      customerEmail: readString(record.customerEmail, 160),
      customerPhone: phone,
      notes: readString(record.notes, MAX_NOTES_LENGTH),
      requestedBy: 'storefront',
      requestedByUser: customerId,
      source: 'storefront',
      customerId,
      isGuest: !customerId,
      pageUrl: readString(record.pageUrl, MAX_URL_LENGTH),
      locale: readString(record.locale, 12),
      ipHash,
      userAgent: readString(request.headers.get('user-agent'), MAX_TEXT_LENGTH),
    });

    log.info('Storefront availability request captured', {
      requestId: created.id,
      productId,
      isGuest: !customerId,
    });

    return corsJson({ success: true, requestId: created.id }, { origin });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await findDuplicatePendingRequest({
        productId,
        variationId,
        customerPhone: phone,
      }).catch(() => null);
      if (duplicate) {
        return corsJson({ success: true, duplicate: true }, { origin });
      }
    }

    log.error('Failed to store storefront availability request', {
      productId,
      error: error instanceof Error ? error.message : error,
    });
    return corsJson(
      { success: false, error: 'تعذر حفظ الطلب، يرجى المحاولة لاحقاً' },
      { status: 500, origin }
    );
  }
}
