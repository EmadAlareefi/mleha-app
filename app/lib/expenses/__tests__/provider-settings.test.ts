import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import type { prisma } from '@/lib/prisma';
import { getAssignableServices } from '@/app/lib/service-definitions';
import { encryptSecret, decryptSecret, credentialEncryptionReady } from '../crypto';
import { providerSettingsSummary, readProviderAppConfig, saveProviderAppConfig } from '../provider-settings';
import { EXPENSE_CREDENTIAL_SETTINGS_PREFIX, isPrivateExpenseSetting } from '../settings-keys';

const originalEnv = { ...process.env };
afterEach(() => {
  for (const name of ['EXPENSE_CREDENTIAL_KEY', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'EXPENSE_META_CLIENT_ID', 'EXPENSE_META_CLIENT_SECRET']) {
    if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
  }
});
function store() {
  const rows = new Map<string, { key: string; value: string; updatedAt: Date }>();
  const db = { settings: {
    findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) || null,
    findMany: async () => [...rows.values()],
    upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => {
      const row = { key: where.key, value: rows.has(where.key) ? update.value : create.value, updatedAt: new Date('2026-10-05T00:00:00Z') };
      rows.set(where.key, row); return row;
    },
  } } as unknown as typeof prisma;
  return { db, rows };
}
function authEncryption() { delete process.env.EXPENSE_CREDENTIAL_KEY; process.env.NEXTAUTH_SECRET = 'test-only-session-key-do-not-use-in-production'; }

test('encryption works with existing session secret and can still read it after adding a dedicated key', () => {
  authEncryption();
  assert.equal(credentialEncryptionReady(), true);
  const encrypted = encryptSecret('private-app-secret');
  assert.ok(!encrypted.includes('private-app-secret'));
  assert.ok(encrypted.startsWith('v1.auth.'));
  process.env.EXPENSE_CREDENTIAL_KEY = 'cd'.repeat(32);
  assert.equal(decryptSecret(encrypted), 'private-app-secret');
  assert.ok(encryptSecret('new-secret').startsWith('v1.expense.'));
});
test('legacy access tokens remain readable and missing/invalid keys fail closed', () => {
  process.env.EXPENSE_CREDENTIAL_KEY = 'cd'.repeat(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.EXPENSE_CREDENTIAL_KEY, 'hex'), iv);
  const bytes = Buffer.concat([cipher.update('legacy-token'), cipher.final()]);
  const legacy = [iv, cipher.getAuthTag(), bytes].map(value => value.toString('base64')).join('.');
  assert.equal(decryptSecret(legacy), 'legacy-token');
  delete process.env.EXPENSE_CREDENTIAL_KEY; delete process.env.NEXTAUTH_SECRET;
  assert.equal(credentialEncryptionReady(), false);
  assert.throws(() => encryptSecret('secret'));
  process.env.EXPENSE_CREDENTIAL_KEY = 'invalid'; process.env.NEXTAUTH_SECRET = 'some-key';
  assert.equal(credentialEncryptionReady(), false);
  assert.throws(() => decryptSecret(legacy));
});
test('staff settings save encrypted secrets and only expose a configured flag', async () => {
  authEncryption();
  process.env.NEXTAUTH_URL = 'https://example.test';
  const { db, rows } = store();
  await saveProviderAppConfig('meta', { clientId: 'app-123', clientSecret: 'private-secret-123' }, 'staff-1', db);
  const stored = [...rows.values()][0].value;
  assert.ok(!stored.includes('private-secret-123'));
  assert.equal(JSON.parse(stored).updatedBy, 'staff-1');
  assert.deepEqual(await readProviderAppConfig('meta', db), { clientId: 'app-123', clientSecret: 'private-secret-123' });
  const summary = await providerSettingsSummary(db);
  assert.ok(!JSON.stringify(summary).includes('private-secret-123'));
  assert.ok(!JSON.stringify(summary).includes('encryptedClientSecret'));
  const meta = summary.configurations.find(c => c.provider === 'meta')!;
  assert.equal(meta.clientId, 'app-123'); assert.equal(meta.hasClientSecret, true); assert.equal(meta.source, 'settings');
  assert.equal(meta.callbackUrl, 'https://example.test/api/expenses/ad-connections/callback/meta');
});
test('blank secret preserves existing value; changing app ID requires replacement secret', async () => {
  authEncryption();
  const { db } = store();
  await saveProviderAppConfig('tiktok', { clientId: 'app-123', clientSecret: 'original' }, 'staff-1', db);
  await saveProviderAppConfig('tiktok', { clientId: 'app-123', clientSecret: '' }, 'staff-2', db);
  assert.equal((await readProviderAppConfig('tiktok', db)).clientSecret, 'original');
  await assert.rejects(saveProviderAppConfig('tiktok', { clientId: 'other-app', clientSecret: '' }, 'staff-2', db), /تغيير معرف/);
  await saveProviderAppConfig('tiktok', { clientId: 'other-app', clientSecret: 'replacement' }, 'staff-2', db);
  assert.deepEqual(await readProviderAppConfig('tiktok', db), { clientId: 'other-app', clientSecret: 'replacement' });
});
test('environment fallback works and database credentials override the complete pair', async () => {
  authEncryption();
  process.env.EXPENSE_META_CLIENT_ID = 'env-app'; process.env.EXPENSE_META_CLIENT_SECRET = 'env-secret';
  const { db } = store();
  assert.deepEqual(await readProviderAppConfig('meta', db), { clientId: 'env-app', clientSecret: 'env-secret' });
  await saveProviderAppConfig('meta', { clientId: 'env-app', clientSecret: '' }, 'staff-1', db);
  process.env.EXPENSE_META_CLIENT_SECRET = 'changed-env-secret';
  assert.equal((await readProviderAppConfig('meta', db)).clientSecret, 'env-secret');
  await saveProviderAppConfig('meta', { clientId: 'database-app', clientSecret: 'database-secret' }, 'staff-1', db);
  assert.deepEqual(await readProviderAppConfig('meta', db), { clientId: 'database-app', clientSecret: 'database-secret' });
});
test('reserved settings namespace is private and Settings permission can be assigned to staff', () => {
  assert.equal(isPrivateExpenseSetting(`${EXPENSE_CREDENTIAL_SETTINGS_PREFIX}meta`), true);
  assert.equal(isPrivateExpenseSetting('allow_multiple_return_requests'), false);
  assert.equal(isPrivateExpenseSetting(null), false);
  assert.ok(getAssignableServices().some(service => service.key === 'settings'));
});
