import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ORDER_MANAGE_SETTINGS,
  ORDER_MANAGE_SETTING_KEYS as KEYS,
  isActionEnabled,
  isPilotAllowed,
  isWriteAllowedInThisEnvironment,
  normalizePilotMobiles,
  parseOrderManageSettings,
  sanitizeOrderManageSettingsPatch,
} from '@/app/lib/order-manage/settings';

test('no rows means everything off', () => {
  assert.deepEqual(parseOrderManageSettings({}), DEFAULT_ORDER_MANAGE_SETTINGS);
  assert.equal(DEFAULT_ORDER_MANAGE_SETTINGS.enabled, false);
  assert.equal(DEFAULT_ORDER_MANAGE_SETTINGS.autoRefundEnabled, false);
});

test('parses switches, numbers and the pilot list', () => {
  const settings = parseOrderManageSettings({
    [KEYS.enabled]: 'true',
    [KEYS.cancelEnabled]: '1',
    [KEYS.swapEnabled]: 'yes',
    [KEYS.maxChangesPerOrder]: '5',
    [KEYS.autoRefundDailyCapSar]: '2000',
    [KEYS.pilotMobiles]: '0501234567, +966501234567,abc',
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.cancelEnabled, true);
  assert.equal(settings.swapEnabled, false);
  assert.equal(settings.maxChangesPerOrder, 5);
  assert.equal(settings.autoRefundDailyCapSar, 2000);
  assert.deepEqual(settings.pilotMobiles, ['+966501234567']);
});

test('out-of-range numbers are clamped, garbage falls back', () => {
  assert.equal(parseOrderManageSettings({ [KEYS.maxChangesPerOrder]: '99' }).maxChangesPerOrder, 10);
  assert.equal(parseOrderManageSettings({ [KEYS.maxChangesPerOrder]: '0' }).maxChangesPerOrder, 1);
  assert.equal(parseOrderManageSettings({ [KEYS.maxChangesPerOrder]: 'x' }).maxChangesPerOrder, 3);
  assert.equal(parseOrderManageSettings({ [KEYS.autoRefundDailyCapSar]: '-5' }).autoRefundDailyCapSar, 0);
});

test('a patch keeps only valid fields', () => {
  assert.deepEqual(
    sanitizeOrderManageSettingsPatch({
      enabled: true,
      cancelEnabled: 'true',
      maxChangesPerOrder: 4,
      autoRefundDailyCapSar: 1.5,
      pilotMobiles: ['0501234567', 'nope'],
      unknown: 1,
    }),
    { enabled: true, maxChangesPerOrder: 4, pilotMobiles: ['+966501234567'] },
  );
  assert.deepEqual(sanitizeOrderManageSettingsPatch({ maxChangesPerOrder: 11, autoRefundDailyCapSar: 0 }), {
    autoRefundDailyCapSar: 0,
  });
});

test('an action needs both the master switch and its own', () => {
  const on = { ...DEFAULT_ORDER_MANAGE_SETTINGS, enabled: true, cancelEnabled: true };
  assert.equal(isActionEnabled(on, 'cancel'), true);
  assert.equal(isActionEnabled(on, 'items'), false);
  assert.equal(isActionEnabled({ ...on, enabled: false }, 'cancel'), false);
});

test('pilot list: empty lets everyone in, otherwise only listed mobiles', () => {
  assert.equal(isPilotAllowed(DEFAULT_ORDER_MANAGE_SETTINGS, ['+966500000000']), true);
  const pilot = { ...DEFAULT_ORDER_MANAGE_SETTINGS, pilotMobiles: normalizePilotMobiles('0501234567') };
  assert.equal(isPilotAllowed(pilot, ['+966501234567']), true);
  assert.equal(isPilotAllowed(pilot, ['+966500000000']), false);
  assert.equal(isPilotAllowed(pilot, []), false);
});

test('outside production, writes need the order on the dev allowlist', () => {
  assert.equal(isWriteAllowedInThisEnvironment('1', { NODE_ENV: 'production' }), true);
  assert.equal(isWriteAllowedInThisEnvironment('1', { NODE_ENV: 'development' }), false);
  assert.equal(isWriteAllowedInThisEnvironment('1', {}), false);
  assert.equal(isWriteAllowedInThisEnvironment('2', { NODE_ENV: 'development', ORDER_MANAGE_DEV_ORDER_ALLOWLIST: '1, 2' }), true);
  assert.equal(isWriteAllowedInThisEnvironment('3', { NODE_ENV: 'development', ORDER_MANAGE_DEV_ORDER_ALLOWLIST: '1, 2' }), false);
});
