/** Tiny global loader; the full runtime is requested only on Salla product pages. */
export const SIZE_GUIDE_WIDGET_LOADER_SOURCE = String.raw`
(function () {
  'use strict';
  if (window.__mlehaSizeGuideLoader) { return; }
  window.__mlehaSizeGuideLoader = true;

  var loader = document.currentScript || document.querySelector('script[src*="/embed/size-guide.js"]');
  var loaderSrc = loader && loader.getAttribute('src') || '';
  var configuredBase = loader && loader.getAttribute('data-api') || '';
  var base = configuredBase.replace(/\/+$/, '');
  if (!base && loaderSrc) {
    try { base = new URL(loaderSrc, window.location.href).origin; }
    catch (error) { return; }
  }
  if (!base) { return; }

  function pageType() {
    try {
      var config = window.salla && window.salla.config;
      if (!config || typeof config.get !== 'function') { return ''; }
      var page = config.get('page') || {};
      return String(config.get('page.slug') || config.get('page.type') || page.slug || page.type || '').toLowerCase();
    } catch (error) { return ''; }
  }

  function isProduct(value) {
    return value === 'product.single' || value === 'single-product' || value === 'product';
  }

  var attempts = 0;
  function load() {
    var type = pageType();
    if (!type) {
      attempts += 1;
      if (attempts < 8) { setTimeout(load, Math.min(1000, attempts * 150)); }
      return;
    }
    if (!isProduct(type) || window.__mlehaSizeGuideRuntimeLoading) { return; }
    window.__mlehaSizeGuideRuntimeLoading = true;
    var runtime = document.createElement('script');
    runtime.src = base + '/embed/size-guide-runtime.js';
    runtime.async = true;
    runtime.setAttribute('data-api', configuredBase || base);
    if (loader && loader.getAttribute('data-debug')) {
      runtime.setAttribute('data-debug', loader.getAttribute('data-debug'));
    }
    runtime.onerror = function () { window.__mlehaSizeGuideRuntimeLoading = false; };
    (document.head || document.documentElement).appendChild(runtime);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else { load(); }
  document.addEventListener('salla::ready', load, { once: true });
  window.addEventListener('salla::created', load, { once: true });
})();
`;

/** Dependency-free Arabic size-table and fit calculator runtime. */
export const SIZE_GUIDE_WIDGET_SOURCE = String.raw`
(function () {
  'use strict';
  if (window.__mlehaSizeGuideRuntime) { return; }
  window.__mlehaSizeGuideRuntime = true;

  var script = document.currentScript || document.querySelector('script[src*="/embed/size-guide-runtime.js"]');
  var API_BASE = (script && script.getAttribute('data-api') || '').replace(/\/+$/, '');
  var DEBUG = !!(script && script.getAttribute('data-debug'));
  var STYLE_ID = 'mleha-size-guide-styles';
  var TRIGGER_ID = 'mlhcTrigger';
  var MEASUREMENTS_KEY = 'mleha_measurements';
  var SIZES_KEY = 'mleha_sizes';
  var FIELDS = ['BLOUSE_LEN','SKIRT_LEN','LENGTH','SLEEVE','SHOULDER','CHEST','WAIST','HIP'];
  var LABELS = {
    BLOUSE_LEN:'طول البلوزة',SKIRT_LEN:'طول التنورة',LENGTH:'الطول',SLEEVE:'طول الكم',
    SHOULDER:'محيط الكتف',CHEST:'محيط الصدر',WAIST:'محيط الخصر',HIP:'الورك'
  };
  var COLORS = { CHEST:'#9d3d38', WAIST:'#b5894e' };
  var state = {
    guide:null,
    sku:'',
    user:{},
    bestIndex:-1,
    isOpen:false,
    previousOverflow:'',
    previousPaddingRight:'',
    previousFocus:null
  };

  function debug() {
    if (!DEBUG) { return; }
    try { console.log.apply(console, ['[mleha-size-guide]'].concat([].slice.call(arguments))); }
    catch (error) {}
  }

  function config(path) {
    try {
      if (window.salla && window.salla.config && typeof window.salla.config.get === 'function') {
        return window.salla.config.get(path);
      }
    } catch (error) {}
    return undefined;
  }

  function isProductPage() {
    var page = config('page') || {};
    var type = String(config('page.slug') || config('page.type') || page.slug || page.type || '').toLowerCase();
    return type === 'product.single' || type === 'single-product' || type === 'product';
  }

  function digits(value) {
    var result = String(value == null ? '' : value).trim();
    return /^\d{1,32}$/.test(result) ? result : '';
  }

  function getProductId() {
    var hidden = document.querySelector('#product-form input[name="id"]');
    var value = hidden && digits(hidden.value || hidden.getAttribute('value'));
    if (value) { return value; }
    var options = document.querySelector('#product-form salla-product-options[product-id],salla-product-options[product-id]');
    value = options && digits(options.getAttribute('product-id'));
    if (value) { return value; }
    var page = config('page') || {};
    return digits(config('page.id') || page.id);
  }

  function getSku() {
    try {
      var nativeSku = window.salla && window.salla.product && window.salla.product.sku;
      if (nativeSku) { return String(nativeSku).trim(); }
      var configured = config('page.product.sku');
      if (configured) { return String(configured).trim(); }
    } catch (error) {}
    var selectors = ['[data-product-sku]','[data-sku]','.product-sku','.sku-value','[itemprop="sku"]'];
    for (var i = 0; i < selectors.length; i += 1) {
      var element = document.querySelector(selectors[i]);
      if (!element) { continue; }
      var value = element.getAttribute('data-product-sku') || element.getAttribute('data-sku') ||
        element.getAttribute('content') || element.textContent || '';
      value = String(value).trim();
      if (value) { return value; }
    }
    return '';
  }

  function number(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) { return null; }
    var parsed = Number(raw);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function create(tag, className, text) {
    var element = document.createElement(tag);
    if (className) { element.className = className; }
    if (typeof text === 'string') { element.textContent = text; }
    return element;
  }

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch (error) { return {}; }
  }

  function saveMeasurements(values) {
    try {
      var current = readStorage(MEASUREMENTS_KEY);
      Object.keys(values).forEach(function (key) { current[key] = values[key]; });
      localStorage.setItem(MEASUREMENTS_KEY, JSON.stringify(current));
    } catch (error) {}
  }

  function saveSize(size) {
    try {
      var current = readStorage(SIZES_KEY);
      current[state.sku] = { size:size, ts:Date.now() };
      localStorage.setItem(SIZES_KEY, JSON.stringify(current));
    } catch (error) {}
  }

  function findFit(rows, user) {
    var keys = Object.keys(user);
    for (var index = 0; index < rows.length; index += 1) {
      var fits = keys.every(function (key) {
        var value = number(rows[index][key]);
        return value != null && value >= user[key];
      });
      if (fits) {
        var exact = keys.every(function (key) { return Math.abs(number(rows[index][key]) - user[key]) < 0.001; });
        return { index:index, size:rows[index].size, exact:exact };
      }
    }
    return null;
  }

  function fitIndex(rows, key, value) {
    if (value == null) { return -1; }
    for (var index = 0; index < rows.length; index += 1) {
      var limit = number(rows[index][key]);
      if (limit != null && limit >= value) { return index; }
    }
    return -1;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) { return; }
    var style = create('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mleha-sg{--sg-wine:#9d3d38;--sg-wine-dark:#7d2f2b;--sg-cream:#eeddc7;--sg-soft:#f8f0e8;--sg-line:#ddd0c4;--sg-brown:#452e1e;--sg-muted:#8a7f74;direction:rtl;font-family:inherit}',
      '.mleha-sg *{box-sizing:border-box}',
      '#mlhcTrigger{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin:0 0 16px;padding:11px 14px;background:#fdf6f5;border:0;color:#9d3d38;border-radius:10px;font:600 13px/1.4 inherit;cursor:pointer}',
      '#mlhcTrigger:hover{background:#9d3d38;color:#fff}',
      '.mleha-sg__overlay{position:fixed;inset:0;background:rgba(42,32,28,.42);z-index:99998;opacity:0;visibility:hidden;transition:opacity .25s ease,visibility 0s linear .25s;will-change:opacity}',
      '.mleha-sg__overlay.is-open{opacity:1;visibility:visible;transition-delay:0s}',
      '.mleha-sg__drawer{position:fixed;z-index:99999;background:#fafafa;display:flex;flex-direction:column;transition:transform .3s cubic-bezier(.25,.46,.45,.94);will-change:transform;outline:0}',
      '@media(min-width:700px){.mleha-sg__drawer{top:0;left:0;width:440px;height:100vh;border-radius:0 16px 16px 0;transform:translateX(-100%);box-shadow:4px 0 30px rgba(0,0,0,.15)}.mleha-sg__drawer.is-open{transform:translateX(0)}}',
      '@media(max-width:699px){.mleha-sg__drawer{left:0;right:0;bottom:0;height:90vh;border-radius:18px 18px 0 0;transform:translateY(100%);box-shadow:0 -4px 30px rgba(0,0,0,.15)}.mleha-sg__drawer.is-open{transform:translateY(0)}}',
      '.mleha-sg__head{position:relative;flex:none;padding:20px;background:linear-gradient(160deg,#e8d8c4,#eee2d4);border-bottom:1px solid var(--sg-line)}',
      '.mleha-sg__head h2{margin:0;color:var(--sg-brown);font-size:21px;font-weight:800}.mleha-sg__head p{margin:3px 0 0;color:var(--sg-brown);opacity:.65;font-size:12px}',
      '.mleha-sg__close{position:absolute;top:14px;left:14px;border:0;background:transparent;color:var(--sg-muted);font-size:22px;cursor:pointer}',
      '.mleha-sg__body{flex:1;overflow:auto;padding:18px;-webkit-overflow-scrolling:touch}',
      '.mleha-sg__sku{display:flex;justify-content:space-between;margin-bottom:14px;padding:10px 14px;border:1px solid var(--sg-line);border-radius:10px;background:var(--sg-soft);font-size:13px}.mleha-sg__sku b{direction:ltr}',
      '.mleha-sg__guide{display:flex;gap:12px;margin-bottom:16px;padding:13px;border:1px solid var(--sg-line);border-radius:11px;background:var(--sg-soft);font-size:12px;line-height:1.8}.mleha-sg__guide strong{color:var(--sg-wine)}',
      '.mleha-sg__section{margin:15px 0 9px;padding-bottom:7px;border-bottom:1px solid var(--sg-line);font-size:13px;font-weight:800;color:var(--sg-brown)}',
      '.mleha-sg__table-wrap{overflow-x:auto}.mleha-sg__table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}.mleha-sg__table th{padding:8px 6px;background:var(--sg-brown);color:var(--sg-cream);white-space:nowrap}.mleha-sg__table td{padding:8px 6px;text-align:center;border-bottom:1px solid var(--sg-line);white-space:nowrap}.mleha-sg__table td:first-child{text-align:right;font-weight:700}.mleha-sg__table .is-best{background:#eee2d4;color:var(--sg-wine);font-weight:800}',
      '.mleha-sg__inputs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mleha-sg__field label{display:block;margin-bottom:5px;font-size:12px;font-weight:700}.mleha-sg__input-wrap{position:relative}.mleha-sg__input{width:100%;padding:10px 10px 10px 40px;border:1px solid var(--sg-line);border-radius:9px;background:#fff;font:700 16px inherit;direction:ltr;text-align:center}.mleha-sg__unit{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--sg-muted)}',
      '.mleha-sg__calculate{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:var(--sg-wine);color:#fff;font:700 16px inherit;cursor:pointer}',
      '.mleha-sg__result{display:none;margin-top:16px;padding:22px 18px;border-radius:13px;background:linear-gradient(135deg,var(--sg-wine-dark),#6b2420);color:#fff;text-align:center}.mleha-sg__result.is-visible{display:block}.mleha-sg__result.is-warning{background:linear-gradient(135deg,var(--sg-brown),#2d1a0e)}.mleha-sg__result.is-none{background:linear-gradient(135deg,#6b5144,var(--sg-brown))}',
      '.mleha-sg__size{font-size:56px;line-height:1;font-weight:900}.mleha-sg__result.is-none .mleha-sg__size{font-size:22px;line-height:1.5}.mleha-sg__note{margin-top:9px;font-size:13px;line-height:1.7}.mleha-sg__previous{display:none;margin-bottom:12px;padding:9px 12px;border:1px solid var(--sg-line);border-radius:9px;background:var(--sg-soft);font-size:12px;color:var(--sg-brown)}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function findSizeLabel() {
    var labels = [].slice.call(document.querySelectorAll('.product-single .product-single__info .s-product-options-option-label,.s-product-options-option-label'));
    for (var i = 0; i < labels.length; i += 1) {
      if (/مقاس|قياس|size/i.test(labels[i].textContent || '')) { return labels[i]; }
    }
    for (var j = 0; j < labels.length; j += 1) {
      var parent = labels[j].parentElement;
      if (parent && parent.querySelector('.s-product-options-grid-mode')) { return labels[j]; }
    }
    return labels[0] || null;
  }

  function buildTable(container, bestIndex) {
    container.replaceChildren();
    var rows = state.guide.rows;
    var fields = FIELDS.filter(function (field) { return rows.some(function (row) { return !!row[field]; }); });
    var table = create('table', 'mleha-sg__table');
    var thead = create('thead');
    var header = create('tr');
    var first = create('th', '', 'القياس');
    header.appendChild(first);
    rows.forEach(function (row, index) {
      var th = create('th', index === bestIndex ? 'is-best' : '', row.size);
      header.appendChild(th);
    });
    thead.appendChild(header); table.appendChild(thead);
    var tbody = create('tbody');
    fields.forEach(function (field) {
      var tr = create('tr'); tr.appendChild(create('td', '', LABELS[field]));
      rows.forEach(function (row, index) {
        tr.appendChild(create('td', index === bestIndex ? 'is-best' : '', row[field] || '—'));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); container.appendChild(table);
  }

  function lockPageScroll() {
    if (state.isOpen) { return; }
    var body = document.body;
    var root = document.documentElement;
    state.previousOverflow = body.style.overflow;
    state.previousPaddingRight = body.style.paddingRight;

    // Removing the browser scrollbar changes the viewport width. Compensate
    // for that width before locking so Salla's layout does not jump or flash.
    var scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbarWidth > 0) {
      var currentPadding = 0;
      try { currentPadding = parseFloat(window.getComputedStyle(body).paddingRight) || 0; }
      catch (error) {}
      body.style.paddingRight = currentPadding + scrollbarWidth + 'px';
    }
    body.style.overflow = 'hidden';
    state.isOpen = true;
  }

  function unlockPageScroll() {
    if (!state.isOpen) { return; }
    document.body.style.overflow = state.previousOverflow;
    document.body.style.paddingRight = state.previousPaddingRight;
    state.isOpen = false;
  }

  function closeDrawer() {
    var overlay = document.querySelector('.mleha-sg__overlay');
    var drawer = document.querySelector('.mleha-sg__drawer');
    if (!drawer || !state.isOpen) { return; }
    if (overlay) { overlay.classList.remove('is-open'); }
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    unlockPageScroll();
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') { state.previousFocus.focus(); }
  }

  function openDrawer(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var overlay = document.querySelector('.mleha-sg__overlay');
    var drawer = document.querySelector('.mleha-sg__drawer');
    if (!overlay || !drawer || state.isOpen) { return; }
    state.previousFocus = document.activeElement;
    lockPageScroll();
    overlay.classList.add('is-open'); drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false');
    var close = drawer.querySelector('.mleha-sg__close'); if (close) { close.focus(); }
  }

  function showResult(kind, size, note, bestIndex) {
    var result = document.querySelector('.mleha-sg__result');
    result.className = 'mleha-sg__result is-visible' + (kind === 'warning' ? ' is-warning' : kind === 'none' ? ' is-none' : '');
    result.querySelector('.mleha-sg__size').textContent = size;
    result.querySelector('.mleha-sg__note').textContent = note;
    state.bestIndex = bestIndex;
    buildTable(document.querySelector('.mleha-sg__table-wrap'), bestIndex);
    if (bestIndex >= 0) { saveSize(size); }
    result.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  function calculate() {
    var rows = state.guide.rows;
    var user = {};
    ['CHEST','WAIST'].forEach(function (key) {
      var input = document.getElementById('mleha-sg-input-' + key);
      var value = input && Number(input.value);
      if (isFinite(value) && value > 0) { user[key] = value; }
    });
    if (!Object.keys(user).length) { window.alert('الرجاء إدخال قياس واحد على الأقل'); return; }
    state.user = user; saveMeasurements(user);
    var best = findFit(rows, user);
    if (!best) {
      var last = rows.length - 1;
      var over = Math.max.apply(Math, Object.keys(user).map(function (key) {
        var limit = number(rows[last][key]); return limit == null ? -Infinity : user[key] - limit;
      }));
      if (over > 0 && over <= 2) {
        showResult('warning', rows[last].size, 'هذا هو الأقرب لكِ لكنه قد يكون ضيقاً بعض الشيء.', last);
      } else { showResult('none', 'لا يوجد مقاس مناسب', 'قياساتك تتجاوز أكبر مقاس متوفر حالياً لهذا المنتج.', -1); }
      return;
    }
    if (best.index === 0) {
      var under = Math.max.apply(Math, Object.keys(user).map(function (key) {
        var limit = number(rows[0][key]); return limit == null ? -Infinity : limit - user[key];
      }));
      if (under > 2) { showResult('none', 'لا يوجد مقاس مناسب', 'قياساتك أصغر من أصغر مقاس متوفر حالياً لهذا المنتج.', -1); return; }
      if (under > 0) { showResult('warning', rows[0].size, 'هذا هو الأقرب لكِ لكنه قد يكون واسعاً بعض الشيء.', 0); return; }
    }
    var note = 'قياساتك تناسب هذا المقاس';
    if (state.guide.twoPiece && user.CHEST != null && user.WAIST != null) {
      var top = fitIndex(rows, 'CHEST', user.CHEST);
      var bottom = fitIndex(rows, 'WAIST', user.WAIST);
      if (top >= 0 && bottom >= 0 && top !== bottom) {
        note = 'الصدر يناسب ' + rows[top].size + ' والخصر يناسب ' + rows[bottom].size + '؛ اخترنا الأكبر لراحة القطعتين.';
      } else if (top >= 0 && bottom >= 0) { note = 'قياساتك تناسب هذا المقاس في القطعتين'; }
    }
    showResult('fit', best.size, note, best.index);
  }

  function buildWidget() {
    if (document.querySelector('.mleha-sg__drawer') || document.getElementById(TRIGGER_ID)) { return true; }
    var options = document.querySelector('salla-product-options');
    var label = findSizeLabel();
    if (!options && !label) { return false; }
    injectStyles();

    var trigger = create('button', 'mleha-sg__trigger', '📏 اعرفي مقاسك');
    trigger.id = TRIGGER_ID; trigger.type = 'button'; trigger.addEventListener('click', openDrawer);
    // Do not nest this button inside Salla's option label. Label click handlers
    // can select/re-render an option and repeatedly disturb the page scrollbar.
    if (options) { options.insertAdjacentElement('beforebegin', trigger); }
    else if (label) { label.insertAdjacentElement('afterend', trigger); }

    var root = create('div', 'mleha-sg');
    var overlay = create('div', 'mleha-sg__overlay'); overlay.addEventListener('click', closeDrawer);
    var drawer = create('section', 'mleha-sg__drawer');
    drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-hidden', 'true'); drawer.setAttribute('aria-labelledby', 'mleha-sg-title'); drawer.tabIndex = -1;
    var head = create('header', 'mleha-sg__head');
    var close = create('button', 'mleha-sg__close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق دليل المقاسات'); close.addEventListener('click', closeDrawer);
    var title = create('h2', '', 'اعرفي مقاسك'); title.id = 'mleha-sg-title';
    head.appendChild(close); head.appendChild(title); head.appendChild(create('p', '', 'أدخلي قياساتك واحصلي على المقاس الأقرب لكِ'));
    var body = create('div', 'mleha-sg__body');
    var skuBar = create('div', 'mleha-sg__sku'); skuBar.appendChild(create('span', '', 'رمز المنتج')); skuBar.appendChild(create('b', '', state.sku)); body.appendChild(skuBar);
    var previous = create('div', 'mleha-sg__previous');
    var savedSizes = readStorage(SIZES_KEY); if (savedSizes[state.sku]) { previous.style.display = 'block'; previous.textContent = '✓ مقاسك السابق لهذا المنتج: ' + savedSizes[state.sku].size; }
    body.appendChild(previous);
    var guide = create('div', 'mleha-sg__guide');
    var guideCopy = create('div'); guideCopy.appendChild(create('strong', '', 'طريقة القياس'));
    guideCopy.appendChild(create('div', '', '١. الصدر: عند أوسع نقطة من الكتف.'));
    guideCopy.appendChild(create('div', '', '٢. الخصر: عند أضيق نقطة فوق السرة.'));
    guide.appendChild(guideCopy); body.appendChild(guide);
    body.appendChild(create('div', 'mleha-sg__section', 'جدول المقاسات'));
    var tableWrap = create('div', 'mleha-sg__table-wrap'); body.appendChild(tableWrap); buildTable(tableWrap, -1);
    body.appendChild(create('div', 'mleha-sg__section', 'قياساتك (إنش)'));
    var inputs = create('div', 'mleha-sg__inputs');
    var saved = readStorage(MEASUREMENTS_KEY);
    ['CHEST','WAIST'].forEach(function (key) {
      if (!state.guide.rows.some(function (row) { return number(row[key]) != null; })) { return; }
      var field = create('div', 'mleha-sg__field'); var labelElement = create('label', '', key === 'CHEST' ? 'الصدر' : 'الخصر'); labelElement.style.color = COLORS[key];
      var wrap = create('div', 'mleha-sg__input-wrap'); var input = create('input', 'mleha-sg__input');
      input.id = 'mleha-sg-input-' + key; input.type = 'number'; input.min = '1'; input.step = '0.1'; input.inputMode = 'decimal'; input.setAttribute('aria-label', labelElement.textContent);
      if (saved[key] != null) { input.value = saved[key]; }
      wrap.appendChild(input); wrap.appendChild(create('span', 'mleha-sg__unit', 'إنش')); field.appendChild(labelElement); field.appendChild(wrap); inputs.appendChild(field);
    });
    body.appendChild(inputs);
    var calculateButton = create('button', 'mleha-sg__calculate', 'احسبي مقاسي ←'); calculateButton.type = 'button'; calculateButton.addEventListener('click', calculate); body.appendChild(calculateButton);
    var result = create('div', 'mleha-sg__result'); result.setAttribute('role', 'status'); result.appendChild(create('div', 'mleha-sg__size', '—')); result.appendChild(create('div', 'mleha-sg__note', '')); body.appendChild(result);
    drawer.appendChild(head); drawer.appendChild(body); root.appendChild(overlay); root.appendChild(drawer); document.body.appendChild(root);

    document.addEventListener('keydown', function (event) {
      if (!drawer.classList.contains('is-open')) { return; }
      if (event.key === 'Escape') { closeDrawer(); return; }
      if (event.key !== 'Tab') { return; }
      var focusable = [].slice.call(drawer.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return true;
  }

  function mountWithRetry() {
    if (buildWidget()) { return; }
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (buildWidget() || attempts >= 80) { clearInterval(timer); }
    }, 250);
  }

  function loadGuide() {
    if (!API_BASE || !isProductPage()) { return; }
    var productId = getProductId(); var sku = getSku();
    if (!productId && !sku) { return false; }
    var params = [];
    if (productId) { params.push('productId=' + encodeURIComponent(productId)); }
    if (sku) { params.push('sku=' + encodeURIComponent(sku)); }
    fetch(API_BASE + '/api/public/size-guides?' + params.join('&'), { cache:'no-store', credentials:'omit' })
      .then(function (response) { if (!response.ok) { throw new Error(String(response.status)); } return response.json(); })
      .then(function (payload) {
        if (!payload || !payload.success || !payload.guide || !payload.guide.data || !Array.isArray(payload.guide.data.rows)) { return; }
        state.guide = payload.guide.data; state.sku = payload.guide.sku || sku; mountWithRetry();
      })
      .catch(function (error) { debug('guide unavailable', error && error.message); });
    return true;
  }

  if (window.__mlehaSizeGuideTestMode) {
    window.__mlehaSizeGuideTest = { number:number, findFit:findFit, fitIndex:fitIndex, getProductId:getProductId, getSku:getSku, isProductPage:isProductPage };
    return;
  }

  var identifierAttempts = 0;
  function start() {
    if (loadGuide()) { return; }
    identifierAttempts += 1;
    if (identifierAttempts < 40) { setTimeout(start, 250); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, { once:true }); }
  else { start(); }
})();
`;
