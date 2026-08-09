import assert from 'node:assert/strict';
import test from 'node:test';
import { SIZE_GUIDE_WIDGET_LOADER_SOURCE, SIZE_GUIDE_WIDGET_SOURCE } from '../size-guide-widget';

function executeLoader(pageSlug: string) {
  const appended: Array<Record<string, unknown>> = [];
  const loader = {
    getAttribute: (name: string) => name === 'src'
      ? 'https://app.mleha.com/embed/size-guide.js'
      : name === 'data-api' ? 'https://app.mleha.com' : null,
  };
  const documentStub = {
    currentScript: loader,
    readyState: 'complete',
    head: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    documentElement: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    querySelector: () => null,
    createElement: () => ({
      setAttribute(name: string, value: string) { (this as Record<string, unknown>)[name] = value; },
    }),
    addEventListener: () => undefined,
  };
  const windowStub = {
    location: { href: 'https://mleha.com/ar/product' },
    addEventListener: () => undefined,
    salla: { config: { get: (key: string) => key === 'page' ? { slug: pageSlug } : key === 'page.slug' ? pageSlug : undefined } },
  } as Record<string, unknown>;

  new Function('window', 'document', 'setTimeout', 'URL', SIZE_GUIDE_WIDGET_LOADER_SOURCE)(
    windowStub, documentStub, setTimeout, URL
  );
  return appended;
}

test('loader requests the runtime only on a declared product page', () => {
  assert.equal(executeLoader('category.index').length, 0);
  const scripts = executeLoader('product.single');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://app.mleha.com/embed/size-guide-runtime.js');
  assert.equal(scripts[0].async, true);
});

test('runtime fit helper chooses the first accommodating size', () => {
  const windowStub: Record<string, any> = {
    __mlehaSizeGuideTestMode: true,
    salla: { config: { get: (key: string) => key === 'page.slug' ? 'product.single' : undefined } },
  };
  const hidden = { value: '3014694887033630745', getAttribute: () => '3014694887033630745' };
  const documentStub = {
    currentScript: { getAttribute: (name: string) => name === 'data-api' ? 'https://app.mleha.com' : null },
    querySelector: (selector: string) => selector === '#product-form input[name="id"]' ? hidden : null,
  };

  new Function('window', 'document', SIZE_GUIDE_WIDGET_SOURCE)(windowStub, documentStub);
  const helpers = windowStub.__mlehaSizeGuideTest;
  const rows = [
    { size: 'S', CHEST: '36', WAIST: '28' },
    { size: 'M', CHEST: '38', WAIST: '30' },
    { size: 'L', CHEST: '40', WAIST: '32' },
  ];
  assert.equal(helpers.getProductId(), '3014694887033630745');
  assert.deepEqual(helpers.findFit(rows, { CHEST: 37, WAIST: 29 }), { index: 1, size: 'M', exact: false });
  assert.equal(helpers.number('-'), null);
});

test('runtime is database-backed and does not contain the Google Sheet URL or unsafe dynamic HTML', () => {
  assert.match(SIZE_GUIDE_WIDGET_SOURCE, /\/api\/public\/size-guides/);
  assert.doesNotMatch(SIZE_GUIDE_WIDGET_SOURCE, /docs\.google\.com\/spreadsheets/);
  assert.doesNotMatch(SIZE_GUIDE_WIDGET_SOURCE, /innerHTML/);
});

test('drawer isolates the Salla option UI and uses an idempotent compensated scroll lock', () => {
  assert.match(SIZE_GUIDE_WIDGET_SOURCE, /options\.insertAdjacentElement\('beforebegin', trigger\)/);
  assert.match(SIZE_GUIDE_WIDGET_SOURCE, /event\.stopPropagation\(\)/);
  assert.match(SIZE_GUIDE_WIDGET_SOURCE, /window\.innerWidth - root\.clientWidth/);
  assert.match(SIZE_GUIDE_WIDGET_SOURCE, /if \(!overlay \|\| !drawer \|\| state\.isOpen\) \{ return; \}/);
  assert.doesNotMatch(SIZE_GUIDE_WIDGET_SOURCE, /backdrop-filter/);
});
