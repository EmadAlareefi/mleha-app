import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { createSubscription, processSubscriptions } from '@/app/lib/expenses/subscriptions';
export async function GET() {
  try {
    await expenseUser();
    return NextResponse.json(await prisma.expenseSubscription.findMany({ orderBy: { createdAt: 'desc' }, include: { occurrences: { take: 12, orderBy: { dueDate: 'desc' }, include: { expense: { select: { id: true, amount: true, currency: true } } } } } }));
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await expenseUser(true);
    const body = await request.json();
    if (body.action === 'process') return NextResponse.json(await processSubscriptions());
    return NextResponse.json(await createSubscription(body, actor), { status: 201 });
  } catch (e) { return errorResponse(e); }
}
