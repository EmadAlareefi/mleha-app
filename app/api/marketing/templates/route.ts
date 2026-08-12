import { NextResponse } from 'next/server';
import { authorizeMarketing, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { getZokoTemplates } from '@/app/lib/zoko';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  try {
    const templates = (await getZokoTemplates())
      .filter((template) => template.active && template.channel === 'whatsapp');
    return NextResponse.json({ success: true, templates });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر تحميل قوالب زوكو');
  }
}
