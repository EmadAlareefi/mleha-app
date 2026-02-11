import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || !hasServiceAccess(session, 'order-users-management')) {
    return null;
  }
  return session;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ هذا الإجراء' },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    await prisma.printerProfile.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: 'تعذر حذف الطابعة المحددة' },
      { status: 500 }
    );
  }
}
