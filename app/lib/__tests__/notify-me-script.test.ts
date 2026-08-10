import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTIFY_ME_WIDGET_SOURCE } from '@/app/embed/notify-me-widget';
import {
  NOTIFY_ME_SCRIPT_MAX_BYTES,
  NOTIFY_ME_SCRIPT_SERVICE_KEY,
  notifyMeScriptAudit,
  notifyMeScriptByteLength,
  notifyMeScriptChecksum,
  validateNotifyMeScriptSource,
} from '@/app/lib/notify-me-script';
import { getServiceDefinition, getRolesFromServiceKeys } from '@/app/lib/service-definitions';

test('validates the repository notify-me runtime without executing it', () => {
  const validation = validateNotifyMeScriptSource(NOTIFY_ME_WIDGET_SOURCE);
  assert.deepEqual(validation, { valid: true, error: null });
  assert.ok(notifyMeScriptByteLength(NOTIFY_ME_WIDGET_SOURCE) < NOTIFY_ME_SCRIPT_MAX_BYTES);
});

test('rejects empty, malformed, and oversized scripts', () => {
  assert.deepEqual(validateNotifyMeScriptSource('  '), {
    valid: false,
    error: 'السكربت فارغ',
  });

  const malformed = validateNotifyMeScriptSource('(function () {');
  assert.equal(malformed.valid, false);
  assert.match(malformed.error || '', /Unexpected end of input|Unexpected token/);

  const oversized = validateNotifyMeScriptSource('x'.repeat(NOTIFY_ME_SCRIPT_MAX_BYTES + 1));
  assert.equal(oversized.valid, false);
  assert.match(oversized.error || '', /يتجاوز الحد/);
});

test('creates stable sha-256 checksums and normalized audit actors', () => {
  const first = notifyMeScriptChecksum('console.log(1);');
  const second = notifyMeScriptChecksum('console.log(1);');
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);

  assert.deepEqual(
    notifyMeScriptAudit({ id: 'user-1', name: 'Developer', username: 'dev' }),
    { id: 'user-1', name: 'Developer', username: 'dev' }
  );
  assert.deepEqual(notifyMeScriptAudit({ email: 'dev@example.com' }), {
    id: null,
    name: null,
    username: 'dev@example.com',
  });
});

test('exposes a dedicated assignable permission without granting an operational role', () => {
  const service = getServiceDefinition(NOTIFY_ME_SCRIPT_SERVICE_KEY);
  assert.equal(service?.href, '/developer/notify-me');
  assert.equal(service?.assignable, true);
  assert.deepEqual(getRolesFromServiceKeys([NOTIFY_ME_SCRIPT_SERVICE_KEY]), []);
});
