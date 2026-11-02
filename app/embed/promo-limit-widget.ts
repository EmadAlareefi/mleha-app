/**
 * Storefront guard for the "1 SAR" promo category on mleha.com.
 *
 * Each customer may get at most `max` (1) unit from the whole promo category,
 * in one order or across orders. The script wraps the Twilight cart API
 * (addItem/quickAdd, updateItem, submit, createQuickOrder) so every entry point
 * — the theme's buttons, the cart page and third-party cart drawers — hits the
 * same check, and shows an Arabic blocker instead of letting the action through.
 *
 * Fails open: if app.mleha.com is unreachable the store keeps working, and the
 * order-prep / order-shipping guards still catch the order.
 */
export const PROMO_LIMIT_WIDGET_SOURCE = String.raw`
(function () {
  'use strict';
  if (window.__mlehaPromoLimit) { return; }
  window.__mlehaPromoLimit = true;

  var script = document.currentScript || (document.querySelector && document.querySelector('script[src*="/embed/promo-limit.js"]'));
  var scriptSrc = script && script.getAttribute('src') || '';
  var API_BASE = (script && script.getAttribute('data-api') || '').replace(/\/+$/, '');
  if (!API_BASE && scriptSrc) {
    try { API_BASE = new URL(scriptSrc, window.location.href).origin; } catch (error) { API_BASE = ''; }
  }
  var DEBUG = !!(script && script.getAttribute('data-debug'));
  var CACHE_MS = 2 * 60 * 1000;
  var STORAGE_KEY = 'mleha_promo_limit_v1';
  var MODAL_ID = 'mleha-promo-limit-modal';
  var BANNER_ID = 'mleha-promo-limit-banner';
  var STYLE_ID = 'mleha-promo-limit-styles';

  var state = { data: null, customerKey: null, fetchedAt: 0, pending: null, cartViolation: false };
  var passthrough = {};

  function debug() {
    if (!DEBUG) { return; }
    try { console.log.apply(console, ['[mleha-promo-limit]'].concat([].slice.call(arguments))); } catch (error) {}
  }

  function sdk() { return window.salla || window.Salla || null; }

  function customerId() {
    try {
      var s = sdk();
      if (!s || !s.config || typeof s.config.get !== 'function') { return ''; }
      if (typeof s.config.isGuest === 'function' && s.config.isGuest()) { return ''; }
      var id = s.config.get('user.id');
      return id == null ? '' : String(id).replace(/[^0-9]/g, '');
    } catch (error) { return ''; }
  }

  function readStorage() {
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) { return null; }
  }

  function writeStorage(value) {
    try { if (window.sessionStorage) { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } }
    catch (error) {}
  }

  /** Resolves {enabled, max, productIds:Set, used} or null when unavailable (fail open). */
  function loadLimits(force) {
    var key = customerId() || 'guest';
    var now = Date.now();
    if (!force && state.data && state.customerKey === key && now - state.fetchedAt < CACHE_MS) {
      return Promise.resolve(state.data);
    }
    if (!force) {
      var stored = readStorage();
      if (stored && stored.key === key && now - stored.at < CACHE_MS && stored.data) {
        state.data = hydrate(stored.data); state.customerKey = key; state.fetchedAt = stored.at;
        return Promise.resolve(state.data);
      }
    }
    if (state.pending && state.pending.key === key) { return state.pending.promise; }
    if (!API_BASE || typeof window.fetch !== 'function') { return Promise.resolve(null); }

    var url = API_BASE + '/api/public/promo-limit' + (key !== 'guest' ? '?customerId=' + encodeURIComponent(key) : '');
    var promise = window.fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        state.pending = null;
        if (!body || !body.success) { return null; }
        var raw = { enabled: !!body.enabled, max: Number(body.max) || 1, productIds: body.productIds || [], used: Number(body.used) || 0 };
        state.data = hydrate(raw); state.customerKey = key; state.fetchedAt = Date.now();
        writeStorage({ key: key, at: state.fetchedAt, data: raw });
        debug('limits', raw.max, 'used', raw.used, 'products', raw.productIds.length);
        return state.data;
      })
      .catch(function (error) { state.pending = null; debug('lookup failed', error); return null; });
    state.pending = { key: key, promise: promise };
    return promise;
  }

  function hydrate(raw) {
    var ids = {};
    (raw.productIds || []).forEach(function (id) { ids[String(id)] = true; });
    return { enabled: raw.enabled, max: raw.max, used: raw.used, ids: ids };
  }

  function isPromo(limits, productId) {
    return !!(limits && limits.enabled && productId != null && limits.ids[String(productId)]);
  }

  function cartItems(response) {
    var data = response && (response.data || response);
    var cart = data && (data.cart || data);
    var items = cart && cart.items;
    return Array.isArray(items) ? items : [];
  }

  function itemProductId(item) {
    if (!item) { return null; }
    if (item.product_id != null) { return String(item.product_id); }
    if (item.product && item.product.id != null) { return String(item.product.id); }
    return null;
  }

  /** Current cart lines; an empty list when the cart doesn't exist yet. */
  function currentCart() {
    var s = sdk();
    var api = s && s.api && s.api.cart;
    if (!api || typeof api.details !== 'function') { return Promise.resolve([]); }
    return Promise.resolve()
      .then(function () { return api.details(); })
      .then(cartItems)
      .catch(function () { return []; });
  }

  function promoUnits(limits, items, skipItemId) {
    var total = 0;
    items.forEach(function (item) {
      if (skipItemId != null && String(item.id) === String(skipItemId)) { return; }
      if (isPromo(limits, itemProductId(item))) { total += Number(item.quantity) || 0; }
    });
    return total;
  }

  function possible(payload, keys) {
    try {
      var s = sdk();
      if (s && s.form && typeof s.form.getPossibleValue === 'function') { return s.form.getPossibleValue(payload, keys); }
    } catch (error) {}
    if (!payload) { return undefined; }
    for (var i = 0; i < keys.length; i += 1) {
      if (typeof payload.get === 'function' && payload.get(keys[i]) != null) { return payload.get(keys[i]); }
      if (payload[keys[i]] != null) { return payload[keys[i]]; }
    }
    return undefined;
  }

  function parsePayload(api, arg) {
    try {
      if (api && typeof api.getCartPayload === 'function') { return api.getCartPayload(arg); }
    } catch (error) {}
    var payload = arg && (arg.data || (typeof arg === 'object' ? arg : undefined));
    return { id: payload ? possible(payload, ['prod_id', 'product_id', 'item_id', 'id']) : arg, payload: payload };
  }

  function quantityOf(payload, fallback) {
    var value = Number(possible(payload, ['quantity']));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  // ------------------------------------------------------------------ UI

  function message(limits) {
    if (limits && limits.used >= limits.max) {
      return 'لقد حصلتِ مسبقاً على منتج من عرض الريال في طلب سابق. العرض متاح لقطعة واحدة فقط لكل عميل.';
    }
    return 'يمكنك الحصول على قطعة واحدة فقط من منتجات عرض الريال. يرجى إبقاء قطعة واحدة فقط في السلة لإكمال الطلب.';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) { return; }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(17,17,17,.55);padding:16px;direction:rtl;font-family:inherit}',
      '#' + MODAL_ID + ' .mpl-card{background:#fff;color:#1f1f1f;max-width:380px;width:100%;border-radius:16px;padding:24px 20px 18px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25)}',
      '#' + MODAL_ID + ' .mpl-icon{width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:#fdecea;color:#b3261e;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700}',
      '#' + MODAL_ID + ' h3{margin:0 0 8px;font-size:18px;font-weight:700}',
      '#' + MODAL_ID + ' p{margin:0 0 18px;font-size:14px;line-height:1.8;color:#444}',
      '#' + MODAL_ID + ' button{width:100%;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;background:#1f1f1f;color:#fff;font-family:inherit}',
      '#' + BANNER_ID + '{margin:0 0 12px;padding:12px 14px;border-radius:10px;background:#fdecea;color:#8c1d18;border:1px solid #f5c2bd;font-size:14px;line-height:1.7;direction:rtl;text-align:right}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function showBlocker(limits) {
    if (!document.body) { return; }
    ensureStyles();
    var existing = document.getElementById(MODAL_ID);
    if (existing) { existing.parentNode.removeChild(existing); }
    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', MODAL_ID + '-title');
    var card = document.createElement('div');
    card.className = 'mpl-card';
    var icon = document.createElement('div'); icon.className = 'mpl-icon'; icon.textContent = '!';
    var title = document.createElement('h3'); title.id = MODAL_ID + '-title'; title.textContent = 'عذراً، يمكنك الحصول على قطعة واحدة فقط';
    var text = document.createElement('p'); text.textContent = message(limits);
    var button = document.createElement('button'); button.type = 'button'; button.textContent = 'حسناً';
    function close() { if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); } }
    button.addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) { close(); } });
    card.appendChild(icon); card.appendChild(title); card.appendChild(text); card.appendChild(button);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try { button.focus(); } catch (error) {}
  }

  function updateCartBanner(limits, violating) {
    state.cartViolation = !!violating;
    var submit = document.getElementById && document.getElementById('cart-submit');
    var banner = document.getElementById && document.getElementById(BANNER_ID);
    if (!violating) {
      if (banner && banner.parentNode) { banner.parentNode.removeChild(banner); }
      return;
    }
    if (!submit || !submit.parentNode) { return; }
    ensureStyles();
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.setAttribute('role', 'alert');
      submit.parentNode.insertBefore(banner, submit);
    }
    banner.textContent = message(limits);
  }

  function blockedError() {
    var error = new Error('promo_limit_exceeded');
    error.name = 'PromoLimitExceeded';
    return error;
  }

  // ------------------------------------------------------------------ checks

  /** Resolves true when the action may go ahead. */
  function canAdd(productId, quantity) {
    return loadLimits(false).then(function (limits) {
      if (!isPromo(limits, productId)) { return true; }
      return currentCart().then(function (items) {
        var allowed = limits.used + promoUnits(limits, items) + quantity <= limits.max;
        if (!allowed) { showBlocker(limits); }
        return allowed;
      });
    });
  }

  function canUpdate(itemId, quantity) {
    return loadLimits(false).then(function (limits) {
      if (!limits || !limits.enabled) { return true; }
      return currentCart().then(function (items) {
        var target = null;
        items.forEach(function (item) { if (String(item.id) === String(itemId)) { target = item; } });
        // Some forms post the product id instead of the cart item id.
        if (!target) { items.forEach(function (item) { if (!target && itemProductId(item) === String(itemId)) { target = item; } }); }
        if (!target || !isPromo(limits, itemProductId(target))) { return true; }
        var current = Number(target.quantity) || 0;
        if (quantity <= current) { return true; }
        var allowed = limits.used + promoUnits(limits, items, target.id) + quantity <= limits.max;
        if (!allowed) { showBlocker(limits); }
        return allowed;
      });
    });
  }

  function canCheckout(force) {
    return loadLimits(!!force).then(function (limits) {
      if (!limits || !limits.enabled) { return true; }
      return currentCart().then(function (items) {
        var units = promoUnits(limits, items);
        var allowed = units === 0 || limits.used + units <= limits.max;
        updateCartBanner(limits, !allowed);
        if (!allowed) { showBlocker(limits); }
        return allowed;
      });
    });
  }

  function canQuickOrder(payload) {
    return loadLimits(true).then(function (limits) {
      if (!limits || !limits.enabled) { return true; }
      var ids = (payload && payload.product_ids) || [];
      var units = 0;
      ids.forEach(function (id) { if (isPromo(limits, id)) { units += 1; } });
      var allowed = units === 0 || limits.used + units <= limits.max;
      if (!allowed) { showBlocker(limits); }
      return allowed;
    });
  }

  // ------------------------------------------------------------------ wrapping

  function wrap(target, method, gate) {
    if (!target || typeof target[method] !== 'function' || target[method].__mlehaPromoWrapped) { return; }
    var original = target[method];
    var wrapped = function () {
      var self = this;
      var args = arguments;
      // A wrapped salla.cart.x may delegate to a wrapped salla.api.cart.x; check once.
      if (passthrough[method]) { return original.apply(self, args); }
      return Promise.resolve(gate.apply(self, args)).then(function (allowed) {
        if (allowed === false) {
          if (method === 'submit') {
            try { sdk().cart.event.submitFailed(blockedError()); } catch (error) {}
            return undefined;
          }
          return Promise.reject(blockedError());
        }
        passthrough[method] = true;
        try { return original.apply(self, args); }
        finally { passthrough[method] = false; }
      }, function () {
        return original.apply(self, args);
      });
    };
    wrapped.__mlehaPromoWrapped = true;
    target[method] = wrapped;
  }

  function install() {
    var s = sdk();
    if (!s || !s.api || !s.api.cart) { return false; }
    var targets = [s.api.cart];
    if (s.cart && s.cart !== s.api.cart) { targets.push(s.cart); }
    targets.forEach(function (target) {
      wrap(target, 'addItem', function (arg) {
        var parsed = parsePayload(s.api.cart, arg);
        return canAdd(parsed.id, quantityOf(parsed.payload, 1));
      });
      wrap(target, 'quickAdd', function (id, quantity) {
        return canAdd(id, Number(quantity) > 0 ? Number(quantity) : 1);
      });
      wrap(target, 'updateItem', function (arg) {
        var parsed = parsePayload(s.api.cart, arg);
        return canUpdate(parsed.id, quantityOf(parsed.payload, 0));
      });
      wrap(target, 'submit', function () { return canCheckout(true); });
      wrap(target, 'createQuickOrder', function (payload) { return canQuickOrder(payload); });
    });

    // Keep the cart page banner in sync with whatever changed the cart.
    try {
      if (s.cart && s.cart.event && typeof s.cart.event.onUpdated === 'function') {
        s.cart.event.onUpdated(function () { if (isCartPage()) { canCheckoutSilently(); } });
      }
      if (s.event && typeof s.event.on === 'function') {
        ['auth::verified', 'auth::logged.in', 'auth::logged.out'].forEach(function (name) {
          s.event.on(name, function () { state.data = null; writeStorage(null); });
        });
      }
    } catch (error) { debug('event hookup failed', error); }

    if (isCartPage()) { canCheckoutSilently(); }
    debug('installed');
    return true;
  }

  function isCartPage() {
    try {
      var s = sdk();
      var slug = s && s.config && typeof s.config.get === 'function' ? String(s.config.get('page.slug') || '') : '';
      if (slug === 'cart') { return true; }
    } catch (error) {}
    return !!(document.getElementById && document.getElementById('cart-submit'));
  }

  /** Banner only — no modal — for passive cart page refreshes. */
  function canCheckoutSilently() {
    loadLimits(false).then(function (limits) {
      if (!limits || !limits.enabled) { return; }
      return currentCart().then(function (items) {
        var units = promoUnits(limits, items);
        updateCartBanner(limits, units > 0 && limits.used + units > limits.max);
      });
    });
  }

  // Block the theme's checkout button before it switches into its loading state.
  if (document.addEventListener) {
    document.addEventListener('click', function (event) {
      if (!state.cartViolation) { return; }
      var target = event.target;
      var button = target && target.closest ? target.closest('#cart-submit') : null;
      if (!button) { return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      showBlocker(state.data);
    }, true);
  }

  window.__mlehaPromoLimitTest = {
    install: install,
    state: state,
    promoUnits: promoUnits,
    hydrate: hydrate,
    canAdd: canAdd,
    canUpdate: canUpdate,
    canCheckout: canCheckout
  };

  var attempts = 0;
  function boot() {
    if (install()) { return; }
    attempts += 1;
    if (attempts < 40) { setTimeout(boot, Math.min(1000, 100 + attempts * 50)); }
  }
  var s0 = sdk();
  if (s0 && typeof s0.onReady === 'function') {
    try { s0.onReady(boot); } catch (error) { boot(); }
  } else {
    boot();
  }
})();
`;
