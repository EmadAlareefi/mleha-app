import { NextResponse } from 'next/server';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { syncConnection } from '@/app/lib/expenses/invoices';
export const maxDuration = 300;
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser(true);
    return NextResponse.json(await syncConnection((await context.params).id, true));
  } catch (e) { return errorResponse(e); }
}
