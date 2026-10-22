import assert from 'node:assert/strict';
import { beforeEach, after, test } from 'node:test';
import { GET as capabilities } from '@/app/api/integrations/hermes/salla/capabilities/route';
import { POST as read } from '@/app/api/integrations/hermes/salla/read/route';
import { POST as write } from '@/app/api/integrations/hermes/salla/write/route';
import { setHermesStore } from '../handler';
import { setSallaBridgeDependencies } from '../salla';
import { emptyDb, createMemoryStore, addCredential, request, TEST_PEPPER, MERCHANT_A } from './fixtures';

let db = emptyDb();
let requests: unknown[][];
let scopes: string[];
let upstreamStatus: number;
let failTransport: boolean;
const manager = ['hermes:salla:read', 'hermes:salla:write', 'hermes:manager:pii'];
beforeEach(() => {
  db = emptyDb(); requests = []; scopes = ['products.read_write']; upstreamStatus = 200; failTransport = false;
  process.env.HERMES_API_ENABLED = 'true';
  process.env.HERMES_API_KEY_PEPPER = TEST_PEPPER;
  setHermesStore(createMemoryStore(db, {}));
  setSallaBridgeDependencies({
    async scopes(merchant) { assert.equal(merchant, MERCHANT_A); return scopes; },
    async request(...args) {
      requests.push(args);
      if (args[2] !== 'GET') assert.ok(db.audits.some(row => row.action.endsWith('.attempt')));
      if (failTransport) throw new Error('secret upstream failure');
      return { status: upstreamStatus, body: { data: { id: 123, name: 'Test', access_token: 'hidden', nested: { password: 'hidden' } } } };
    },
  });
});
after(() => { setSallaBridgeDependencies(null); setHermesStore(null); });
async function call(handler: typeof read, body: Record<string, unknown>, granted = manager) {
  const { apiKey } = addCredential(db, granted);
  const response = await handler(request('/api/integrations/hermes/salla/read', { apiKey, method: 'POST', body }));
  return { status: response.status, body: await response.json() };
}
test('old support and manager scopes cannot access live Salla', async () => {
  for (const granted of [['hermes:support:read'], ['hermes:manager:pii'], ['hermes:salla:read']]) {
    assert.equal((await call(read, { operation: 'products.list' }, granted)).status, 403);
  }
  assert.equal(requests.length, 0);
});
test('live read uses credential tenant, bounded pagination, encoded query and scrubbed secrets', async () => {
  const result = await call(read, { operation: 'products.list', query_json: '{"keyword":"blue & red"}' });
  assert.equal(result.status, 200);
  assert.deepEqual(requests[0], [MERCHANT_A, '/products?keyword=blue+%26+red&per_page=50', 'GET', undefined]);
  assert.equal(JSON.stringify(result.body).includes('hidden'), false);
  assert.equal(result.body.meta.source, 'salla_live');
  assert.equal(db.audits.at(-1)?.classification, 'pii:full');
});
test('writes require write permission and cannot pass through read tool', async () => {
  assert.equal((await call(write, { operation: 'products.update', id: '123' }, ['hermes:salla:read', 'hermes:manager:pii'])).status, 403);
  assert.equal((await call(read, { operation: 'products.update', id: '123' })).status, 400);
  assert.equal((await call(write, { operation: 'products.list' })).status, 400);
  assert.equal(requests.length, 0);
});
test('write intent is audited before request and payload goes only to numeric Salla ID', async () => {
  const result = await call(write, { operation: 'products.update', id: '123', payload_json: '{"price":25}' });
  assert.equal(result.status, 200);
  assert.deepEqual(requests[0], [MERCHANT_A, '/products/123', 'PUT', '{"price":25}']);
  assert.equal(db.audits.length, 2);
});
test('scope denial happens before external call', async () => {
  scopes = ['products.read'];
  const result = await call(write, { operation: 'products.update', id: '123' });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.details.required_salla_scope, 'products.read_write');
  assert.equal(requests.length, 0);
});
test('URL injection, method overrides, tenant overrides and malformed parameters fail closed', async () => {
  for (const body of [
    { operation: 'https://evil.test' }, { operation: 'products.get', id: '../customers' },
    { operation: 'products.get', id: '123?token=x' }, { operation: 'products.list', id: '123' },
    { operation: 'products.list', query_json: '{"_method":"DELETE"}' },
    { operation: 'products.list', query_json: '{"merchant_id":"2"}' },
    { operation: 'products.list', query_json: '{"per_page":101}' },
    { operation: 'products.list', payload_json: '{}' },
    { operation: 'products.list', query_json: '[]' },
  ]) assert.equal((await call(read, body)).status, 400);
  assert.equal(requests.length, 0);
});
test('upstream denial is not reported as an empty successful response', async () => {
  upstreamStatus = 403;
  assert.equal((await call(read, { operation: 'products.list' })).status, 403);
});
test('mutation timeout is explicitly uncertain and is never automatically retried', async () => {
  failTransport = true;
  const result = await call(write, { operation: 'products.update', id: '123', payload_json: '{"price":25}' });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.details.mutation_outcome, 'unknown_do_not_retry');
  assert.equal(requests.length, 1);
  assert.ok(!JSON.stringify(result.body).includes('secret upstream'));
});
test('audit failure blocks external mutation', async () => {
  const store = createMemoryStore(db, {});
  store.writeAudit = async () => { throw new Error('audit offline'); };
  setHermesStore(store);
  assert.equal((await call(write, { operation: 'products.update', id: '123' })).status, 500);
  assert.equal(requests.length, 0);
});
test('capabilities distinguishes unsupported token scopes and credential write rights', async () => {
  const { apiKey } = addCredential(db, ['hermes:salla:read', 'hermes:manager:pii']);
  const response = await capabilities(request('/api/integrations/hermes/salla/capabilities', { apiKey }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.operations.find((op: { name: string }) => op.name === 'products.list').available, true);
  assert.equal(body.data.operations.find((op: { name: string }) => op.name === 'products.update').available, false);
  assert.equal(body.data.operations.find((op: { name: string }) => op.name === 'customers.list').available, false);
});
