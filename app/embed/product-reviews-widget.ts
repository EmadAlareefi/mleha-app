/**
 * Small storefront loader. It is safe to install globally in Salla custom code:
 * the runtime is requested only after Salla explicitly declares product.single.
 */
export const PRODUCT_REVIEWS_WIDGET_LOADER_SOURCE = String.raw`
(function () {
  'use strict';

  if (window.__mlehaProductReviewsLoader) { return; }
  window.__mlehaProductReviewsLoader = true;

  var loader = document.currentScript ||
    document.querySelector('script[src*="/embed/product-reviews.js"]');
  var loaderSrc = loader && loader.getAttribute('src') || '';
  var configuredBase = loader && loader.getAttribute('data-api') || '';
  var base = configuredBase.replace(/\/+$/, '');
  if (!base && loaderSrc) {
    try { base = new URL(loaderSrc, window.location.href).origin; }
    catch (error) { return; }
  }
  if (!base) { return; }

  function declaredPageType() {
    try {
      if (window.salla && window.salla.config && typeof window.salla.config.get === 'function') {
        var page = window.salla.config.get('page') || {};
        return window.salla.config.get('page.slug') ||
          window.salla.config.get('page.type') || page.slug || page.type || null;
      }
    } catch (error) { /* Salla may still be starting */ }
    return null;
  }

  function isSingleProductType(value) {
    var type = String(value || '').toLowerCase();
    return type === 'product.single' || type === 'single-product' || type === 'product';
  }

  var attempts = 0;
  function loadOnProductPage() {
    var pageType = declaredPageType();
    if (!pageType) {
      attempts += 1;
      if (attempts < 8) { setTimeout(loadOnProductPage, Math.min(1000, attempts * 150)); }
      return;
    }
    if (!isSingleProductType(pageType) || window.__mlehaProductReviewsRuntimeLoading) { return; }

    window.__mlehaProductReviewsRuntimeLoading = true;
    var runtime = document.createElement('script');
    runtime.src = base + '/embed/product-reviews-runtime.js';
    runtime.async = true;
    runtime.setAttribute('data-api', configuredBase || base);
    if (loader && loader.getAttribute('data-debug')) {
      runtime.setAttribute('data-debug', loader.getAttribute('data-debug'));
    }
    runtime.onerror = function () { window.__mlehaProductReviewsRuntimeLoading = false; };
    (document.head || document.documentElement).appendChild(runtime);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadOnProductPage, { once: true });
  } else {
    loadOnProductPage();
  }
  document.addEventListener('salla::ready', loadOnProductPage, { once: true });
  window.addEventListener('salla::created', loadOnProductPage, { once: true });
})();
`;

/** Dependency-free runtime for mleha.com single-product pages. */
export const PRODUCT_REVIEWS_WIDGET_SOURCE = String.raw`
(function () {
  'use strict';

  if (window.__mlehaProductReviewsRuntime) { return; }
  window.__mlehaProductReviewsRuntime = true;

  var script = document.currentScript ||
    document.querySelector('script[src*="/embed/product-reviews-runtime.js"]');
  var API_BASE = (script && script.getAttribute('data-api') || '').replace(/\/+$/, '');
  var DEBUG = !!(script && script.getAttribute('data-debug'));
  var ENDPOINT = API_BASE + '/api/public/product-reviews';
  var SECTION_ID = 'mleha-product-custom-reviews';
  var STYLE_ID = 'mleha-product-reviews-styles';
  var AVATAR = 'https://cdn.assets.salla.network/stores/themes/default/assets/images/avatar_male.png';

  function debug() {
    if (!DEBUG) { return; }
    try { console.log.apply(console, ['[mleha-product-reviews]'].concat([].slice.call(arguments))); }
    catch (error) { /* console is optional */ }
  }

  function sallaConfig(path) {
    try {
      if (window.salla && window.salla.config && typeof window.salla.config.get === 'function') {
        return window.salla.config.get(path);
      }
    } catch (error) { /* fail closed */ }
    return undefined;
  }

  function isSingleProductPage() {
    var page = sallaConfig('page') || {};
    var type = String(
      sallaConfig('page.slug') || sallaConfig('page.type') || page.slug || page.type || ''
    ).toLowerCase();
    return type === 'product.single' || type === 'single-product' || type === 'product';
  }

  function digits(value) {
    var text = String(value == null ? '' : value).trim();
    return /^\d{1,32}$/.test(text) ? text : '';
  }

  function getProductId() {
    var hidden = document.querySelector('#product-form input[name="id"]');
    var fromHidden = hidden && digits(hidden.value || hidden.getAttribute('value'));
    if (fromHidden) { return fromHidden; }

    var options = document.querySelector('#product-form salla-product-options[product-id],salla-product-options[product-id]');
    var fromOptions = options && digits(options.getAttribute('product-id'));
    if (fromOptions) { return fromOptions; }

    var page = sallaConfig('page') || {};
    return digits(sallaConfig('page.id') || page.id);
  }

  function create(tag, className, text) {
    var element = document.createElement(tag);
    if (className) { element.className = className; }
    if (typeof text === 'string') { element.textContent = text; }
    return element;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) { return; }
    var style = create('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mleha-pr{direction:rtl;text-align:right;margin:0 0 1.5rem;font-family:inherit;}',
      '.mleha-pr *{box-sizing:border-box;}',
      '.mleha-pr__container{width:100%;max-width:100%;}',
      '.mleha-pr salla-slider{display:block;width:100%;}',
      '.mleha-pr__review{height:100%;padding:2px;}',
      '.mleha-pr__card{display:flex;flex-direction:column;justify-content:space-between;height:100%;min-height:190px;',
      'padding:1.4rem;border-radius:.65rem;background:var(--color-grey-50,#fff);',
      'box-shadow:rgba(50,50,105,.15) 0 2px 5px 0,rgba(0,0,0,.05) 0 1px 1px 0;}',
      '.mleha-pr__body{margin:.65rem 0 0;color:var(--color-text,#2a2422);font-size:.9rem;line-height:1.8;white-space:pre-wrap;}',
      '.mleha-pr__person{display:flex;align-items:center;gap:.75rem;margin-top:1.5rem;}',
      '.mleha-pr__avatar{width:3.5rem;height:3.5rem;flex:0 0 3.5rem;border-radius:999px;object-fit:cover;}',
      '.mleha-pr__meta{min-width:0;}',
      '.mleha-pr__name{margin:0 0 .35rem;color:var(--color-text,#2a2422);font-size:1rem;font-weight:600;}',
      '.mleha-pr__city{color:var(--color-text-muted,#777);font-size:.85rem;font-weight:400;}',
      '.mleha-pr__rating{display:flex;gap:.25rem;color:#fbbf24;font-size:.8rem;}',
      '.mleha-pr__star--empty{opacity:.22;}',
      '@media(max-width:600px){.mleha-pr__card{min-height:175px;padding:1.1rem;}.mleha-pr__avatar{width:3rem;height:3rem;flex-basis:3rem;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function buildReviewCard(review) {
    var slide = create('div', 'review mleha-pr__review');
    var card = create('div', 'mleha-pr__card');
    var copy = create('div', 'mleha-pr__copy');
    var body = create('p', 'mleha-pr__body', String(review.body || ''));
    var person = create('div', 'mleha-pr__person');
    var avatar = create('img', 'mleha-pr__avatar');
    var meta = create('div', 'mleha-pr__meta');
    var name = create('h4', 'mleha-pr__name');
    var nameText = create('span', 'review-name', String(review.reviewerName || ''));
    var cityText = create('span', 'review-city mleha-pr__city', String(review.reviewerCity || ''));
    var rating = create('div', 'comment__rating mleha-pr__rating');
    var stars = Math.max(1, Math.min(5, Number(review.rating) || 5));

    avatar.src = AVATAR;
    avatar.alt = String(review.reviewerName || '') + ' - ' + String(review.reviewerCity || '');
    avatar.loading = 'lazy';
    name.appendChild(nameText);
    name.appendChild(document.createTextNode(' - '));
    name.appendChild(cityText);

    for (var index = 1; index <= 5; index += 1) {
      var star = create('i', 'sicon-star2' + (index > stars ? ' mleha-pr__star--empty' : ''));
      star.setAttribute('aria-hidden', 'true');
      rating.appendChild(star);
    }
    rating.setAttribute('aria-label', stars + ' من 5');

    copy.appendChild(body);
    meta.appendChild(name);
    meta.appendChild(rating);
    person.appendChild(avatar);
    person.appendChild(meta);
    card.appendChild(copy);
    card.appendChild(person);
    slide.appendChild(card);
    return slide;
  }

  function buildSection(reviews) {
    var section = create('section', 'mleha-pr s-block s-block--custom-reviews relative');
    var container = create('div', 'mleha-pr__container');
    var slider = create('salla-slider', 'reviews-slider s-scrollbar-slider');
    var items = create('div');
    section.id = SECTION_ID;
    slider.id = 'mleha-product-reviews-slider';
    slider.setAttribute('type', 'carousel');
    slider.setAttribute('slider-config', JSON.stringify({ autoplay: true, spacebetween: 30 }));
    slider.setAttribute('show-controls', 'false');
    items.setAttribute('slot', 'items');
    reviews.forEach(function (review) { items.appendChild(buildReviewCard(review)); });
    slider.appendChild(items);
    container.appendChild(slider);
    section.appendChild(container);
    return section;
  }

  function mount(reviews) {
    if (!reviews.length || document.getElementById(SECTION_ID)) { return true; }
    var target = document.querySelector('#single-product-details #reviews, #reviews');
    if (!target) { return false; }
    injectStyles();
    target.insertBefore(buildSection(reviews), target.firstChild || null);
    return true;
  }

  function mountWhenReady(reviews) {
    var attempts = 0;
    function tryMount() {
      if (mount(reviews)) { return; }
      attempts += 1;
      if (attempts < 80) { setTimeout(tryMount, 100); }
    }
    tryMount();
  }

  function start() {
    if (!API_BASE || !isSingleProductPage()) { return; }
    var productId = getProductId();
    if (!productId) { debug('Product id was not available'); return; }

    fetch(ENDPOINT + '?productId=' + encodeURIComponent(productId), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) { throw new Error('HTTP ' + response.status); }
        return response.json();
      })
      .then(function (payload) {
        var reviews = payload && Array.isArray(payload.reviews) ? payload.reviews : [];
        if (reviews.length) { mountWhenReady(reviews); }
      })
      .catch(function (error) { debug('Could not load reviews', error); });
  }

  if (window.__mlehaProductReviewsTestMode) {
    window.__mlehaProductReviewsTest = {
      getProductId: getProductId,
      isSingleProductPage: isSingleProductPage,
      buildReviewCard: buildReviewCard
    };
    return;
  }

  start();
})();
`;
