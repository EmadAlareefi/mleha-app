import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getAuditUser } from '@/app/lib/audit';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

type AuthResult =
  | { authorized: true; user: any }
  | { authorized: false; response: NextResponse };

const ensurePermission = async (): Promise<AuthResult> => {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
    };
  }

  if (!hasServiceAccess(session, 'order-do-not-ship')) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 }),
    };
  }

  return { authorized: true, user: session.user as any };
};

const serializeFlag = (flag: any | null) => {
  if (!flag) {
    return null;
  }

  return {
    id: flag.id,
    merchantId: flag.merchantId,
    orderId: flag.orderId,
    orderNumber: flag.orderNumber || null,
    trackingNumber: flag.trackingNumber || null,
    notes: flag.notes || null,
    createdById: flag.createdById || null,
    createdByName: flag.createdByName || null,
    createdByUsername: flag.createdByUsername || null,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
  };
};

const parseJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  const auth = await ensurePermission();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const orderId = (searchParams.get('orderId') || '').trim();
  const orderNumber = (searchParams.get('orderNumber') || '').trim();
  const trackingNumber = (searchParams.get('trackingNumber') || '').trim();

  if (!orderId && !orderNumber && !trackingNumber) {
    return NextResponse.json(
      { error: 'يرجى إدخال رقم الطلب أو رقم التتبع' },
      { status: 400 },
    );
  }

  const orFilters = [];
  if (orderId) orFilters.push({ orderId });
  if (orderNumber) orFilters.push({ orderNumber });
  if (trackingNumber) orFilters.push({ trackingNumber });

  const flag = await prisma.orderDoNotShipFlag.findFirst({
    where: {
      merchantId: MERCHANT_ID,
      OR: orFilters,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    success: true,
    doNotShipFlag: serializeFlag(flag),
  });
}

export async function POST(request: NextRequest) {
  const auth = await ensurePermission();
  if (!auth.authorized) {
    return auth.response;
  }

  const body = await parseJson(request);
  if (!body) {
    return NextResponse.json({ error: 'صيغة الطلب غير صحيحة' }, { status: 400 });
  }

  const orderId = (body.orderId || '').toString().trim();
  const orderNumber = body.orderNumber ? String(body.orderNumber).trim() : null;
  const trackingNumber = body.trackingNumber ? String(body.trackingNumber).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  if (!orderId) {
    return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
  }

  const auditUser = getAuditUser(auth.user);
  const flag = await prisma.orderDoNotShipFlag.upsert({
    where: {
      merchantId_orderId: {
        merchantId: MERCHANT_ID,
        orderId,
      },
    },
    create: {
      merchantId: MERCHANT_ID,
      orderId,
      orderNumber,
      trackingNumber,
      notes,
      createdById: auditUser.id,
      createdByName: auditUser.name || auth.user.name || auth.user.username || null,
      createdByUsername: auditUser.username,
    },
    update: {
      orderNumber,
      trackingNumber,
      notes,
      createdById: auditUser.id,
      createdByName: auditUser.name || auth.user.name || auth.user.username || null,
      createdByUsername: auditUser.username,
    },
  });

  return NextResponse.json({
    success: true,
    doNotShipFlag: serializeFlag(flag),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await ensurePermission();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  let orderId = (searchParams.get('orderId') || '').trim();

  if (!orderId) {
    const body = await parseJson(request);
    if (body?.orderId) {
      orderId = String(body.orderId).trim();
    }
  }

  if (!orderId) {
    return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
  }

  const existing = await prisma.orderDoNotShipFlag.findUnique({
    where: {
      merchantId_orderId: {
        merchantId: MERCHANT_ID,
        orderId,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({
      success: true,
      message: 'لم يتم العثور على علامة إيقاف شحن لهذا الطلب',
    });
  }

  await prisma.orderDoNotShipFlag.delete({
    where: {
      merchantId_orderId: {
        merchantId: MERCHANT_ID,
        orderId,
      },
    },
  });

  return NextResponse.json({
    success: true,
    message: 'تمت إزالة علامة إيقاف الشحن',
  });
}
