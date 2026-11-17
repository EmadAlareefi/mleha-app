import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { APP_PAGE_SEGMENTS, NON_PAGE_APP_FOLDERS, isUnknownPagePath } from '../app-routes';

test('APP_PAGE_SEGMENTS matches the folders under app/', () => {
  const appDir = path.join(__dirname, '..', '..', 'app');
  const folders = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_PAGE_APP_FOLDERS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual([...APP_PAGE_SEGMENTS].sort(), folders);
});

test('unknown page paths', () => {
  assert.equal(isUnknownPagePath('/this-page-does-not-exist'), true);
  assert.equal(isUnknownPagePath('/return'), true);
  assert.equal(isUnknownPagePath('/returns'), false);
  assert.equal(isUnknownPagePath('/returns-management/abc'), false);
  assert.equal(isUnknownPagePath('/'), false);
  assert.equal(isUnknownPagePath('/api/nope'), false);
});
