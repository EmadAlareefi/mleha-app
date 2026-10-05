import { prisma } from '@/lib/prisma';
import { ExpenseError, expenseInstant, nextOccurrence, today, subscriptionInput } from './domain';

export async function createSubscription(body: Record<string, unknown>, actor: string, db = prisma) {
  const data = subscriptionInput(body);
  if (data.startDate < today()) throw new ExpenseError('اختر تاريخ بداية من اليوم أو لاحقاً');
  return db.expenseSubscription.create({ data: { ...data, nextDate: data.startDate, createdBy: actor } });
}
export async function updateSubscription(id: string, body: Record<string, unknown>, db = prisma) {
  return db.$transaction(async tx => {
    // Serialize scheduler and administrator edits using the same row lock.
    await tx.$queryRaw`SELECT id FROM "ExpenseSubscription" WHERE id = ${id} FOR UPDATE`;
    const old = await tx.expenseSubscription.findUnique({ where: { id } });
    if (!old) throw new ExpenseError('الاشتراك غير موجود', 404);
    if (old.state === 'archived') throw new ExpenseError('الاشتراك مؤرشف');
    if (body.action) {
      if (!['pause', 'resume', 'archive'].includes(String(body.action))) throw new ExpenseError('الإجراء غير صالح');
      const state = body.action === 'pause' ? 'paused' : body.action === 'resume' ? 'active' : 'archived';
      if (body.action === 'resume' && old.state !== 'paused') throw new ExpenseError('الاشتراك غير متوقف');
      const nextDate = body.action === 'resume' ? nextOccurrence(old.startDate, old.frequency, today()) : old.nextDate;
      if (state === 'active' && old.endDate && nextDate > old.endDate) throw new ExpenseError('انتهت مدة الاشتراك');
      return tx.expenseSubscription.update({ where: { id }, data: { state, nextDate } });
    }
    const data = subscriptionInput({ ...old, ...body, startDate: old.startDate, frequency: old.frequency });
    // Keep pending historical occurrences on the old terms: process them before an edit.
    if (old.state === 'active' && old.nextDate <= today() && (!old.endDate || old.nextDate <= old.endDate)) throw new ExpenseError('يوجد استحقاق قيد المعالجة؛ شغّل الاستحقاقات قبل تعديل الاشتراك', 409);
    return tx.expenseSubscription.update({ where: { id }, data });
  });
}
export async function processSubscriptions(now = new Date(), limit = 100, db = prisma) {
  const date = today(now);
  let created = 0;
  for (let i = 0; i < limit; i++) {
    const result = await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ExpenseSubscription" WHERE state = 'active' AND "nextDate" <= ${date} ORDER BY "nextDate", id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return null;
      const subscription = await tx.expenseSubscription.findUniqueOrThrow({ where: { id: rows[0].id } });
      const { id, nextDate, endDate } = subscription;
      if (endDate && nextDate > endDate) {
        await tx.expenseSubscription.update({ where: { id }, data: { state: 'completed' } });
        return false;
      }
      const occurrence = await tx.expenseOccurrence.findUnique({ where: { subscriptionId_dueDate: { subscriptionId: id, dueDate: nextDate } } });
      if (!occurrence) {
        await tx.expenseOccurrence.create({ data: {
          subscription: { connect: { id } }, dueDate: nextDate,
          expense: { create: { merchantId: subscription.merchantId, title: subscription.title, amount: subscription.amount, currency: subscription.currency, category: subscription.category, notes: subscription.notes, expenseDate: expenseInstant(nextDate), source: 'subscription', status: 'approved', createdBy: 'system:subscriptions', approvedBy: `system:subscription:${subscription.createdBy}`, approvedAt: now } },
        } });
      }
      const following = nextOccurrence(subscription.startDate, subscription.frequency, nextDate);
      await tx.expenseSubscription.update({ where: { id }, data: { nextDate: following, state: endDate && following > endDate ? 'completed' : 'active' } });
      return !occurrence;
    });
    if (result === null) break;
    if (result) created++;
  }
  return { created, remaining: await db.expenseSubscription.count({ where: { state: 'active', nextDate: { lte: date } } }) };
}
