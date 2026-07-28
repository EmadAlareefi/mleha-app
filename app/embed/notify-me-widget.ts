/**
 * Source of the "أبلغني عند التوفر" widget injected into mleha.com single-product
 * pages. Served verbatim by app/embed/notify-me.js/route.ts.
 *
 * Kept here as a template string (rather than inside the route file) so it stays
 * reviewable in one place. It runs inside the Salla storefront, so it must be
 * dependency-free, tolerant of theme differences, and must never throw in a way
 * that breaks the surrounding page.
 */

export const NOTIFY_ME_WIDGET_SOURCE = String.raw`
(function () {
  'use strict';

  if (window.__mlehaNotifyMe) { return; }
  window.__mlehaNotifyMe = true;

  var script = document.currentScript ||
    document.querySelector('script[src*="notify-me.js"]');
  var API_BASE = (script && script.getAttribute('data-api')) || '';
  var ENDPOINT = API_BASE.replace(/\/+$/, '') + '/api/public/availability-requests';
  var DEBUG = !!(script && script.getAttribute('data-debug'));

  function debug() {
    if (!DEBUG) { return; }
    try { console.log.apply(console, ['[mleha-notify]'].concat([].slice.call(arguments))); }
    catch (e) { /* console may be unavailable */ }
  }

  var TEXT = {
    button: 'أبلغني عند التوفر',
    sending: 'جاري الإرسال…',
    success: 'تم تسجيل طلبك، سنبلغك فور توفر المنتج.',
    duplicate: 'أنت مسجّل بالفعل، سنبلغك فور توفر المنتج.',
    error: 'تعذر تسجيل طلبك، يرجى المحاولة لاحقاً.',
    rateLimited: 'تم استقبال عدة طلبات، يرجى المحاولة بعد قليل.',
    phoneLabel: 'رقم الجوال',
    phonePlaceholder: '05XXXXXXXX',
    nameLabel: 'الاسم (اختياري)',
    namePlaceholder: 'اسمك',
    submit: 'سجّلني',
    invalidPhone: 'يرجى إدخال رقم جوال صحيح.',
    consent: 'سنستخدم رقمك لإبلاغك عند توفر هذا المنتج فقط.',
    loggedInAs: 'سنرسل الإشعار على'
  };

  /* ---------- styles ---------- */

  var CSS = [
    '.mleha-nm{--nm-rose:#9d3d38;--nm-rose-deep:#7d2f2b;--nm-soft:#f3e3e1;',
    '--nm-ink:#2a2422;--nm-muted:#897e7a;--nm-line:#ece4e2;--nm-ok:#2f7d5b;',
    '--nm-ok-soft:#e6f2ec;--nm-err:#b3261e;--nm-err-soft:#fbeae9;',
    'direction:rtl;text-align:right;margin:12px 0;font-family:inherit;line-height:1.7;}',
    '.mleha-nm *{box-sizing:border-box;}',
    '.mleha-nm__btn{display:flex;align-items:center;justify-content:center;gap:8px;',
    'width:100%;padding:13px 18px;border:0;border-radius:12px;cursor:pointer;',
    'background:linear-gradient(160deg,var(--nm-rose),var(--nm-rose-deep));color:#fff;',
    'font-size:15px;font-weight:600;font-family:inherit;transition:opacity .2s,transform .2s;}',
    '.mleha-nm__btn:hover{opacity:.92;transform:translateY(-1px);}',
    '.mleha-nm__btn:disabled{opacity:.6;cursor:default;transform:none;}',
    '.mleha-nm__bell{width:17px;height:17px;flex:0 0 auto;}',
    '.mleha-nm__panel{margin-top:10px;padding:14px;border:1px solid var(--nm-line);',
    'border-radius:12px;background:#fdf9f8;}',
    '.mleha-nm__row{margin-bottom:10px;}',
    '.mleha-nm__label{display:block;margin-bottom:5px;font-size:13px;color:var(--nm-ink);font-weight:500;}',
    '.mleha-nm__input{width:100%;padding:11px 12px;border:1px solid var(--nm-line);',
    'border-radius:10px;font-size:15px;font-family:inherit;background:#fff;color:var(--nm-ink);',
    'direction:ltr;text-align:right;}',
    '.mleha-nm__input:focus{outline:2px solid var(--nm-soft);outline-offset:1px;border-color:var(--nm-rose);}',
    '.mleha-nm__input--name{direction:rtl;}',
    '.mleha-nm__hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}',
    '.mleha-nm__note{font-size:12px;color:var(--nm-muted);margin-top:8px;}',
    '.mleha-nm__msg{margin-top:10px;padding:11px 13px;border-radius:10px;font-size:14px;}',
    '.mleha-nm__msg--ok{background:var(--nm-ok-soft);color:var(--nm-ok);}',
    '.mleha-nm__msg--err{background:var(--nm-err-soft);color:var(--nm-err);}',
    '.mleha-nm__who{font-size:13px;color:var(--nm-muted);margin-top:8px;}',
    '.mleha-nm__who b{color:var(--nm-ink);font-weight:600;direction:ltr;display:inline-block;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById('mleha-nm-styles')) { return; }
    var style = document.createElement('style');
    style.id = 'mleha-nm-styles';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- salla helpers ---------- */

  function sallaConfig(path) {
    try {
      if (window.salla && window.salla.config && typeof window.salla.config.get === 'function') {
        return window.salla.config.get(path);
      }
    } catch (e) { /* theme may not expose config */ }
    return undefined;
  }

  function sallaStorage(key) {
    try {
      if (window.salla && window.salla.storage && typeof window.salla.storage.get === 'function') {
        return window.salla.storage.get(key);
      }
    } catch (e) { /* storage is optional */ }
    return undefined;
  }

  // The logged-in customer, as reported by the storefront. Treated as a
  // convenience prefill only — the server never trusts it as proof of identity.
  function getCustomer() {
    var user = sallaConfig('user') || sallaStorage('user') || window.salla_user;
    if (!user || typeof user !== 'object') { return null; }
    var phone = user.mobile || user.phone || user.mobile_number || '';
    if (user.mobile_code && phone && String(phone).indexOf('+') !== 0 &&
        String(phone).indexOf(String(user.mobile_code)) !== 0) {
      phone = String(user.mobile_code) + String(phone);
    }
    if (!user.id && !phone) { return null; }
    return {
      id: user.id ? String(user.id) : '',
      firstName: user.first_name || user.firstName || (user.name ? String(user.name).split(' ')[0] : ''),
      lastName: user.last_name || user.lastName || '',
      email: user.email || '',
      phone: phone ? String(phone) : ''
    };
  }

  /* ---------- product detection ---------- */

  function productIdFromUrl() {
    var match = window.location.pathname.match(/\/p(\d{3,})(?:\/|$)/);
    return match ? match[1] : '';
  }

  function isSingleProductPage() {
    var slug = sallaConfig('page.slug') || sallaConfig('page.type');
    if (slug === 'single-product' || slug === 'product') { return true; }
    if (document.querySelector('salla-add-product-button')) { return true; }
    if (document.querySelector('[data-product-id]')) { return true; }
    return !!productIdFromUrl();
  }

  function metaContent(name) {
    var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? el.getAttribute('content') || '' : '';
  }

  function getProduct() {
    var el = document.querySelector('[data-product-id]');
    var id = (el && el.getAttribute('data-product-id')) ||
      sallaConfig('page.id') ||
      productIdFromUrl();
    if (!id) { return null; }

    var name = (el && el.getAttribute('data-product-name')) ||
      metaContent('og:title') ||
      (document.querySelector('h1') || {}).textContent ||
      document.title;

    return {
      id: String(id),
      name: String(name || '').trim().slice(0, 250),
      sku: (el && el.getAttribute('data-product-sku')) || '',
      image: metaContent('og:image') || ''
    };
  }

  /* ---------- availability detection ---------- */

  var SOLD_OUT_SELECTORS = [
    '.s-product-card-out-of-stock',
    '.product-out-of-stock',
    '.out-of-stock',
    '[data-out-of-stock="true"]'
  ];

  var SOLD_OUT_WORDS = ['نفذت الكمية', 'غير متوفر', 'نفدت الكمية', 'out of stock', 'sold out'];

  function textLooksSoldOut(text) {
    if (!text) { return false; }
    var lowered = String(text).toLowerCase();
    for (var i = 0; i < SOLD_OUT_WORDS.length; i++) {
      if (lowered.indexOf(SOLD_OUT_WORDS[i].toLowerCase()) !== -1) { return true; }
    }
    return false;
  }

  function addToCartButton() {
    return document.querySelector('salla-add-product-button') ||
      document.querySelector('[data-add-to-cart]') ||
      document.querySelector('button.add-to-cart') ||
      document.querySelector('form.product-form button[type="submit"]');
  }

  // Themes disagree on how they express "sold out", so check several signals and
  // treat any one of them as decisive.
  function isSoldOut() {
    for (var i = 0; i < SOLD_OUT_SELECTORS.length; i++) {
      if (document.querySelector(SOLD_OUT_SELECTORS[i])) { return true; }
    }

    var btn = addToCartButton();
    if (btn) {
      if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') { return true; }
      if (textLooksSoldOut(btn.textContent)) { return true; }
    }

    var quantity = sallaConfig('page.product.quantity');
    if (typeof quantity === 'number' && quantity <= 0) { return true; }

    var status = sallaConfig('page.product.status');
    if (status === 'out' || status === 'out_of_stock' || status === 'sold') { return true; }

    return false;
  }

  // Themes commonly render an option as "مقاس M — نفذت الكمية". The stock note is
  // presentation, not part of the size, and it would otherwise be stored as the
  // requested size and read back to the customer in the WhatsApp message.
  function cleanVariantLabel(raw) {
    var label = String(raw || '').replace(/\s+/g, ' ').trim();
    var parts = label.split(/\s*[—–|(]\s*/);
    if (parts.length > 1) {
      var head = parts[0].trim();
      var tail = parts.slice(1).join(' ');
      if (head && textLooksSoldOut(tail)) { label = head; }
    }
    return label.replace(/[\s\-–—|(),]+$/, '').trim();
  }

  function getSelectedVariant() {
    var input = document.querySelector('input[name="option_id"]:checked') ||
      document.querySelector('select[name="option_id"]') ||
      document.querySelector('[data-variant-id]');
    if (!input) { return { id: '', name: '', size: '' }; }

    // For a <select> the useful metadata hangs off the chosen <option>, not the
    // select itself, so look there before falling back to the control.
    var source = input;
    if (input.tagName === 'SELECT' && input.selectedIndex >= 0) {
      source = input.options[input.selectedIndex] || input;
    }

    var id = source.getAttribute('data-variant-id') ||
      input.getAttribute('data-variant-id') ||
      source.value || input.value || '';

    var label = source.getAttribute('data-variant-name') ||
      input.getAttribute('data-variant-name') ||
      input.getAttribute('aria-label') || '';

    if (!label && source !== input) { label = source.textContent || ''; }
    if (!label && input.tagName !== 'SELECT') { label = input.value || ''; }

    var cleaned = cleanVariantLabel(label);
    return { id: id ? String(id) : '', name: cleaned, size: cleaned };
  }

  /* ---------- rendering ---------- */

  var container = null;
  var state = { busy: false, done: false };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text != null) { node.textContent = text; }
    return node;
  }

  function showMessage(kind, text) {
    if (!container) { return; }
    var existing = container.querySelector('.mleha-nm__msg');
    if (existing) { existing.parentNode.removeChild(existing); }
    var msg = el('div', 'mleha-nm__msg mleha-nm__msg--' + kind, text);
    container.appendChild(msg);
  }

  function bellIcon() {
    var span = el('span', 'mleha-nm__bell');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">' +
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    return span;
  }

  function submit(payload, onDone) {
    fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    }).then(function (result) {
      if (result.ok && result.data && result.data.success) {
        state.done = true;
        showMessage('ok', result.data.duplicate ? TEXT.duplicate : TEXT.success);
      } else if (result.status === 429) {
        showMessage('err', TEXT.rateLimited);
      } else {
        showMessage('err', (result.data && result.data.error) || TEXT.error);
      }
      onDone(state.done);
    }).catch(function (error) {
      debug('submit failed', error);
      showMessage('err', TEXT.error);
      onDone(false);
    });
  }

  function basePayload(product) {
    var variant = getSelectedVariant();
    return {
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      productImageUrl: product.image,
      variationId: variant.id,
      variationName: variant.name,
      requestedSize: variant.size,
      pageUrl: window.location.href.slice(0, 500),
      locale: document.documentElement.lang || 'ar'
    };
  }

  function renderLoggedIn(product, customer) {
    var button = el('button', 'mleha-nm__btn');
    button.type = 'button';
    button.appendChild(bellIcon());
    button.appendChild(el('span', null, TEXT.button));

    button.addEventListener('click', function () {
      if (state.busy || state.done) { return; }
      state.busy = true;
      button.disabled = true;
      button.lastChild.textContent = TEXT.sending;

      var payload = basePayload(product);
      payload.customerPhone = customer.phone;
      payload.customerFirstName = customer.firstName;
      payload.customerLastName = customer.lastName;
      payload.customerEmail = customer.email;
      payload.customerId = customer.id;
      payload.company = '';

      submit(payload, function (done) {
        state.busy = false;
        if (done) {
          button.parentNode.removeChild(button);
          var who = container.querySelector('.mleha-nm__who');
          if (who) { who.parentNode.removeChild(who); }
        } else {
          button.disabled = false;
          button.lastChild.textContent = TEXT.button;
        }
      });
    });

    container.appendChild(button);

    if (customer.phone) {
      var who = el('div', 'mleha-nm__who');
      who.appendChild(document.createTextNode(TEXT.loggedInAs + ' '));
      who.appendChild(el('b', null, customer.phone));
      container.appendChild(who);
    }
  }

  function renderGuestForm(product) {
    var trigger = el('button', 'mleha-nm__btn');
    trigger.type = 'button';
    trigger.appendChild(bellIcon());
    trigger.appendChild(el('span', null, TEXT.button));

    var panel = el('form', 'mleha-nm__panel');
    panel.style.display = 'none';

    var phoneRow = el('div', 'mleha-nm__row');
    var phoneLabel = el('label', 'mleha-nm__label', TEXT.phoneLabel);
    var phoneInput = el('input', 'mleha-nm__input');
    phoneInput.type = 'tel';
    phoneInput.name = 'phone';
    phoneInput.placeholder = TEXT.phonePlaceholder;
    phoneInput.autocomplete = 'tel';
    phoneLabel.setAttribute('for', 'mleha-nm-phone');
    phoneInput.id = 'mleha-nm-phone';
    phoneRow.appendChild(phoneLabel);
    phoneRow.appendChild(phoneInput);

    var nameRow = el('div', 'mleha-nm__row');
    var nameLabel = el('label', 'mleha-nm__label', TEXT.nameLabel);
    var nameInput = el('input', 'mleha-nm__input mleha-nm__input--name');
    nameInput.type = 'text';
    nameInput.name = 'customer-name';
    nameInput.placeholder = TEXT.namePlaceholder;
    nameLabel.setAttribute('for', 'mleha-nm-name');
    nameInput.id = 'mleha-nm-name';
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);

    // Honeypot: hidden from people, irresistible to naive bots.
    var honeypot = el('input', 'mleha-nm__hp');
    honeypot.type = 'text';
    honeypot.name = 'company';
    honeypot.tabIndex = -1;
    honeypot.setAttribute('autocomplete', 'off');
    honeypot.setAttribute('aria-hidden', 'true');

    var submitBtn = el('button', 'mleha-nm__btn');
    submitBtn.type = 'submit';
    submitBtn.appendChild(el('span', null, TEXT.submit));

    panel.appendChild(phoneRow);
    panel.appendChild(nameRow);
    panel.appendChild(honeypot);
    panel.appendChild(submitBtn);
    panel.appendChild(el('div', 'mleha-nm__note', TEXT.consent));

    trigger.addEventListener('click', function () {
      panel.style.display = '';
      trigger.style.display = 'none';
      phoneInput.focus();
    });

    panel.addEventListener('submit', function (event) {
      event.preventDefault();
      if (state.busy || state.done) { return; }

      var phone = phoneInput.value.replace(/[^\d+]/g, '');
      if (phone.replace(/\D/g, '').length < 9) {
        showMessage('err', TEXT.invalidPhone);
        return;
      }

      state.busy = true;
      submitBtn.disabled = true;
      submitBtn.firstChild.textContent = TEXT.sending;

      var payload = basePayload(product);
      payload.customerPhone = phone;
      payload.customerFirstName = nameInput.value.trim();
      payload.company = honeypot.value;

      submit(payload, function (done) {
        state.busy = false;
        if (done) {
          panel.parentNode.removeChild(panel);
        } else {
          submitBtn.disabled = false;
          submitBtn.firstChild.textContent = TEXT.submit;
        }
      });
    });

    container.appendChild(trigger);
    container.appendChild(panel);
  }

  function mountPoint() {
    var btn = addToCartButton();
    if (btn && btn.parentNode) { return btn.parentNode; }
    return document.querySelector('.product-form') ||
      document.querySelector('main') ||
      document.body;
  }

  function teardown() {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    state = { busy: false, done: false };
  }

  function render() {
    var product = getProduct();
    if (!product) { debug('no product on page'); return; }

    if (!isSoldOut()) {
      // Switching back to an in-stock variant should take the widget away again.
      if (container && !state.done) { teardown(); }
      return;
    }

    if (container) { return; }

    injectStyles();
    container = el('div', 'mleha-nm');
    container.setAttribute('dir', 'rtl');

    var customer = getCustomer();
    if (customer && customer.phone) {
      renderLoggedIn(product, customer);
    } else {
      renderGuestForm(product);
    }

    mountPoint().appendChild(container);
    debug('widget mounted', product, customer ? 'logged-in' : 'guest');
  }

  /* ---------- lifecycle ---------- */

  var scheduled = null;
  function schedule() {
    if (scheduled) { clearTimeout(scheduled); }
    scheduled = setTimeout(function () {
      scheduled = null;
      try { render(); } catch (error) { debug('render failed', error); }
    }, 120);
  }

  function start() {
    if (!isSingleProductPage()) { debug('not a product page'); return; }

    schedule();

    // Variant switching swaps stock state without a page load, so re-evaluate on
    // Salla's own events and on DOM changes around the add-to-cart area.
    var events = [
      'product::variant.changed',
      'variant::changed',
      'product::quantity.changed',
      'salla::product.updated'
    ];
    try {
      if (window.salla && window.salla.event && typeof window.salla.event.on === 'function') {
        events.forEach(function (name) { window.salla.event.on(name, schedule); });
      }
    } catch (e) { debug('event binding failed', e); }

    try {
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'class'] });
    } catch (e) { debug('observer failed', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;
