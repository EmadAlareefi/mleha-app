import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTALL_SNOOZE_MS,
  canOfferInstall,
  detectInstallPlatform,
  isInstallBadgeSuppressed,
  isIosInAppBrowser,
  isSnoozed,
} from '../pwa';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

test('detectInstallPlatform', () => {
  assert.equal(detectInstallPlatform(IPHONE), 'ios');
  assert.equal(detectInstallPlatform(ANDROID), 'android');
  assert.equal(detectInstallPlatform(MAC, 'MacIntel', 0), 'desktop');
  // iPadOS pretends to be a Mac.
  assert.equal(detectInstallPlatform(MAC, 'MacIntel', 5), 'ios');
});

test('isIosInAppBrowser', () => {
  assert.equal(isIosInAppBrowser(IPHONE), false);
  assert.equal(isIosInAppBrowser(`${IPHONE} Instagram 300.0`), true);
});

test('isSnoozed', () => {
  const now = 1_800_000_000_000;
  assert.equal(isSnoozed(null, now), false);
  assert.equal(isSnoozed('garbage', now), false);
  assert.equal(isSnoozed(String(now - 1000), now), true);
  assert.equal(isSnoozed(String(now - INSTALL_SNOOZE_MS - 1), now), false);
});

test('canOfferInstall', () => {
  assert.equal(canOfferInstall({ installed: true, hasPrompt: true, platform: 'android' }), false);
  assert.equal(canOfferInstall({ installed: false, hasPrompt: false, platform: 'ios' }), true);
  assert.equal(canOfferInstall({ installed: false, hasPrompt: false, platform: 'android' }), true);
  assert.equal(canOfferInstall({ installed: false, hasPrompt: false, platform: 'desktop' }), false);
  assert.equal(canOfferInstall({ installed: false, hasPrompt: true, platform: 'desktop' }), true);
});

test('isInstallBadgeSuppressed', () => {
  assert.equal(isInstallBadgeSuppressed('/login'), true);
  assert.equal(isInstallBadgeSuppressed('/embed/size-guide'), true);
  assert.equal(isInstallBadgeSuppressed('/admin/order-prep/live'), true);
  assert.equal(isInstallBadgeSuppressed('/order-prep'), false);
  assert.equal(isInstallBadgeSuppressed('/'), false);
});
