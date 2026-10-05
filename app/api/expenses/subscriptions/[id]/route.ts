import { NextResponse } from 'next/server';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { updateSubscription } from '@/app/lib/expenses/subscriptions';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser(true);
    return NextResponse.json(await updateSubscription((await context.params).id, await request.json()));
  } catch (e) { return errorResponse(e); }
}
