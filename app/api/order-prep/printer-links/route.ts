import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { fetchPrintNodePrinters } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';

export const runtime = 'nodejs';

const LINKABLE_SERVICE_KEYS = new Set(['order-prep', 'order-shipping']);

type UserWithPermissions = {
  id: string;
  username: string;
  name: string;
  servicePermissions: { serviceKey: string }[];
  printerLink: {
    printerId: number;
    printerName: string | null;
    computerId: number | null;
    computerName: string | null;
    paperName: string | null;
  } | null;
};

function canLinkPrinter(user: Pick<UserWithPermissions, 'servicePermissions'>) {
  return user.servicePermissions?.some((permission) =>
    LINKABLE_SERVICE_KEYS.has(permission.serviceKey)
  );
}

function formatPrinterResponse(printers: Awaited<ReturnType<typeof fetchPrintNodePrinters>>) {
  return printers.map((printer) => ({
    id: printer.id,
    name: printer.name,
    state: printer.state,
    description: printer.description,
    capabilities: printer.capabilities,
    paperName:
      typeof printer.default?.paper === 'string'
        ? printer.default?.paper
        : printer.default?.paperName,
    computerId: printer.computer?.id,
    computerName: printer.computer?.name || printer.computer?.hostname,
    computerState: printer.computer?.state,
    computerDescription: printer.computer?.description,
  }));
}

function formatUserResponse(users: UserWithPermissions[]) {
  return users
    .filter(canLinkPrinter)
    .map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      printerLink: user.printerLink
        ? {
            printerId: user.printerLink.printerId,
            printerName: user.printerLink.printerName,
            computerId: user.printerLink.computerId,
            computerName: user.printerLink.computerName,
            paperName: user.printerLink.paperName,
          }
        : null,
    }));
}

async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح لك بالوصول إلى هذه الصفحة' },
      { status: 403 },
    );
  }

  try {
    const [users, printers] = await Promise.all([
      prisma.orderUser.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          servicePermissions: {
            select: { serviceKey: true },
          },
          printerLink: {
            select: {
              printerId: true,
              printerName: true,
              computerId: true,
              computerName: true,
              paperName: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      }),
      fetchPrintNodePrinters({ timeoutMs: 7000 }).catch((error) => {
        log.error('Failed to fetch PrintNode printers for linking', { error });
        return [];
      }),
    ]);

    return NextResponse.json({
      success: true,
      users: formatUserResponse(users),
      printers: formatPrinterResponse(printers),
    });
  } catch (error) {
    log.error('Failed to load printer links', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحميل بيانات الطابعات' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const { userId, printerId, printerName, paperName, computerId, computerName } = body || {};

    if (!userId || !printerId) {
      return NextResponse.json(
        { error: 'يجب اختيار المستخدم والطابعة' },
        { status: 400 },
      );
    }

    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        servicePermissions: {
          select: { serviceKey: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    if (!canLinkPrinter(user)) {
      return NextResponse.json(
        { error: 'يمكن ربط مستخدمي التحضير أو الشحن فقط بالطابعات' },
        { status: 400 },
      );
    }

    const link = await prisma.orderUserPrinterLink.upsert({
      where: { userId },
      create: {
        userId,
        printerId: Number(printerId),
        printerName: printerName ?? null,
        paperName: paperName ?? null,
        computerId: computerId ? Number(computerId) : null,
        computerName: computerName ?? null,
      },
      update: {
        printerId: Number(printerId),
        printerName: printerName ?? null,
        paperName: paperName ?? null,
        computerId: computerId ? Number(computerId) : null,
        computerName: computerName ?? null,
      },
      select: {
        printerId: true,
        printerName: true,
        computerId: true,
        computerName: true,
        paperName: true,
      },
    });

    return NextResponse.json({
      success: true,
      link,
    });
  } catch (error) {
    log.error('Failed to save printer link', { error });
    return NextResponse.json(
      { error: 'فشل حفظ ربط الطابعة' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 },
    );
  }

  const userId = request.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'معرف المستخدم مطلوب' }, { status: 400 });
  }

  try {
    await prisma.orderUserPrinterLink.delete({
      where: { userId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ success: true });
    }

    log.error('Failed to unlink printer from user', { error, userId });
    return NextResponse.json(
      { error: 'تعذر إزالة ربط الطابعة' },
      { status: 500 },
    );
  }
}
