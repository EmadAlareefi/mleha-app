import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveAjexWebhook } from '../ajex-webhook';

const event = { trackingId: 'AJEX-TEST', referenceId: 'test', status: 'Delivered',
  statusCode: 604, eventTime: 1767196800000, timezone: 'Asia/Riyadh' };
const request = (body: unknown = event, auth = 'Bearer secret', contentType = 'application/json') =>
  new Request('https://example.com/api/webhooks/ajex/tracking', { method: 'POST',
    headers: { authorization: auth, 'content-type': contentType }, body: JSON.stringify(body) });

test('stores full callbacks and retries without retaining credentials', async () => {
  const rows: unknown[] = [];
  const payload = { ...event, statusCode: 9999, pod_urls: ['https://example.com/pod'] };
  for (let i = 0; i < 2; i++) {
    const response = await receiveAjexWebhook(request(payload), 'secret', async data => rows.push(data));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { responseCode: '200', responseMessage: 'Success' });
  }
  assert.equal(rows.length, 2);
  assert.deepEqual((rows[0] as { json: unknown }).json, payload);
  assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('rejects missing, wrong, unequal-length and malformed auth without storage', async () => {
  for (const auth of ['', 'Bearer wrong', 'Basic secret', 'Bearer s', 'Bearer secret extra']) {
    assert.equal((await receiveAjexWebhook(request(event, auth), 'secret', async () => assert.fail())).status, 401);
  }
});
test('accepts case-insensitive bearer scheme', async () => {
  assert.equal((await receiveAjexWebhook(request(event, 'bearer secret'), 'secret', async () => {})).status, 200);
});
test('fails closed when token is unconfigured', async () => {
  assert.equal((await receiveAjexWebhook(request(), undefined, async () => assert.fail())).status, 503);
});
test('rejects invalid JSON and event shapes without storage', async () => {
  for (const body of [null, [], {}, { ...event, trackingId: '' }, { ...event, eventTime: -1 },
    { ...event, statusCode: true }, { ...event, eventTime: 'invalid' }]) {
    assert.equal((await receiveAjexWebhook(request(body), 'secret', async () => assert.fail())).status, 400);
  }
  const malformed = new Request('https://example.com', { method: 'POST', body: '{',
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json' } });
  assert.equal((await receiveAjexWebhook(malformed, 'secret', async () => assert.fail())).status, 400);
});
test('rejects non-JSON content type', async () => {
  assert.equal((await receiveAjexWebhook(request(event, 'Bearer secret', 'text/plain'), 'secret', async () => assert.fail())).status, 415);
});
test('does not acknowledge failed persistence', async () => {
  assert.equal((await receiveAjexWebhook(request(), 'secret', async () => { throw new Error('database unavailable'); })).status, 500);
});
