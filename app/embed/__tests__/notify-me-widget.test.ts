import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTIFY_ME_WIDGET_SOURCE } from '../notify-me-widget';

type ClassListStub = {
  add: (...names: string[]) => void;
  contains: (name: string) => boolean;
  remove: (...names: string[]) => void;
};

function classList(...initial: string[]): ClassListStub {
  const names = new Set(initial);
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    contains: (value) => names.has(value),
    remove: (...values) => values.forEach((value) => names.delete(value)),
  };
}

test('matches the live Selia product option markup', () => {
  const exposedSource = NOTIFY_ME_WIDGET_SOURCE.replace(
    /\}\)\(\);\s*$/,
    `window.__mlehaWidgetTest = {
      cleanVariantLabel: cleanVariantLabel,
      getProduct: getProduct,
      getSelectedVariant: getSelectedVariant,
      isSingleProductPage: isSingleProductPage,
      isSoldOut: isSoldOut,
      normalizeSoldOutOptions: normalizeSoldOutOptions,
      preventSoldOutCartSubmission: preventSoldOutCartSubmission
    };})();`
  );

  const visibleLabel = {
    classList: classList('s-product-options-grid-mode-span', 's-product-options-disabled'),
    textContent: 'M - نفدت الكمية',
  };

  const input = {
    checked: false,
    disabled: true,
    name: 'options[1542296633]',
    tagName: 'INPUT',
    value: '1909331672',
    closest: () => optionLabel,
    getAttribute: () => null,
    removeAttribute: (name: string) => {
      if (name === 'disabled') input.disabled = false;
    },
  };

  const optionLabel = {
    classList: classList(
      's-product-options-disabled',
      's-product-options-option-stock-out'
    ),
    querySelector: (selector: string) =>
      selector.includes('input') ? input : selector.includes('grid-mode-span') ? visibleLabel : null,
  };

  const liveOptions = [
    {
      id: 1542296633,
      name: 'المقاسات',
      details: [
        {
          id: 1909331672,
          name: 'M',
          is_out: true,
          skus_availability: { '125665688': false },
        },
        {
          id: 1135293913,
          name: 'L',
          is_out: false,
          skus_availability: { '102287250': true },
        },
      ],
    },
  ];

  const productOptions = {
    getAttribute: (name: string) => {
      if (name === 'options') return JSON.stringify(liveOptions);
      if (name === 'product-id') return '1379647441';
      return null;
    },
    querySelectorAll: () => (input.checked ? [input] : []),
  };

  const hiddenId = { value: '1379647441' };
  const productForm = {
    addEventListener: () => undefined,
    querySelector: (selector: string) => {
      if (selector === 'input[name="id"]') return hiddenId;
      return null;
    },
  };

  const cartButton = {
    parentNode: {},
    style: { display: '' },
    textContent: 'إضافة للسلة',
    getAttribute: () => null,
    hasAttribute: () => false,
  };

  const meta = (content: string) => ({ getAttribute: () => content });
  const documentStub = {
    currentScript: { getAttribute: (name: string) => (name === 'data-api' ? 'https://app.mleha.com' : null) },
    readyState: 'loading',
    title: '',
    addEventListener: () => undefined,
    querySelectorAll: (selector: string) =>
      selector === '.s-product-options-option-stock-out' ? [optionLabel] : [],
    querySelector: (selector: string) => {
      if (selector === '#product-form' || selector === 'form.product-form') return productForm;
      if (
        selector === '#product-form salla-product-options' ||
        selector === 'salla-product-options' ||
        selector.includes('salla-product-options[product-id]')
      ) {
        return productOptions;
      }
      if (selector === '#product-form salla-add-product-button') return cartButton;
      if (selector.includes('s-product-options-option-stock-out') && selector.includes(':checked')) {
        return input.checked ? input : null;
      }
      if (selector.includes('#product-form salla-product-options input') && selector.includes(':checked')) {
        return input.checked ? input : null;
      }
      if (selector.includes('meta[property="og:title"]')) {
        return meta('فستان فرنسي بتدخيلة دانتيل');
      }
      if (selector.includes('meta[property="og:image"]')) {
        return meta('https://cdn.salla.sa/product.jpg');
      }
      if (selector === '.product-sku') return { textContent: '7337' };
      return null;
    },
  };

  const windowStub = {
    location: { pathname: '/ar/7337-french-dress-with-lace-detailing' },
    salla: {
      config: {
        get: (path: string) => {
          if (path === 'page.slug') return 'product.single';
          if (path === 'page.id') return 1379647441;
          return undefined;
        },
      },
    },
  } as Record<string, unknown>;

  new Function('window', 'document', exposedSource)(windowStub, documentStub);

  const helpers = windowStub.__mlehaWidgetTest as {
    cleanVariantLabel: (value: string) => string;
    getProduct: () => { id: string; name: string; sku: string };
    getSelectedVariant: () => { id: string; name: string; size: string };
    isSingleProductPage: () => boolean;
    isSoldOut: () => boolean;
    normalizeSoldOutOptions: () => void;
    preventSoldOutCartSubmission: (event: {
      preventDefault: () => void;
      stopImmediatePropagation: () => void;
      stopPropagation: () => void;
    }) => void;
  };

  assert.equal(helpers.isSingleProductPage(), true);
  assert.deepEqual(helpers.getProduct(), {
    id: '1379647441',
    image: 'https://cdn.salla.sa/product.jpg',
    name: 'فستان فرنسي بتدخيلة دانتيل',
    sku: '7337',
  });

  helpers.normalizeSoldOutOptions();
  assert.equal(visibleLabel.textContent, 'M');
  assert.equal(input.disabled, false);
  assert.equal(optionLabel.classList.contains('s-product-options-disabled'), false);
  assert.equal(visibleLabel.classList.contains('s-product-options-disabled'), false);

  input.checked = true;
  assert.equal(helpers.isSoldOut(), true);
  assert.deepEqual(helpers.getSelectedVariant(), {
    id: '125665688',
    name: 'M',
    size: 'M',
  });

  let prevented = 0;
  helpers.preventSoldOutCartSubmission({
    preventDefault: () => {
      prevented += 1;
    },
    stopImmediatePropagation: () => undefined,
    stopPropagation: () => undefined,
  });
  assert.equal(prevented, 1);

  assert.equal(helpers.cleanVariantLabel('XL - نفذت الكمية'), 'XL');
  assert.match(
    NOTIFY_ME_WIDGET_SOURCE,
    /s-product-options-option-stock-out \.s-product-options-disabled\{opacity:1!important/
  );
});
