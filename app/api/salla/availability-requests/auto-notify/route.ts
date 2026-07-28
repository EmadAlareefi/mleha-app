import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { log } from '@/app/lib/logger';
import { getSettingBoolean, setSetting } from '@/app/lib/settings';

export const runtime = 'nodejs';

/**
 * Read/write the automatic back-in-stock notification kill switch.
 *
 * This lives under the availability-requests namespace rather than /api/settings
 * because the team that runs this feature holds the `salla-notify` service, not
 * necessarily full admin rights, and /api/settings is admin-only by design.
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const enabled = await getSettingBoolean('availability_auto_notify_enabled');
  return NextResponse.json({ success: true, enabled });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'قيمة الإعداد غير صحيحة' },
      { status: 400 }
    );
  }

  try {
    await setSetting('availability_auto_notify_enabled', body.enabled ? 'true' : 'false');
    log.info('Availability auto-notify setting changed', {
      enabled: body.enabled,
      actor: (session.user as { name?: string; email?: string })?.name || session.user?.email,
    });
    return NextResponse.json({ success: true, enabled: body.enabled });
  } catch (error) {
    log.error('Failed to update availability auto-notify setting', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ success: false, error: 'تعذر حفظ الإعداد' }, { status: 500 });
  }
}
