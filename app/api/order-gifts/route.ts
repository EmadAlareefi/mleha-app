import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import type { OrderGiftFlag } from '@prisma/client';
import { hasServiceAccess } from '@/app/lib/service-access';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

type GiftAuthResult =
  | { authorized: true; user: any }
  | { authorized: false; response: NextResponse };

const ensureGiftPermission = async (): Promise<GiftAuthResult> => {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
    };
  }

  if (!hasServiceAccess(session, 'returns-gifts')) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 }),
    };
  }

  return {
    authorized: true,
    user: session.user as any,
  };
};

const serializeGiftFlag = (flag: OrderGiftFlag | null) => {
  if (!flag) {
    return null;
  }

  return {
    id: flag.id,
    merchantId: flag.merchantId,
    orderId: flag.orderId,
    orderNumber: flag.orderNumber,
    reason: flag.reason || null,
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
  const auth = await ensureGiftPermission();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const orderId = (searchParams.get('orderId') || '').trim();
  const orderNumber = (searchParams.get('orderNumber') || '').trim();

  if (!orderId && !orderNumber) {
    return NextResponse.json(
      { error: 'يرجى إدخال رقم الطلب أو المعرف' },
      { status: 400 },
    );
  }

  let giftFlag: OrderGiftFlag | null = null;

  if (orderId) {
    giftFlag = await prisma.orderGiftFlag.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId,
        },
      },
    });
  } else if (orderNumber) {
    giftFlag = await prisma.orderGiftFlag.findFirst({
      where: {
        merchantId: MERCHANT_ID,
        orderNumber,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  return NextResponse.json({
    success: true,
    giftFlag: serializeGiftFlag(giftFlag),
  });
}

export async function POST(request: NextRequest) {
  const auth = await ensureGiftPermission();
  if (!auth.authorized) {
    return auth.response;
  }

  const body = await parseJson(request);

  if (!body) {
    return NextResponse.json(
      { error: 'صيغة الطلب غير صحيحة' },
      { status: 400 },
    );
  }

  const orderId = (body.orderId || '').toString().trim();
  const orderNumber = (body.orderNumber || '').toString().trim();
  const reason = body.reason ? String(body.reason).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  if (!orderId || !orderNumber) {
    return NextResponse.json(
      { error: 'رقم الطلب ومعرفه مطلوبان' },
      { status: 400 },
    );
  }

  const giftFlag = await prisma.orderGiftFlag.upsert({
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
      reason,
      notes,
      createdById: auth.user.id || null,
      createdByName: auth.user.name || null,
      createdByUsername: auth.user.username || null,
    },
    update: {
      orderNumber,
      reason,
      notes,
      createdById: auth.user.id || null,
      createdByName: auth.user.name || null,
      createdByUsername: auth.user.username || null,
    },
  });

  return NextResponse.json({
    success: true,
    giftFlag: serializeGiftFlag(giftFlag),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await ensureGiftPermission();
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
    return NextResponse.json(
      { error: 'معرف الطلب مطلوب لإلغاء علامة الهدية' },
      { status: 400 },
    );
  }

  const existing = await prisma.orderGiftFlag.findUnique({
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
      message: 'لم يتم العثور على علامة للطلب',
    });
  }

  await prisma.orderGiftFlag.delete({
    where: {
      merchantId_orderId: {
        merchantId: MERCHANT_ID,
        orderId,
      },
    },
  });

  return NextResponse.json({
    success: true,
    message: 'تمت إزالة علامة الهدية',
  });
}
