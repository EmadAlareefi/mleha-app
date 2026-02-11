import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { fetchPrintNodePrinters } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

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
      { status: 403 }
    );
  }

  try {
    const [profiles, printers] = await Promise.all([
      prisma.printerProfile.findMany({
        orderBy: { label: 'asc' },
      }),
      fetchPrintNodePrinters().catch((error) => {
        log.error('Failed to fetch PrintNode printers for configuration', { error });
        return [];
      }),
    ]);

    return NextResponse.json({
      success: true,
      profiles,
      printers,
    });
  } catch (error) {
    log.error('Failed to load printer profiles', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحميل بيانات الطابعات' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { printerId: printerIdInput, label, location, paperName, notes } = body || {};

    const printerId =
      typeof printerIdInput === 'number'
        ? printerIdInput
        : typeof printerIdInput === 'string' && printerIdInput.trim()
          ? Number.parseInt(printerIdInput, 10)
          : NaN;

    if (!Number.isFinite(printerId)) {
      return NextResponse.json(
        { error: 'معرف الطابعة غير صالح' },
        { status: 400 }
      );
    }

    const normalizedLabel = typeof label === 'string' ? label.trim() : '';
    if (!normalizedLabel) {
      return NextResponse.json(
        { error: 'اسم الطابعة مطلوب' },
        { status: 400 }
      );
    }

    const profile = await prisma.printerProfile.upsert({
      where: { printerId },
      create: {
        printerId,
        label: normalizedLabel,
        location: typeof location === 'string' && location.trim() ? location.trim() : null,
        paperName: typeof paperName === 'string' && paperName.trim() ? paperName.trim() : null,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      },
      update: {
        label: normalizedLabel,
        location: typeof location === 'string' && location.trim() ? location.trim() : null,
        paperName: typeof paperName === 'string' && paperName.trim() ? paperName.trim() : null,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      },
    });

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    log.error('Failed to save printer profile', { error });
    return NextResponse.json(
      { error: 'تعذر حفظ بيانات الطابعة' },
      { status: 500 }
    );
  }
}
