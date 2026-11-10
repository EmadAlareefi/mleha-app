import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { hasServiceAccess } from '@/app/lib/service-access';
import { WINDOW_OVERRIDE_SCOPES, type WindowOverrideScope } from '@/lib/returns/pieces';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const MAX_NOTE = 300;

function actorName(session: any) {
  return session?.user?.username || session?.user?.name || session?.user?.email || 'user';
}

async function authorizeReturnsManagement() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, 'returns-management') ? session : null;
}

const forbidden = () =>
  NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });

/** `undefined` when absent, `null` when invalid. */
function parseScope(value: unknown): WindowOverrideScope | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return WINDOW_OVERRIDE_SCOPES.includes(value as WindowOverrideScope) ? (value as WindowOverrideScope) : null;
}

const parseNote = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_NOTE) : null);

/** GET: active exceptions, newest first. `?orderId=` narrows to one order. */
export async function GET(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) return forbidden();

  const orderId = request.nextUrl.searchParams.get('orderId');
  const overrides = await prisma.returnWindowOverride.findMany({
    where: { revokedAt: null, ...(orderId ? { orderId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ success: true, overrides });
}

/**
 * POST { merchantId, orderNumber, scope?: 'both'|'exchange'|'return', note? }
 * Allows one order past the 24h / 3-day window, for return, exchange or both.
 * Posting an order that already has one updates its scope and note.
 */
export async function POST(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) return forbidden();

  const body = await request.json().catch(() => ({}));
  const merchantId = typeof body?.merchantId === 'string' ? body.merchantId.trim() : '';
  const reference = normalizeOrderReference(body?.orderNumber);
  if (!merchantId || !reference) {
    return NextResponse.json({ error: 'معرف التاجر ورقم الطلب مطلوبان' }, { status: 400 });
  }
  const scope = parseScope(body?.scope);
  if (scope === null) {
    return NextResponse.json({ error: 'نوع الاستثناء يجب أن يكون إرجاع أو استبدال أو الاثنين' }, { status: 400 });
  }

  const order = await getSallaOrderByReference(merchantId, reference);
  if (!order) {
    return NextResponse.json({ error: 'لم يتم العثور على الطلب في سلة' }, { status: 404 });
  }

  const orderId = String(order.id);
  const orderNumber = String(order.reference_id || reference);
  const note = parseNote(body?.note);
  const override = await prisma.returnWindowOverride.upsert({
    where: { merchantId_orderId: { merchantId, orderId } },
    create: { merchantId, orderId, orderNumber, scope: scope ?? 'both', note, createdBy: actorName(session) },
    update: {
      orderNumber,
      scope: scope ?? 'both',
      note,
      createdBy: actorName(session),
      createdAt: new Date(),
      revokedBy: null,
      revokedAt: null,
    },
  });

  return NextResponse.json({ success: true, override });
}

/** PATCH { id, scope?, note? }: change an active exception's scope or note. */
export async function PATCH(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) return forbidden();

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  const scope = parseScope(body?.scope);
  if (!id) return NextResponse.json({ error: 'معرف الاستثناء مطلوب' }, { status: 400 });
  if (scope === null) {
    return NextResponse.json({ error: 'نوع الاستثناء يجب أن يكون إرجاع أو استبدال أو الاثنين' }, { status: 400 });
  }

  const data: Record<string, unknown> = { createdBy: actorName(session) };
  if (scope) data.scope = scope;
  if (body && 'note' in body) data.note = parseNote(body.note);
  const result = await prisma.returnWindowOverride.updateMany({ where: { id, revokedAt: null }, data });
  if (result.count === 0) {
    return NextResponse.json({ error: 'الاستثناء غير موجود أو تم إلغاؤه' }, { status: 404 });
  }
  const override = await prisma.returnWindowOverride.findUnique({ where: { id } });
  return NextResponse.json({ success: true, override });
}

export async function DELETE(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) return forbidden();

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'معرف الاستثناء مطلوب' }, { status: 400 });
  }

  const result = await prisma.returnWindowOverride.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actorName(session) },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: 'الاستثناء غير موجود أو تم إلغاؤه' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
