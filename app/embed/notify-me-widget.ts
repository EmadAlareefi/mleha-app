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
    loggedInAs: 'سنرسل الإشعار عبر واتساب على الرقم',
    registeredTitle: 'أنت مسجّل بالفعل لهذا المقاس',
    registeredProductTitle: 'أنت مسجّل بالفعل لهذا المنتج',
    registeredBody: 'سنبلغك عبر واتساب فور توفره.'
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
    '.mleha-nm__who,.mleha-nm__registered{display:flex;align-items:center;gap:11px;',
    'margin-top:10px;padding:12px 14px;border:1px solid var(--nm-line);border-radius:12px;',
    'background:linear-gradient(135deg,#fdf9f8,#f8eeec);box-shadow:0 4px 14px rgba(125,47,43,.06);}',
    '.mleha-nm__who-icon,.mleha-nm__registered-icon{display:flex;align-items:center;',
    'justify-content:center;width:38px;height:38px;flex:0 0 38px;border-radius:11px;',
    'background:var(--nm-rose);color:#fff;}',
    '.mleha-nm__who-copy,.mleha-nm__registered-copy{min-width:0;display:flex;',
    'flex-direction:column;gap:1px;}',
    '.mleha-nm__who-title{font-size:12px;line-height:1.5;color:var(--nm-muted);}',
    '.mleha-nm__who-phone{font-size:15px;line-height:1.45;color:var(--nm-ink);',
    'font-weight:700;direction:ltr;text-align:right;display:inline-block;}',
    '.mleha-nm__registered{border-color:#d9e9df;background:linear-gradient(135deg,#f8fcfa,#edf7f1);}',
    '.mleha-nm__registered-icon{background:var(--nm-ok);}',
    '.mleha-nm__registered-title{font-size:14px;line-height:1.55;color:var(--nm-ink);font-weight:700;}',
    '.mleha-nm__registered-size{display:inline-flex;margin-inline-start:5px;padding:1px 8px;',
    'border-radius:999px;background:#fff;color:var(--nm-ok);border:1px solid #cfe3d7;',
    'font-size:12px;font-weight:700;direction:ltr;}',
    '.mleha-nm__registered-body{font-size:12px;line-height:1.55;color:var(--nm-muted);}',
    /* Selia applies its disabled opacity to both the label and its inner div.
       Keep the stock-out marker for detection, but make every size consistent. */
    '.s-product-options-option-stock-out,',
    '.s-product-options-option-stock-out .s-product-options-disabled{opacity:1!important;}',
    '.s-product-options-option-stock-out .s-product-options-grid-mode-span{cursor:pointer!important;}'
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
    if (slug === 'single-product' || slug === 'product' || slug === 'product.single') {
      return true;
    }
    if (document.querySelector('#product-form')) { return true; }
    if (document.querySelector('salla-product-options[product-id]')) { return true; }
    return !!productIdFromUrl();
  }

  function metaContent(name) {
    var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? el.getAttribute('content') || '' : '';
  }

  function getProduct() {
    var form = document.querySelector('#product-form') ||
      document.querySelector('form.product-form');
    var el = form && form.querySelector('[data-product-id]');
    var hiddenId = form && form.querySelector('input[name="id"]');
    var productOptions = document.querySelector(
      '#product-form salla-product-options[product-id],salla-product-options[product-id]'
    );
    var id = sallaConfig('page.id') ||
      (hiddenId && hiddenId.value) ||
      (productOptions && productOptions.getAttribute('product-id')) ||
      (el && el.getAttribute('data-product-id')) ||
      productIdFromUrl();
    if (!id) { return null; }

    var name = (el && el.getAttribute('data-product-name')) ||
      metaContent('og:title') ||
      (document.querySelector('h1') || {}).textContent ||
      document.title;

    return {
      id: String(id),
      name: String(name || '').trim().slice(0, 250),
      sku: (el && el.getAttribute('data-product-sku')) ||
        String((document.querySelector('.product-sku') || {}).textContent || '').trim(),
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
    // Scope the first lookup to the main product form. Product recommendation
    // cards further down the page also contain add-product buttons.
    return document.querySelector('#product-form salla-add-product-button') ||
      document.querySelector('.product-form salla-add-product-button') ||
      document.querySelector('salla-add-product-button') ||
      document.querySelector('[data-add-to-cart]') ||
      document.querySelector('button.add-to-cart') ||
      document.querySelector('form.product-form button[type="submit"]');
  }

  // Themes disagree on how they express "sold out", so check several signals and
  // treat any one of them as decisive.
  function isSoldOut() {
    // An unavailable Selia option selected specifically for notification is the
    // strongest signal. The product itself can still be in stock in another size.
    if (document.querySelector(
      '.s-product-options-option-stock-out input[type="radio"]:checked,' +
      '.s-product-options-option-stock-out input[type="checkbox"]:checked'
    )) { return true; }

    var productRoot = document.querySelector('#product-form') ||
      document.querySelector('form.product-form') ||
      document;
    for (var i = 0; i < SOLD_OUT_SELECTORS.length; i++) {
      if (productRoot.querySelector(SOLD_OUT_SELECTORS[i])) { return true; }
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

    // Cut at the stock phrase instead of relying on one separator. The live
    // Selia theme currently uses an ASCII hyphen ("M - نفدت الكمية"), while
    // other themes use an en/em dash, a pipe, or parentheses.
    var lowered = label.toLowerCase();
    var soldOutAt = -1;
    for (var i = 0; i < SOLD_OUT_WORDS.length; i++) {
      var wordAt = lowered.indexOf(SOLD_OUT_WORDS[i].toLowerCase());
      if (wordAt !== -1 && (soldOutAt === -1 || wordAt < soldOutAt)) {
        soldOutAt = wordAt;
      }
    }

    if (soldOutAt !== -1) { label = label.slice(0, soldOutAt); }
    return label.replace(/[\s\-–—|(),]+$/, '').trim();
  }

  var selectedSoldOutOption = null;
  var REGISTRATION_STORAGE_PREFIX = 'mleha-notify-registration:v1:';

  function registrationStorageKey(productId, variationId) {
    return REGISTRATION_STORAGE_PREFIX + String(productId) + ':' +
      String(variationId || 'product');
  }

  function readRegistration(productId, variationId) {
    try {
      var raw = window.localStorage &&
        window.localStorage.getItem(registrationStorageKey(productId, variationId));
      if (!raw) { return null; }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      debug('could not read notify registration', error);
      return null;
    }
  }

  function rememberRegistration(payload) {
    try {
      if (!window.localStorage) { return; }
      window.localStorage.setItem(
        registrationStorageKey(payload.productId, payload.variationId),
        JSON.stringify({
          productId: String(payload.productId || ''),
          variationId: String(payload.variationId || ''),
          variationName: String(payload.variationName || payload.requestedSize || ''),
          registeredAt: Date.now()
        })
      );
    } catch (error) {
      // Private browsing and strict storage policies can reject localStorage.
      // Registration still succeeded on the server, so never surface this as an
      // error to the customer.
      debug('could not remember notify registration', error);
    }
  }

  function isRegistered(productId, variationId) {
    return !!readRegistration(productId, variationId);
  }

  function selectedOptionMatches(input) {
    if (!selectedSoldOutOption || !input) { return false; }
    return String(input.name || '') === selectedSoldOutOption.name &&
      String(input.value || '') === selectedSoldOutOption.value;
  }

  // Keep unavailable choices visually consistent with available choices and
  // remove the stock suffix from what the customer sees. Selia disables these
  // radios, so make them selectable for this widget while retaining the stock-out
  // class that prevents us from ever treating the choice as purchasable.
  function normalizeSoldOutOptions() {
    var options = document.querySelectorAll('.s-product-options-option-stock-out');
    for (var i = 0; i < options.length; i++) {
      var input = options[i].querySelector('input[type="radio"],input[type="checkbox"]');
      var visibleLabel = options[i].querySelector('.s-product-options-grid-mode-span');
      if (!visibleLabel) { continue; }

      options[i].classList.remove('s-product-options-disabled');
      visibleLabel.classList.remove('s-product-options-disabled');
      if (input) {
        input.disabled = false;
        input.removeAttribute('disabled');
        if (selectedOptionMatches(input)) { input.checked = true; }
      }

      var current = String(visibleLabel.textContent || '').replace(/\s+/g, ' ').trim();
      var cleaned = cleanVariantLabel(current);
      if (cleaned && cleaned !== current) { visibleLabel.textContent = cleaned; }
    }
  }

  function handleOptionClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') { return; }

    var label = target.closest('.s-product-options-grid-mode label');
    if (!label) { return; }

    if (!label.classList.contains('s-product-options-option-stock-out')) {
      selectedSoldOutOption = null;
      schedule();
      return;
    }

    var input = label.querySelector('input[type="radio"],input[type="checkbox"]');
    if (!input) { return; }

    selectedSoldOutOption = {
      name: String(input.name || ''),
      value: String(input.value || '')
    };

    // Checking a radio programmatically also clears another choice in its group.
    // Re-apply once after Selia's own click handler has finished in case it
    // redraws the options from its stock data.
    input.checked = true;
    setTimeout(function () {
      normalizeSoldOutOptions();
      schedule();
    }, 0);
  }

  function preventSoldOutCartSubmission(event) {
    if (!document.querySelector(
      '.s-product-options-option-stock-out input[type="radio"]:checked,' +
      '.s-product-options-option-stock-out input[type="checkbox"]:checked'
    )) { return; }

    // The unavailable input is enabled only so it can identify the requested
    // size. It must never be allowed through Salla's add-to-cart submission.
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    schedule();
  }

  function parseSallaProductOptions() {
    var component = document.querySelector('#product-form salla-product-options') ||
      document.querySelector('salla-product-options');
    if (!component) { return { component: null, options: [] }; }

    try {
      var parsed = JSON.parse(component.getAttribute('options') || '[]');
      return { component: component, options: Array.isArray(parsed) ? parsed : [] };
    } catch (error) {
      debug('could not parse Salla product options', error);
      return { component: component, options: [] };
    }
  }

  function findOptionDetail(options, value) {
    for (var i = 0; i < options.length; i++) {
      var details = Array.isArray(options[i].details) ? options[i].details : [];
      for (var j = 0; j < details.length; j++) {
        if (String(details[j].id) === String(value)) { return details[j]; }
      }
    }
    return null;
  }

  // Selia's input value is an option-value id (for example, the id for "M").
  // The stock watcher needs the actual SKU/variation id. Each selected option
  // exposes compatible variation ids through details[].skus_availability; the
  // intersection is the exact variation represented by the selected combination.
  function resolveSallaVariationId(input, onlyInput) {
    var parsed = parseSallaProductOptions();
    if (!parsed.component || parsed.options.length === 0) { return ''; }

    var selected = onlyInput && input ? [input] : parsed.component.querySelectorAll(
      'input[type="radio"]:checked,input[type="checkbox"]:checked,select option:checked'
    );
    if (selected.length === 0 && input) { selected = [input]; }

    var candidates = null;
    for (var i = 0; i < selected.length; i++) {
      var detail = findOptionDetail(parsed.options, selected[i].value);
      if (!detail || !detail.skus_availability) { continue; }

      var ids = Object.keys(detail.skus_availability);
      if (candidates === null) {
        candidates = ids;
      } else {
        candidates = candidates.filter(function (id) { return ids.indexOf(id) !== -1; });
      }
    }

    return candidates && candidates.length === 1 ? String(candidates[0]) : '';
  }

  function restoreRegisteredSoldOutOption(product) {
    if (selectedSoldOutOption) { return; }

    var options = document.querySelectorAll('.s-product-options-option-stock-out');
    var best = null;
    for (var i = 0; i < options.length; i++) {
      var input = options[i].querySelector('input[type="radio"],input[type="checkbox"]');
      if (!input) { continue; }

      var variationId = resolveSallaVariationId(input, true);
      if (!variationId) { continue; }

      var registration = readRegistration(product.id, variationId);
      if (!registration) { continue; }

      var registeredAt = Number(registration.registeredAt) || 0;
      if (!best || registeredAt > best.registeredAt) {
        best = { input: input, registeredAt: registeredAt };
      }
    }

    if (!best) { return; }
    selectedSoldOutOption = {
      name: String(best.input.name || ''),
      value: String(best.input.value || '')
    };
    best.input.checked = true;
  }

  function getSelectedVariant() {
    var input = document.querySelector('input[name="option_id"]:checked') ||
      document.querySelector('select[name="option_id"]') ||
      document.querySelector(
        '#product-form salla-product-options input[type="radio"]:checked,' +
        '#product-form salla-product-options input[type="checkbox"]:checked'
      ) ||
      document.querySelector('[data-variant-id]');
    if (!input) { return { id: '', name: '', size: '' }; }

    // For a <select> the useful metadata hangs off the chosen <option>, not the
    // select itself, so look there before falling back to the control.
    var source = input;
    if (input.tagName === 'SELECT' && input.selectedIndex >= 0) {
      source = input.options[input.selectedIndex] || input;
    }

    var resolvedSallaId = resolveSallaVariationId(input);
    var id = source.getAttribute('data-variant-id') ||
      input.getAttribute('data-variant-id') ||
      resolvedSallaId ||
      source.value || input.value || '';

    var label = source.getAttribute('data-variant-name') ||
      input.getAttribute('data-variant-name') ||
      input.getAttribute('aria-label') || '';

    if (!label && input.tagName !== 'SELECT' && typeof input.closest === 'function') {
      var optionLabel = input.closest('label');
      var visibleLabel = optionLabel &&
        optionLabel.querySelector('.s-product-options-grid-mode-span');
      if (visibleLabel) { label = visibleLabel.textContent || ''; }
    }
    if (!label && source !== input) { label = source.textContent || ''; }
    if (!label && input.tagName !== 'SELECT') { label = input.value || ''; }

    var cleaned = cleanVariantLabel(label);
    return { id: id ? String(id) : '', name: cleaned, size: cleaned };
  }

  /* ---------- rendering ---------- */

  var container = null;
  var state = { busy: false, done: false };
  var hiddenCartButton = null;
  var hiddenCartButtonDisplay = '';
  var renderedSelectionKey = '';

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

  function cardIcon(className, kind) {
    var span = el('span', className);
    if (kind === 'check') {
      span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">' +
        '<path d="M20 6 9 17l-5-5"/></svg>';
    } else {
      span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">' +
        '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.3 9.3 0 0 1-4-.9L3 21l1.8-4.8A8.5 8.5 0 1 1 21 11.5Z"/>' +
        '<path d="M8.7 8.2c.3 3 2.1 4.8 5.1 5.1"/></svg>';
    }
    return span;
  }

  function renderRegistered(variant) {
    var card = el('div', 'mleha-nm__registered');
    card.setAttribute('role', 'status');
    card.appendChild(cardIcon('mleha-nm__registered-icon', 'check'));

    var copy = el('div', 'mleha-nm__registered-copy');
    var title = el(
      'div',
      'mleha-nm__registered-title',
      variant.id ? TEXT.registeredTitle : TEXT.registeredProductTitle
    );
    if (variant.name) {
      title.appendChild(el('span', 'mleha-nm__registered-size', variant.name));
    }
    copy.appendChild(title);
    copy.appendChild(el('div', 'mleha-nm__registered-body', TEXT.registeredBody));
    card.appendChild(copy);
    container.appendChild(card);
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
        rememberRegistration(payload);
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
      who.appendChild(cardIcon('mleha-nm__who-icon', 'whatsapp'));
      var copy = el('div', 'mleha-nm__who-copy');
      copy.appendChild(el('span', 'mleha-nm__who-title', TEXT.loggedInAs));
      copy.appendChild(el('b', 'mleha-nm__who-phone', customer.phone));
      who.appendChild(copy);
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
    if (hiddenCartButton) {
      hiddenCartButton.style.display = hiddenCartButtonDisplay;
    }
    hiddenCartButton = null;
    hiddenCartButtonDisplay = '';
    renderedSelectionKey = '';
    container = null;
    state = { busy: false, done: false };
  }

  function hideCartButton() {
    var btn = addToCartButton();
    if (!btn || btn === hiddenCartButton) { return; }
    hiddenCartButton = btn;
    hiddenCartButtonDisplay = btn.style.display || '';
    btn.style.display = 'none';
  }

  function render() {
    var product = getProduct();
    if (!product) { debug('no product on page'); return; }

    injectStyles();
    normalizeSoldOutOptions();
    restoreRegisteredSoldOutOption(product);
    normalizeSoldOutOptions();

    var variant = getSelectedVariant();
    var selectionKey = product.id + ':' + String(variant.id || 'product');
    if (container && renderedSelectionKey !== selectionKey) {
      teardown();
    }

    if (!isSoldOut()) {
      // Switching back to an in-stock variant should take the widget away again.
      if (container) { teardown(); }
      return;
    }

    if (container) {
      hideCartButton();
      return;
    }

    container = el('div', 'mleha-nm');
    container.setAttribute('dir', 'rtl');
    renderedSelectionKey = selectionKey;

    if (isRegistered(product.id, variant.id)) {
      renderRegistered(variant);
    } else {
      var customer = getCustomer();
      if (customer && customer.phone) {
        renderLoggedIn(product, customer);
      } else {
        renderGuestForm(product);
      }
    }

    mountPoint().appendChild(container);
    hideCartButton();
    debug('widget mounted', product, isRegistered(product.id, variant.id) ? 'registered' : 'new');
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

    document.addEventListener('click', handleOptionClick, true);
    var productForm = document.querySelector('#product-form') ||
      document.querySelector('form.product-form');
    if (productForm) {
      productForm.addEventListener('submit', preventSoldOutCartSubmission, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;
