import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import type { ActionResult } from './queue';
import { getStateForUser } from './queue';
import type { PrepState } from './types';

/** `{ success, state }` — the packer's fresh orders after any call. */
export async function stateResponse(userId: string, extra: Record<string, unknown> = {}) {
  const state: PrepState = await getStateForUser(userId);
  return NextResponse.json({ success: true, state, ...extra });
}

/** Action outcome; failures carry an error code the page understands. */
export async function actionResponse(userId: string, result: ActionResult) {
  if (!result.ok) {
    const state = await getStateForUser(userId).catch(() => null);
    return NextResponse.json({ success: false, error: result.error, state }, { status: result.status });
  }
  return stateResponse(userId);
}

export function serverError(context: string, error: unknown) {
  log.error(`Order prep v2: ${context} failed`, { error: error instanceof Error ? error.message : error });
  return NextResponse.json(
    { success: false, error: { code: 'server', message: 'تعذر إتمام العملية، حاول مرة أخرى' } },
    { status: 500 },
  );
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
