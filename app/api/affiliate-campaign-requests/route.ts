import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';
import { normalizeAffiliateName } from '@/lib/affiliate';

export const runtime = 'nodejs';

const ALLOWED_PLATFORMS = new Set([
  'instagram',
  'snapchat',
  'tiktok',
  'x',
  'facebook',
  'google',
]);

type CampaignRequestRow = {
  id: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
  platform: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function serializeCampaignRequest(row: CampaignRequestRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    platform: row.platform,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getAffiliateUser() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    };
  }

  const sessionUser = session.user as { id?: string | null; affiliateName?: string | null } | undefined;
  const affiliateName = normalizeAffiliateName(sessionUser?.affiliateName);
  if (!sessionUser?.id || !affiliateName) {
    return {
      error: NextResponse.json({ error: 'No affiliate linked to this account' }, { status: 403 }),
      user: null,
    };
  }

  const users = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "OrderUser"
    WHERE "id" = ${sessionUser.id}
      AND "affiliateName" IS NOT NULL
    LIMIT 1
  `;

  if (!users[0]) {
    return {
      error: NextResponse.json({ error: 'No affiliate linked to this account' }, { status: 403 }),
      user: null,
    };
  }

  return {
    error: null,
    user: {
      id: users[0].id,
      affiliateName,
    },
  };
}

export async function GET() {
  try {
    const affiliate = await getAffiliateUser();
    if (affiliate.error || !affiliate.user) {
      return affiliate.error!;
    }

    const rows = await prisma.$queryRaw<CampaignRequestRow[]>`
      SELECT "id", "amount", "currency", "platform", "notes", "status", "createdAt", "updatedAt"
      FROM "AffiliateCampaignRequest"
      WHERE "affiliateId" = ${affiliate.user.id}
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;

    return NextResponse.json({
      success: true,
      requests: rows.map(serializeCampaignRequest),
    });
  } catch (error) {
    log.error('Error fetching affiliate campaign requests', { error });
    return NextResponse.json({ error: 'تعذر جلب طلبات الحملات التسويقية' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const affiliate = await getAffiliateUser();
    if (affiliate.error || !affiliate.user) {
      return affiliate.error!;
    }

    const body = await request.json().catch(() => null);
    const amount = Number(body?.amount);
    const platform = String(body?.platform || '').trim().toLowerCase();
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'يرجى إدخال مبلغ صالح للحملة' }, { status: 400 });
    }

    if (!ALLOWED_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: 'يرجى اختيار منصة تسويقية صحيحة' }, { status: 400 });
    }

    if (notes.length > 1000) {
      return NextResponse.json({ error: 'الملاحظات يجب ألا تتجاوز 1000 حرف' }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<CampaignRequestRow[]>`
      INSERT INTO "AffiliateCampaignRequest" (
        "id",
        "affiliateId",
        "amount",
        "currency",
        "platform",
        "notes",
        "status",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${affiliate.user.id},
        ${new Prisma.Decimal(amount)},
        'SAR',
        ${platform},
        ${notes || null},
        'PENDING',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING "id", "amount", "currency", "platform", "notes", "status", "createdAt", "updatedAt"
    `;

    return NextResponse.json({
      success: true,
      request: serializeCampaignRequest(rows[0]),
    });
  } catch (error) {
    log.error('Error creating affiliate campaign request', { error });
    return NextResponse.json({ error: 'تعذر إنشاء طلب الحملة التسويقية' }, { status: 500 });
  }
}
