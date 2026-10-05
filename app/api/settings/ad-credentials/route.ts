import { NextResponse } from 'next/server';
import { errorResponse, settingsUser } from '@/app/lib/expenses/auth';
import { provider } from '@/app/lib/expenses/domain';
import { providerSettingsSummary, saveProviderAppConfig } from '@/app/lib/expenses/provider-settings';
export const runtime = 'nodejs';
export async function GET() {
  try {
    await settingsUser();
    return NextResponse.json(await providerSettingsSummary(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await settingsUser();
    const body = await request.json();
    await saveProviderAppConfig(provider(body.provider), body, actor);
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
