import { NextResponse } from 'next/server';
import { authorizeMarketing, marketingErrorResponse } from '@/app/api/marketing/_shared';
import { extractClaimedAudienceSize } from '@/app/lib/marketing-customers';
import { getZokoTemplates } from '@/app/lib/zoko';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  try {
    const templates = (await getZokoTemplates())
      .filter((template) => template.active && template.channel === 'whatsapp')
      .map((template) => ({
        ...template,
        claimedAudienceSize: extractClaimedAudienceSize(template.templateDesc),
      }));
    return NextResponse.json({ success: true, templates });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر تحميل قوالب زوكو');
  }
}
