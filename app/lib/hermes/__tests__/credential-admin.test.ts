import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { createCredential, grantCredentialScopes, revokeCredential, rotateCredential } from '../credential-admin';
import { parseApiKey, verifySecret } from '../credentials';
import { TEST_PEPPER } from './fixtures';

process.env.HERMES_API_KEY_PEPPER = TEST_PEPPER;

const delegate = prisma.hermesApiCredential as any;
const originals = { create: delegate.create, updateMany: delegate.updateMany, update: delegate.update, findUnique: delegate.findUnique };
afterEach(() => Object.assign(delegate, originals));

test('created credentials store only the hash, validate scopes and cap expiry', async () => {
  let stored: any;
  delegate.create = async ({ data }: any) => {
    stored = data;
    return { id: 'cred1' };
  };
  const now = new Date('2026-10-18T00:00:00Z');
  const issued = await createCredential(
    { name: 'Hermes support', merchantId: '1000000001', scopes: ['hermes:support:read'], createdBy: 'ops', expiresInDays: 90 },
    now
  );
  const parsed = parseApiKey(issued.apiKey)!;
  assert.equal(stored.keyId, parsed.keyId);
  assert.ok(!JSON.stringify(stored).includes(parsed.secret), 'plaintext secret is never persisted');
  assert.equal(verifySecret(parsed.secret, stored.secretHash, TEST_PEPPER), true);
  assert.equal(stored.expiresAt.toISOString(), '2027-01-16T00:00:00.000Z');

  for (const scopes of [[], ['admin'], ['hermes:support:read', 'root']]) {
    await assert.rejects(createCredential({ name: 'x', merchantId: '1', scopes, createdBy: 'ops' }));
  }
  await assert.rejects(createCredential({ name: 'x', merchantId: '1', scopes: ['hermes:support:read'], createdBy: 'ops', expiresInDays: 400 }));
});

test('revoking twice is an error rather than a silent no-op', async () => {
  delegate.updateMany = async ({ where }: any) => ({ count: where.revokedAt === null && where.id === 'live' ? 1 : 0 });
  await revokeCredential('live', 'ops', 'leaked');
  await assert.rejects(revokeCredential('gone', 'ops', null));
});

test('rotation issues a replacement and gives the old key a bounded grace period', async () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const updates: any[] = [];
  let created: any;
  delegate.findUnique = async () => ({ id: 'old', name: 'Hermes', merchantId: '1000000001', scopes: ['hermes:manager:reports'], revokedAt: null, expiresAt: null });
  delegate.create = async ({ data }: any) => {
    created = data;
    return { id: 'new' };
  };
  delegate.update = async (args: any) => {
    updates.push(args);
    return { id: 'old' };
  };
  delegate.updateMany = async (args: any) => {
    updates.push(args);
    return { count: 1 };
  };

  const issued = await rotateCredential('old', 'ops', 24, now);
  assert.equal(issued.id, 'new');
  assert.equal(created.rotatedFromId, 'old');
  assert.deepEqual(created.scopes, ['hermes:manager:reports']);
  assert.equal(updates[0].data.expiresAt.toISOString(), '2026-10-19T00:00:00.000Z');

  updates.length = 0;
  await rotateCredential('old', 'ops', 0, now);
  assert.equal(updates[0].data.revokedBy, 'ops', 'zero grace revokes immediately');
});

test('scope grants preserve the key and existing scopes and audit within a transaction', async () => {
  const originalTransaction = prisma.$transaction;
  const events: string[] = [];
  let update: any;
  (prisma as any).$transaction = async (callback: any) => callback({
    hermesApiCredential: {
      findUnique: async () => ({ id: 'manager', merchantId: '1', scopes: ['hermes:manager:pii'], revokedAt: null, expiresAt: null }),
      update: async (args: any) => { events.push('update'); update = args; return args.data; },
    },
    hermesAuditLog: { create: async ({ data }: any) => { events.push('audit'); assert.equal(data.action, 'credentials.grant'); } },
  });
  try {
    await grantCredentialScopes('manager', ['hermes:salla:read', 'hermes:salla:write'], 'operator');
    assert.deepEqual(events, ['audit', 'update']);
    assert.deepEqual(update.data, { scopes: ['hermes:manager:pii', 'hermes:salla:read', 'hermes:salla:write'] });
    await assert.rejects(grantCredentialScopes('manager', ['admin'], 'operator'));
    await assert.rejects(grantCredentialScopes('manager', ['hermes:salla:read'], ''));
  } finally { prisma.$transaction = originalTransaction; }
});
