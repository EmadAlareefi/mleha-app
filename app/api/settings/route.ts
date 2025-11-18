import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/settings
 * Get all settings or a specific setting by key
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // Get specific setting
      const setting = await prisma.settings.findUnique({
        where: { key },
      });

      if (!setting) {
        return NextResponse.json(
          { error: 'الإعداد غير موجود' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        setting: {
          key: setting.key,
          value: setting.value,
          description: setting.description,
        },
      });
    }

    // Get all settings
    const settings = await prisma.settings.findMany({
      orderBy: { key: 'asc' },
    });

    return NextResponse.json({
      success: true,
      settings: settings.map(s => ({
        key: s.key,
        value: s.value,
        description: s.description,
      })),
    });

  } catch (error) {
    log.error('Error fetching settings', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الإعدادات' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings
 * Create or update a setting
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value, description } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: 'المفتاح والقيمة مطلوبان' },
        { status: 400 }
      );
    }

    log.info('Updating setting', { key });

    const setting = await prisma.settings.upsert({
      where: { key },
      update: {
        value: String(value),
        description,
        updatedAt: new Date(),
      },
      create: {
        key,
        value: String(value),
        description,
      },
    });

    return NextResponse.json({
      success: true,
      setting: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
      },
    });

  } catch (error) {
    log.error('Error updating setting', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث الإعداد' },
      { status: 500 }
    );
  }
}
