import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasServiceAccess } from '@/app/lib/service-access';
import { Prisma, RewardPenaltyType } from '@prisma/client';

const MAX_LIMIT = 200;

function isAdmin(session: any | null): boolean {
  if (!session?.user) return false;
  const user = session.user as any;
  const primaryRole = user.role;
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
  return primaryRole === 'admin' || roles.includes('admin');
}

function canManageRecognition(session: any | null): boolean {
  return Boolean(session) && (isAdmin(session) || hasServiceAccess(session, ['user-recognition']));
}

function canViewRecognition(session: any | null): boolean {
  return (
    Boolean(session) &&
    (isAdmin(session) ||
      hasServiceAccess(session, ['user-recognition']) ||
      hasServiceAccess(session, ['my-recognition']))
  );
}

function normalizeKind(kind?: string | null): RewardPenaltyType | undefined {
  if (!kind) return undefined;
  const value = kind.toString().toUpperCase();
  if (value === RewardPenaltyType.REWARD || value === 'REWARD') {
    return RewardPenaltyType.REWARD;
  }
  if (value === RewardPenaltyType.PENALTY || value === 'PENALTY') {
    return RewardPenaltyType.PENALTY;
  }
  if (value === 'مكافأة') {
    return RewardPenaltyType.REWARD;
  }
  if (value === 'مخالفة') {
    return RewardPenaltyType.PENALTY;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!canViewRecognition(session)) {
    return NextResponse.json({ error: 'لا تملك صلاحية لعرض السجل' }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const requestedUserId = searchParams.get('userId');
  const scope = searchParams.get('scope');
  const skip = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limitParam = parseInt(searchParams.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? 50 : limitParam, MAX_LIMIT));
  const kindFilter = normalizeKind(searchParams.get('kind'));
  const fromDateParam = searchParams.get('from');
  const toDateParam = searchParams.get('to');

  const where: Prisma.UserRecognitionWhereInput = {};
  const manageAccess = canManageRecognition(session);

  if (requestedUserId) {
    if (!manageAccess) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض سجلات مستخدم آخر' },
        { status: 403 }
      );
    }
    where.userId = requestedUserId;
  } else if (scope === 'all') {
    if (!manageAccess) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض جميع السجلات' },
        { status: 403 }
      );
    }
  } else {
    const currentUserId =
      (session.user as any)?.id || (session.user as any)?.userId || (session.user as any)?.sub;
    if (!currentUserId) {
      return NextResponse.json(
        { error: 'لا يمكن تحديد المستخدم الحالي' },
        { status: 400 }
      );
    }
    where.userId = currentUserId;
  }

  if (kindFilter) {
    where.kind = kindFilter;
  }

  const effectiveDateFilter: Prisma.DateTimeFilter = {};
  if (fromDateParam) {
    const fromDate = new Date(fromDateParam);
    if (!isNaN(fromDate.getTime())) {
      effectiveDateFilter.gte = fromDate;
    }
  }
  if (toDateParam) {
    const toDate = new Date(toDateParam);
    if (!isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      effectiveDateFilter.lte = toDate;
    }
  }

  if (Object.keys(effectiveDateFilter).length > 0) {
    where.effectiveDate = effectiveDateFilter;
  }

  try {
    const [records, total] = await Promise.all([
      prisma.userRecognition.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
        orderBy: {
          effectiveDate: 'desc',
        },
        take: limit,
        skip,
      }),
      prisma.userRecognition.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      records,
      pagination: {
        limit,
        offset: skip,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    console.error('Failed to load recognition records', error);
    return NextResponse.json(
      { error: 'فشل في جلب السجلات' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!canManageRecognition(session)) {
    return NextResponse.json({ error: 'لا تملك صلاحية لإضافة سجل' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      userId,
      kind,
      title,
      description,
      points,
      effectiveDate,
    } = body ?? {};

    if (!userId || !title || !kind) {
      return NextResponse.json(
        { error: 'المستخدم، نوع السجل، والعنوان حقول مطلوبة' },
        { status: 400 }
      );
    }

    const kindValue = normalizeKind(kind);
    if (!kindValue) {
      return NextResponse.json(
        { error: 'نوع السجل غير صالح' },
        { status: 400 }
      );
    }

    const targetUser = await prisma.orderUser.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'المستخدم المطلوب غير موجود' },
        { status: 404 }
      );
    }

    const numericPoints = typeof points === 'number' ? points : Number(points);
    const parsedPoints = Number.isFinite(numericPoints) ? Math.round(numericPoints) : 0;
    const effectiveDateValue = effectiveDate ? new Date(effectiveDate) : new Date();

    if (effectiveDateValue.toString() === 'Invalid Date') {
      return NextResponse.json(
        { error: 'تاريخ التنفيذ غير صالح' },
        { status: 400 }
      );
    }

    const createdBy = session.user as any;

    const record = await prisma.userRecognition.create({
      data: {
        userId,
        kind: kindValue,
        title,
        description,
        points: parsedPoints,
        effectiveDate: effectiveDateValue,
        createdById: createdBy?.id || null,
        createdByName: createdBy?.name || null,
        createdByUsername: createdBy?.username || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error) {
    console.error('Failed to create recognition record', error);
    return NextResponse.json(
      { error: 'تعذر إنشاء السجل' },
      { status: 500 }
    );
  }
}
