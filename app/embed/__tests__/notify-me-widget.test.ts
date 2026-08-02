import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOTIFY_ME_WIDGET_LOADER_SOURCE,
  NOTIFY_ME_WIDGET_SOURCE,
} from '../notify-me-widget';

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

test('matches the live Selia product option markup', async () => {
  const exposedSource = NOTIFY_ME_WIDGET_SOURCE.replace(
    /\}\)\(\);\s*$/,
    `window.__mlehaWidgetTest = {
      cleanVariantLabel: cleanVariantLabel,
      getProduct: getProduct,
      getSelectedVariant: getSelectedVariant,
      isSingleProductPage: isSingleProductPage,
      isSoldOut: isSoldOut,
      isRegistered: isRegistered,
      hasUsablePhone: hasUsablePhone,
      normalizePhoneInput: normalizePhoneInput,
      rememberRegistration: rememberRegistration,
      normalizeSoldOutOptions: normalizeSoldOutOptions,
      preventSoldOutCartSubmission: preventSoldOutCartSubmission,
      restoreRegisteredSoldOutOption: restoreRegisteredSoldOutOption,
      selectOnlyRadioOption: selectOnlyRadioOption,
      submit: submit
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
    type: 'radio',
    value: '1909331672',
    closest: (selector: string) =>
      selector === 'salla-product-options' ? productOptions : optionLabel,
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

  const secondVisibleLabel = {
    classList: classList('s-product-options-grid-mode-span', 's-product-options-disabled'),
    textContent: 'S - نفدت الكمية',
  };

  const secondInput = {
    checked: false,
    disabled: true,
    name: 'options[1542296633]',
    tagName: 'INPUT',
    type: 'radio',
    value: '669120479',
    closest: (selector: string) =>
      selector === 'salla-product-options' ? productOptions : secondOptionLabel,
    getAttribute: () => null,
    removeAttribute: (name: string) => {
      if (name === 'disabled') secondInput.disabled = false;
    },
  };

  const secondOptionLabel = {
    classList: classList(
      's-product-options-disabled',
      's-product-options-option-stock-out'
    ),
    querySelector: (selector: string) =>
      selector.includes('input')
        ? secondInput
        : selector.includes('grid-mode-span')
          ? secondVisibleLabel
          : null,
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
          id: 669120479,
          name: 'S',
          is_out: true,
          skus_availability: { '1553425047': false },
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
    querySelectorAll: (selector: string): typeof input[] => {
      if (selector === 'input[type="radio"]') return [input, secondInput];
      return [input, secondInput].filter((item) => item.checked);
    },
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
    disabled: false,
    hasAttribute: (name: string) => name === 'disabled' && cartButton.disabled,
  };

  const meta = (content: string) => ({ getAttribute: () => content });
  const documentStub = {
    currentScript: { getAttribute: (name: string) => (name === 'data-api' ? 'https://app.mleha.com' : null) },
    readyState: 'loading',
    title: '',
    addEventListener: () => undefined,
    querySelectorAll: (selector: string) =>
      selector === '.s-product-options-option-stock-out'
        ? [optionLabel, secondOptionLabel]
        : [],
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

  const storage = new Map<string, string>();
  const windowStub = {
    location: { pathname: '/ar/7337-french-dress-with-lace-detailing' },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
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
    isRegistered: (productId: string, variationId: string) => boolean;
    hasUsablePhone: (value: string) => boolean;
    normalizePhoneInput: (value: string) => string;
    rememberRegistration: (payload: {
      productId: string;
      requestedSize: string;
      variationId: string;
      variationName: string;
    }) => void;
    normalizeSoldOutOptions: () => void;
    preventSoldOutCartSubmission: (event: {
      preventDefault: () => void;
      stopImmediatePropagation: () => void;
      stopPropagation: () => void;
      target?: { closest: (selector: string) => unknown };
    }) => void;
    restoreRegisteredSoldOutOption: (product: { id: string }) => void;
    selectOnlyRadioOption: (input: { checked: boolean }) => void;
    submit: (
      payload: Record<string, unknown>,
      onDone: (done: boolean, duplicate: boolean) => void
    ) => void;
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
  assert.equal(secondVisibleLabel.textContent, 'S');

  // A required option can disable add-to-cart before the customer chooses a
  // size; disabled alone must not turn an available product into "sold out".
  cartButton.disabled = true;
  assert.equal(helpers.isSoldOut(), false);
  cartButton.disabled = false;

  secondInput.checked = true;
  helpers.selectOnlyRadioOption(input);
  assert.equal(input.checked, true);
  assert.equal(secondInput.checked, false);

  assert.equal(helpers.isSoldOut(), true);
  assert.deepEqual(helpers.getSelectedVariant(), {
    id: '125665688',
    name: 'M',
    size: 'M',
  });

  helpers.rememberRegistration({
    productId: '1379647441',
    requestedSize: 'M',
    variationId: '125665688',
    variationName: 'M',
  });
  assert.equal(helpers.isRegistered('1379647441', '125665688'), true);
  storage.set(
    'mleha-notify-registration:v1:1379647441:expired',
    JSON.stringify({ registeredAt: Date.now() - 25 * 60 * 60 * 1000 })
  );
  assert.equal(helpers.isRegistered('1379647441', 'expired'), false);
  assert.equal(storage.has('mleha-notify-registration:v1:1379647441:expired'), false);
  storage.set(
    'mleha-notify-registration:v1:1379647441:1553425047',
    JSON.stringify({
      productId: '1379647441',
      variationId: '1553425047',
      variationName: 'S',
      registeredAt: Date.now() - 1_000,
    })
  );

  input.checked = false;
  helpers.restoreRegisteredSoldOutOption({ id: '1379647441' });
  helpers.normalizeSoldOutOptions();
  assert.equal(input.checked, true);
  assert.equal(secondInput.checked, false);

  // Selia may briefly clear the radio group while redrawing it. Restoration is
  // deliberately one-time so that redraw cannot jump back to an older saved
  // size after the customer makes a new choice.
  input.checked = false;
  secondInput.checked = false;
  helpers.restoreRegisteredSoldOutOption({ id: '1379647441' });
  assert.equal(input.checked, false);
  assert.equal(secondInput.checked, false);

  input.checked = true;

  let prevented = 0;
  helpers.preventSoldOutCartSubmission({
    preventDefault: () => {
      prevented += 1;
    },
    stopImmediatePropagation: () => undefined,
    stopPropagation: () => undefined,
  });
  assert.equal(prevented, 1);

  let widgetSubmitPrevented = 0;
  helpers.preventSoldOutCartSubmission({
    preventDefault: () => {
      widgetSubmitPrevented += 1;
    },
    stopImmediatePropagation: () => undefined,
    stopPropagation: () => undefined,
    target: {
      closest: (selector: string) => (selector === '.mleha-nm' ? {} : null),
    },
  });
  assert.equal(widgetSubmitPrevented, 0);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    json: async () => ({ success: true, duplicate: true }),
    ok: true,
    status: 200,
  })) as unknown as typeof fetch;
  try {
    const duplicateResult = await new Promise<{ done: boolean; duplicate: boolean }>((resolve) => {
      helpers.submit(
        {
          productId: '1379647441',
          requestedSize: 'M',
          variationId: '125665688',
          variationName: 'M',
        },
        (done, duplicate) => resolve({ done, duplicate })
      );
    });
    assert.deepEqual(duplicateResult, { done: true, duplicate: true });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(helpers.cleanVariantLabel('XL - نفذت الكمية'), 'XL');
  assert.equal(helpers.normalizePhoneInput('٠٥٠ ١٢٣ ٤٥٦٧'), '0501234567');
  assert.equal(helpers.hasUsablePhone('+966501234567'), true);
  assert.equal(helpers.hasUsablePhone('+9660501234567'), false);
  assert.match(
    NOTIFY_ME_WIDGET_SOURCE,
    /s-product-options-option-stock-out \.s-product-options-disabled\{opacity:1!important/
  );
  assert.match(NOTIFY_ME_WIDGET_SOURCE, /سنرسل الإشعار عبر واتساب على الرقم/);
  assert.match(NOTIFY_ME_WIDGET_SOURCE, /mleha-nm__registered/);
  assert.doesNotMatch(NOTIFY_ME_WIDGET_SOURCE, /left:-9999px/);
  assert.match(NOTIFY_ME_WIDGET_SOURCE, /clip:rect\(0,0,0,0\)!important/);
  assert.match(NOTIFY_ME_WIDGET_SOURCE, /var panel = el\('div', 'mleha-nm__panel'\)/);
  assert.match(NOTIFY_ME_WIDGET_SOURCE, /submitBtn\.type = 'button'/);
  assert.doesNotMatch(NOTIFY_ME_WIDGET_SOURCE, /observer\.observe\(document\.body/);
});

test('loader fetches the runtime only on an explicit single-product page', () => {
  function run(pageType: string) {
    const appended: Array<Record<string, unknown>> = [];
    const loader = {
      getAttribute: (name: string) => {
        if (name === 'src') return 'https://app.mleha.com/embed/notify-me.js';
        if (name === 'data-api') return 'https://app.mleha.com';
        return null;
      },
    };
    const documentStub = {
      currentScript: loader,
      readyState: 'complete',
      head: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
      documentElement: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
      querySelector: () => loader,
      createElement: () => ({
        setAttribute(name: string, value: string) {
          (this as Record<string, unknown>)[name] = value;
        },
      }),
      addEventListener: () => undefined,
    };
    const windowStub = {
      location: { href: 'https://mleha.com/ar/example' },
      salla: { config: { get: () => pageType } },
    } as Record<string, unknown>;

    new Function('window', 'document', 'URL', 'setTimeout', NOTIFY_ME_WIDGET_LOADER_SOURCE)(
      windowStub,
      documentStub,
      URL,
      setTimeout
    );
    return appended;
  }

  assert.equal(run('home').length, 0);
  assert.equal(run('category').length, 0);
  const productScripts = run('product.single');
  assert.equal(productScripts.length, 1);
  assert.equal(productScripts[0].src, 'https://app.mleha.com/embed/notify-me-runtime.js');
  assert.equal(productScripts[0].async, true);
});

test('loader reads Salla native page objects', () => {
  const appended: Array<Record<string, unknown>> = [];
  const loader = {
    getAttribute: (name: string) =>
      name === 'src' ? 'https://app.mleha.com/embed/notify-me.js' : null,
  };
  const documentStub = {
    currentScript: loader,
    readyState: 'complete',
    head: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    documentElement: { appendChild: (node: Record<string, unknown>) => appended.push(node) },
    querySelector: () => loader,
    createElement: () => ({
      setAttribute(name: string, value: string) {
        (this as Record<string, unknown>)[name] = value;
      },
    }),
    addEventListener: () => undefined,
  };
  const windowStub = {
    location: { href: 'https://mleha.com/ar/product' },
    salla: {
      config: {
        get: (key: string) => (key === 'page' ? { id: 123, slug: 'product.single' } : undefined),
      },
    },
  } as Record<string, unknown>;

  new Function('window', 'document', 'URL', 'setTimeout', NOTIFY_ME_WIDGET_LOADER_SOURCE)(
    windowStub,
    documentStub,
    URL,
    setTimeout
  );
  assert.equal(appended.length, 1);
});
