import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMO_LIMIT_WIDGET_SOURCE } from '../promo-limit-widget';

type CartItem = { id: number; product_id: number; quantity: number };

function element(tag: string): any {
  const node: any = {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    attributes: {} as Record<string, string>,
    parentNode: null,
    listeners: {} as Record<string, Array<(event: any) => void>>,
    setAttribute(name: string, value: string) { node.attributes[name] = value; if (name === 'id') node.id = value; },
    getAttribute(name: string) { return node.attributes[name] ?? null; },
    appendChild(child: any) { child.parentNode = node; node.children.push(child); return child; },
    insertBefore(child: any) { child.parentNode = node; node.children.unshift(child); return child; },
    removeChild(child: any) { node.children = node.children.filter((c: any) => c !== child); child.parentNode = null; },
    addEventListener(type: string, fn: (event: any) => void) { (node.listeners[type] ||= []).push(fn); },
    focus() {},
  };
  return node;
}

function setup(options: { used?: number; cart?: CartItem[]; customerId?: string | null; fetchFails?: boolean }) {
  const cart = { items: options.cart ?? [] };
  const calls: string[] = [];
  const fetched: string[] = [];
  const events: Record<string, Array<() => void>> = {};
  let submitFailed = 0;
  const dispatched: string[] = [];

  const body = element('body');
  const head = element('head');
  const byId = (id: string, root: any = body): any => {
    if (root.id === id) return root;
    for (const child of root.children) {
      const hit = byId(id, child);
      if (hit) return hit;
    }
    return null;
  };

  const apiCart: any = {
    details: async () => ({ data: { cart: { items: cart.items } } }),
    getCartPayload(arg: any) {
      const payload = arg && typeof arg === 'object' ? arg : undefined;
      return { id: payload ? payload.product_id ?? payload.id : arg, payload };
    },
    addItem: async function (this: any, arg: any) { calls.push(`addItem:${JSON.stringify(arg)}`); return { ok: true }; },
    quickAdd: async function (this: any, id: number, quantity: number) { calls.push(`quickAdd:${id}`); return this.addItem({ id, quantity }); },
    updateItem: async (arg: any) => { calls.push(`updateItem:${JSON.stringify(arg)}`); return { ok: true }; },
    submit: () => { calls.push('submit'); },
    createQuickOrder: async (payload: any) => { calls.push(`quick:${payload.product_ids.join(',')}`); return { ok: true }; },
  };

  const salla = {
    api: { cart: apiCart },
    cart: Object.assign(Object.create(null), {
      addItem: (arg: any) => apiCart.addItem(arg),
      submit: () => apiCart.submit(),
      event: {
        onUpdated: () => undefined,
        submitFailed: () => { submitFailed += 1; },
      },
    }),
    config: {
      isGuest: () => !options.customerId,
      get: (key: string) => (key === 'user.id' ? options.customerId ?? null : key === 'page.slug' ? 'cart' : undefined),
    },
    event: {
      on: (name: string, fn: () => void) => { (events[name] ||= []).push(fn); },
      dispatch: (name: string) => { dispatched.push(name); },
    },
  };

  const documentStub: any = {
    currentScript: { getAttribute: (name: string) => (name === 'src' ? 'https://app.mleha.com/embed/promo-limit.js' : null) },
    body,
    head,
    documentElement: head,
    createElement: element,
    getElementById: (id: string) => byId(id) || byId(id, head),
    querySelector: () => null,
    addEventListener: () => undefined,
  };

  const windowStub: any = {
    salla,
    location: { href: 'https://mleha.com/ar/cart' },
    sessionStorage: { getItem: () => null, setItem: () => undefined },
    fetch: async (url: string) => {
      fetched.push(url);
      if (options.fetchFails) throw new Error('offline');
      return { ok: true, json: async () => ({ success: true, enabled: true, max: 1, productIds: ['100', '101'], used: options.used ?? 0 }) };
    },
  };

  new Function('window', 'document', 'setTimeout', 'URL', PROMO_LIMIT_WIDGET_SOURCE)(windowStub, documentStub, setTimeout, URL);
  const modal = () => byId('mleha-promo-limit-modal');
  return { salla, apiCart, cart, calls, fetched, modal, dispatched, get submitFailed() { return submitFailed; }, events };
}

test('adding the first promo product goes through', async () => {
  const env = setup({ customerId: '55' });
  await env.salla.api.cart.addItem({ id: 100, quantity: 1 });
  assert.deepEqual(env.calls, ['addItem:{"id":100,"quantity":1}']);
  assert.equal(env.modal(), null);
  assert.match(env.fetched[0], /\/api\/public\/promo-limit\?customerId=55$/);
});

test('a second promo product in the same cart is blocked with the modal', async () => {
  const env = setup({ customerId: '55', cart: [{ id: 1, product_id: 100, quantity: 1 }] });
  await assert.rejects(env.salla.api.cart.addItem({ id: 101, quantity: 1 }), /promo_limit_exceeded/);
  assert.deepEqual(env.calls, []);
  assert.ok(env.modal(), 'blocker modal is shown');
});

test('quantity 2 of one promo product is blocked', async () => {
  const env = setup({ customerId: '55' });
  await assert.rejects(env.salla.api.cart.addItem({ id: 100, quantity: 2 }), /promo_limit_exceeded/);
});

test('a customer who already bought a promo product cannot add another', async () => {
  const env = setup({ customerId: '55', used: 1 });
  await assert.rejects(env.salla.api.cart.quickAdd(101, 1), /promo_limit_exceeded/);
  assert.deepEqual(env.calls, []);
});

test('regular products are never blocked', async () => {
  const env = setup({ customerId: '55', used: 1, cart: [{ id: 1, product_id: 100, quantity: 1 }] });
  await env.salla.api.cart.addItem({ id: 999, quantity: 3 });
  assert.equal(env.calls.length, 1);
});

test('raising a promo line quantity above 1 is blocked, lowering is allowed', async () => {
  const env = setup({ customerId: '55', cart: [{ id: 7, product_id: 100, quantity: 1 }] });
  await assert.rejects(env.salla.api.cart.updateItem({ id: 7, quantity: 2 }), /promo_limit_exceeded/);
  const lower = setup({ customerId: '55', cart: [{ id: 7, product_id: 100, quantity: 2 }] });
  await lower.salla.api.cart.updateItem({ id: 7, quantity: 1 });
  assert.equal(lower.calls.length, 1);
});

test('checkout with two promo units is stopped and the theme button is released', async () => {
  const env = setup({ customerId: '55', cart: [{ id: 1, product_id: 100, quantity: 1 }, { id: 2, product_id: 101, quantity: 1 }] });
  await env.salla.cart.submit();
  assert.ok(!env.calls.includes('submit'));
  assert.equal(env.submitFailed, 1);
  assert.ok(env.modal());
});

test('checkout with exactly one promo unit proceeds', async () => {
  const env = setup({ customerId: '55', cart: [{ id: 1, product_id: 100, quantity: 1 }, { id: 2, product_id: 999, quantity: 4 }] });
  await env.salla.cart.submit();
  assert.deepEqual(env.calls, ['submit']);
});

test('quick order with a promo product is blocked for a returning promo customer', async () => {
  const env = setup({ customerId: '55', used: 1 });
  await assert.rejects(env.salla.api.cart.createQuickOrder({ product_ids: ['100'] }), /promo_limit_exceeded/);
});

test('fails open when the limits API is unreachable', async () => {
  const env = setup({ customerId: '55', fetchFails: true, cart: [{ id: 1, product_id: 100, quantity: 1 }] });
  await env.salla.api.cart.addItem({ id: 101, quantity: 1 });
  assert.equal(env.calls.length, 1);
});

test('guests are checked without a customer id', async () => {
  const env = setup({ customerId: null, cart: [{ id: 1, product_id: 100, quantity: 1 }] });
  await assert.rejects(env.salla.api.cart.addItem({ id: 101, quantity: 1 }), /promo_limit_exceeded/);
  assert.match(env.fetched[0], /\/api\/public\/promo-limit$/);
});

function modalText(modal: any): string {
  const parts: string[] = [];
  const walk = (node: any) => { if (node.textContent) parts.push(node.textContent); (node.children || []).forEach(walk); };
  walk(modal);
  return parts.join(' ');
}

function modalButton(modal: any): any {
  let found: any = null;
  const walk = (node: any) => { if (!found && node.tagName === 'BUTTON') found = node; (node.children || []).forEach(walk); };
  walk(modal);
  return found;
}

test('a guest checking out with a promo product must log in first', async () => {
  const env = setup({ customerId: null, cart: [{ id: 1, product_id: 100, quantity: 1 }] });
  await env.salla.cart.submit();
  assert.ok(!env.calls.includes('submit'), 'checkout did not go ahead');
  assert.equal(env.submitFailed, 1, 'theme button released');
  assert.match(modalText(env.modal()), /سجّلي الدخول/);
  modalButton(env.modal()).listeners.click[0]({});
  assert.deepEqual(env.dispatched, ['login::open'], "Salla's login popup is opened");
});

test('a guest without promo products checks out normally', async () => {
  const env = setup({ customerId: null, cart: [{ id: 1, product_id: 999, quantity: 2 }] });
  await env.salla.cart.submit();
  assert.deepEqual(env.calls, ['submit']);
});

test('a guest quick order with a promo product asks for login', async () => {
  const env = setup({ customerId: null });
  await assert.rejects(env.salla.api.cart.createQuickOrder({ product_ids: ['100'] }), /promo_limit_exceeded/);
  assert.match(modalText(env.modal()), /سجّلي الدخول/);
});

test('a logged-in first-time customer still quick-orders one promo product', async () => {
  const env = setup({ customerId: '55' });
  await env.salla.api.cart.createQuickOrder({ product_ids: ['100'] });
  assert.deepEqual(env.calls, ['quick:100']);
});
