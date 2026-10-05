import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from 'next-auth';
import { cronAuthorized, expenseUser, settingsUser } from '../auth';

test('expense access rejects anonymous and unauthorized users, restricts configuration to admins', async () => {
  const session = (user: Record<string, unknown>) => async () => ({ user, expires: '2099-01-01' } as Session);
  await assert.rejects(expenseUser(false, async () => null), /تسجيل الدخول/);
  await assert.rejects(expenseUser(false, session({ role: 'user', serviceKeys: [] })), /الصلاحية/);
  assert.equal(await expenseUser(false, session({ name: 'viewer', role: 'user', serviceKeys: ['expenses'] })), 'viewer');
  await assert.rejects(expenseUser(true, session({ role: 'user', serviceKeys: ['expenses'] })), /الصلاحية/);
  assert.equal(await expenseUser(true, session({ name: 'administrator', role: 'admin' })), 'administrator');
});
test('cron auth fails closed for missing, wrong and malformed secrets', () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal(cronAuthorized(new Request('https://example.test')), false);
    process.env.CRON_SECRET = 'test-cron-secret';
    for (const value of ['', 'Bearer wrong', 'test-cron-secret', 'Bearer test-cron-secret-more']) assert.equal(cronAuthorized(new Request('https://example.test', { headers: { authorization: value } })), false);
    assert.equal(cronAuthorized(new Request('https://example.test', { headers: { authorization: 'Bearer test-cron-secret' } })), true);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});

test('staff need Settings permission to manage ad app credentials', async () => {
  const session = (user: Record<string, unknown>) => async () => ({ user, expires: '2099-01-01' } as Session);
  await assert.rejects(settingsUser(async () => null), /تسجيل الدخول/);
  await assert.rejects(settingsUser(session({ role: 'user', serviceKeys: ['expenses'] })), /صلاحية الإعدادات/);
  assert.equal(await settingsUser(session({ id: 'staff-1', role: 'user', serviceKeys: ['settings'] })), 'staff-1');
  assert.equal(await settingsUser(session({ id: 'admin-1', role: 'admin' })), 'admin-1');
});
