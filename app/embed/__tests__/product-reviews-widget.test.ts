import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_REVIEWS_WIDGET_LOADER_SOURCE,
  PRODUCT_REVIEWS_WIDGET_SOURCE,
} from '../product-reviews-widget';

function executeLoader(pageSlug: string | null) {
  const appended: Array<Record<string, unknown>> = [];
  const loader = {
    getAttribute: (name: string) => {
      if (name === 'src') return 'https://app.mleha.com/embed/product-reviews.js';
      if (name === 'data-api') return 'https://app.mleha.com';
      return null;
    },
  };
  const documentStub = {
    currentScript: loader,
    readyState: 'complete',
    head: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    documentElement: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    addEventListener: () => undefined,
    querySelector: () => null,
    createElement: () => {
      const element: Record<string, unknown> = {};
      element.setAttribute = (name: string, value: string) => { element[name] = value; };
      return element;
    },
  };
  const windowStub = {
    location: { href: 'https://mleha.com/ar/product' },
    addEventListener: () => undefined,
    salla: {
      config: {
        get: (path: string) => {
          if (path === 'page.slug') return pageSlug;
          if (path === 'page') return pageSlug ? { slug: pageSlug } : {};
          return undefined;
        },
      },
    },
  };

  new Function('window', 'document', 'setTimeout', 'URL', PRODUCT_REVIEWS_WIDGET_LOADER_SOURCE)(
    windowStub,
    documentStub,
    () => 0,
    URL
  );
  return appended;
}

test('storefront loader downloads the runtime only for a declared product page', () => {
  assert.equal(executeLoader('category.index').length, 0);
  const productScripts = executeLoader('product.single');
  assert.equal(productScripts.length, 1);
  assert.equal(productScripts[0].src, 'https://app.mleha.com/embed/product-reviews-runtime.js');
});

test('runtime resolves the exact DOM product id before Salla config', () => {
  const hidden = { value: '3014694887033630745', getAttribute: () => '3014694887033630745' };
  const documentStub = {
    currentScript: { getAttribute: (name: string) => name === 'data-api' ? 'https://app.mleha.com' : null },
    querySelector: (selector: string) => selector === '#product-form input[name="id"]' ? hidden : null,
  };
  const windowStub: Record<string, unknown> = {
    __mlehaProductReviewsTestMode: true,
    salla: { config: { get: (path: string) => path === 'page.slug' ? 'product.single' : path === 'page.id' ? 123 : undefined } },
  };

  new Function('window', 'document', PRODUCT_REVIEWS_WIDGET_SOURCE)(windowStub, documentStub);
  const helpers = windowStub.__mlehaProductReviewsTest as {
    getProductId: () => string;
    isSingleProductPage: () => boolean;
  };
  assert.equal(helpers.isSingleProductPage(), true);
  assert.equal(helpers.getProductId(), '3014694887033630745');
});

test('runtime renders review values without HTML assignment', () => {
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes('.innerHTML'), false);
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes('textContent = text'), true);
});

test('runtime uses a layout that remains responsive when mounted in a hidden tab', () => {
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes("create('salla-slider'"), false);
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes("create('div', 'mleha-pr__track')"), true);
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes('display:flex;flex-direction:column'), true);
  assert.equal(PRODUCT_REVIEWS_WIDGET_SOURCE.includes('review.reviewImageUrl'), true);
});
