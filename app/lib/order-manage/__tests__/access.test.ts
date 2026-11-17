import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_GAP_MS,
  SEND_LIMITS,
  codeMatches,
  codeRowUsable,
  decideSend,
  generateCode,
  generateSessionToken,
  hashCode,
  hashSessionToken,
  isSameOrigin,
  normalizeCode,
  sessionRowValid,
} from '@/app/lib/order-manage/access';

const ENV = { ORDER_MANAGE_SECRET: 'test-secret' };
const NOW = new Date('2026-11-11T12:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

test('codes are six digits', () => {
  for (let index = 0; index < 50; index += 1) assert.match(generateCode(), /^[1-9]\d{5}$/);
});

test('a code typed with Arabic digits or spaces still matches', () => {
  assert.equal(normalizeCode('١٢٣ ٤٥٦'), '123456');
  assert.equal(normalizeCode('۱۲۳۴۵۶'), '123456');
  assert.equal(normalizeCode(' 12-34-56 '), '123456');
  assert.equal(normalizeCode(null), '');
});

test('a code only matches the access row it was issued for', () => {
  const hash = hashCode('123456', 'row-a', ENV);
  assert.equal(codeMatches('123456', 'row-a', hash, ENV), true);
  assert.equal(codeMatches('123457', 'row-a', hash, ENV), false);
  assert.equal(codeMatches('123456', 'row-b', hash, ENV), false);
  assert.equal(codeMatches('123456', 'row-a', '', ENV), false);
  assert.equal(codeMatches('123456', 'row-a', hash, { ORDER_MANAGE_SECRET: 'other' }), false);
});

test('hashing refuses to run without a secret', () => {
  assert.throws(() => hashCode('123456', 'row', {}), /must be set/);
  assert.doesNotThrow(() => hashCode('123456', 'row', { NEXTAUTH_SECRET: 'x' }));
});

test('a code row stops being usable when expired, used, revoked or out of attempts', () => {
  const row = { attempts: 0, codeExpiresAt: later(60_000), verifiedAt: null, revokedAt: null };
  assert.equal(codeRowUsable(row, NOW), true);
  assert.equal(codeRowUsable({ ...row, attempts: CODE_MAX_ATTEMPTS - 1 }, NOW), true);
  assert.equal(codeRowUsable({ ...row, attempts: CODE_MAX_ATTEMPTS }, NOW), false);
  assert.equal(codeRowUsable({ ...row, codeExpiresAt: NOW }, NOW), false);
  assert.equal(codeRowUsable({ ...row, verifiedAt: NOW }, NOW), false);
  assert.equal(codeRowUsable({ ...row, revokedAt: NOW }, NOW), false);
});

test('a session needs a verified, unrevoked, unexpired row', () => {
  const row = { verifiedAt: NOW, revokedAt: null, sessionExpiresAt: later(60_000) };
  assert.equal(sessionRowValid(row, NOW), true);
  assert.equal(sessionRowValid({ ...row, verifiedAt: null }, NOW), false);
  assert.equal(sessionRowValid({ ...row, revokedAt: NOW }, NOW), false);
  assert.equal(sessionRowValid({ ...row, sessionExpiresAt: NOW }, NOW), false);
  assert.equal(sessionRowValid({ ...row, sessionExpiresAt: null }, NOW), false);
});

test('session tokens are random and stored only as a hash', () => {
  const token = generateSessionToken();
  assert.ok(token.length >= 40);
  assert.notEqual(token, generateSessionToken());
  assert.match(hashSessionToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});

test('code sends are throttled per minute, per order and per caller', () => {
  const none = { orderLastHour: 0, orderLastDay: 0, ipLastHour: 0, msSinceLastSend: null };
  assert.deepEqual(decideSend(none), { allowed: true });
  assert.deepEqual(decideSend({ ...none, msSinceLastSend: CODE_RESEND_GAP_MS }), { allowed: true });
  assert.deepEqual(decideSend({ ...none, msSinceLastSend: 15_000 }), { allowed: false, reason: 'wait', retryAfterSeconds: 45 });
  for (const over of [
    { orderLastHour: SEND_LIMITS.perOrderPerHour },
    { orderLastDay: SEND_LIMITS.perOrderPerDay },
    { ipLastHour: SEND_LIMITS.perIpPerHour },
  ]) {
    const decision = decideSend({ ...none, ...over });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.reason, 'limit');
  }
});

test('only our own origin may post', () => {
  const url = 'https://app.mleha.com/api/public/order-manage/start';
  assert.equal(isSameOrigin('https://app.mleha.com', url, {}), true);
  assert.equal(isSameOrigin('https://evil.example', url, {}), false);
  assert.equal(isSameOrigin(null, url, {}), false);
  assert.equal(isSameOrigin('https://mleha.com', url, {}), false);
  assert.equal(isSameOrigin('https://app.mleha.com', 'http://internal:3000/x', { NEXTAUTH_URL: 'https://app.mleha.com/' }), true);
});
