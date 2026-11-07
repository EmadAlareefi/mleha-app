import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireReturnsStaff } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';

/**
 * GET /api/returns/item-image?itemId=…
 * One item's damage photo, so the returns list does not carry every photo
 * (base64) for every row. Staff only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const itemId = request.nextUrl.searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId مطلوب' }, { status: 400 });

  const item = await prisma.returnItem.findUnique({ where: { id: itemId }, select: { damageImageData: true } });
  const value = item?.damageImageData?.trim();
  if (!value) return NextResponse.json({ error: 'لا توجد صورة' }, { status: 404 });

  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);
  if (match) {
    const contentType = match[1] && /^image\//.test(match[1]) ? match[1] : 'image/jpeg';
    const body = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (/^https:\/\//i.test(value)) {
    return NextResponse.redirect(value);
  }

  return NextResponse.json({ error: 'صيغة الصورة غير مدعومة' }, { status: 415 });
}
