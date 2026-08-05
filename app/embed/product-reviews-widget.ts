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
      '.mleha-pr__track{display:flex;flex-direction:column;width:100%;}',
      '.mleha-pr__review{min-width:0;padding:1.5rem .25rem;border-bottom:1px solid var(--color-grey-200,#e5e7eb);}',
      '.mleha-pr__review:first-child{padding-top:.5rem;}',
      '.mleha-pr__person{display:flex;align-items:flex-start;gap:.8rem;}',
      '.mleha-pr__avatar{width:3rem;height:3rem;flex:0 0 3rem;border-radius:999px;object-fit:cover;}',
      '.mleha-pr__meta{min-width:0;}',
      '.mleha-pr__name{margin:0;color:var(--color-text,#2a2422);font-size:1rem;font-weight:700;line-height:1.5;}',
      '.mleha-pr__city{margin-inline-start:.4rem;color:var(--color-text-muted,#777);font-size:.82rem;font-weight:400;}',
      '.mleha-pr__date{display:block;margin-top:.15rem;color:var(--color-text-muted,#888);font-size:.82rem;}',
      '.mleha-pr__content{margin-inline-start:3.8rem;}',
      '.mleha-pr__rating{display:flex;gap:.28rem;margin-top:.65rem;color:#fbbf24;font-size:1rem;}',
      '.mleha-pr__star--empty{opacity:.22;}',
      '.mleha-pr__body{margin:.85rem 0 0;color:var(--color-text,#57534e);font-size:.95rem;line-height:1.9;white-space:pre-wrap;}',
      '.mleha-pr__photo-link{display:inline-block;margin-top:.75rem;border-radius:.45rem;line-height:0;}',
      '.mleha-pr__photo{width:5.25rem;height:5.25rem;border:1px solid var(--color-grey-200,#e5e7eb);border-radius:.45rem;object-fit:cover;}',
      '@media(max-width:600px){.mleha-pr__review{padding:1.25rem 0;}.mleha-pr__content{margin-inline-start:0;}',
      '.mleha-pr__rating{margin-inline-start:3.8rem;}.mleha-pr__body,.mleha-pr__photo-link{margin-inline-start:3.8rem;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function buildReviewCard(review) {
    var item = create('article', 'review mleha-pr__review');
    var person = create('div', 'mleha-pr__person');
    var avatar = create('img', 'mleha-pr__avatar');
    var meta = create('div', 'mleha-pr__meta');
    var name = create('h4', 'mleha-pr__name');
    var nameText = create('span', 'review-name', String(review.reviewerName || ''));
    var cityText = create('span', 'review-city mleha-pr__city', String(review.reviewerCity || ''));
    var date = create('time', 'mleha-pr__date', formatReviewDate(review.createdAt));
    var content = create('div', 'mleha-pr__content');
    var rating = create('div', 'comment__rating mleha-pr__rating');
    var body = create('p', 'mleha-pr__body', String(review.body || ''));
    var stars = Math.max(1, Math.min(5, Number(review.rating) || 5));

    avatar.src = AVATAR;
    avatar.alt = String(review.reviewerName || '') + ' - ' + String(review.reviewerCity || '');
    avatar.loading = 'lazy';
    name.appendChild(nameText);
    name.appendChild(cityText);
    if (review.createdAt) { date.setAttribute('datetime', String(review.createdAt)); }

    for (var index = 1; index <= 5; index += 1) {
      var star = create('i', 'sicon-star2' + (index > stars ? ' mleha-pr__star--empty' : ''));
      star.setAttribute('aria-hidden', 'true');
      rating.appendChild(star);
    }
    rating.setAttribute('aria-label', stars + ' من 5');

    meta.appendChild(name);
    meta.appendChild(date);
    person.appendChild(avatar);
    person.appendChild(meta);
    content.appendChild(rating);
    content.appendChild(body);
    if (review.reviewImageUrl) {
      var photoLink = create('a', 'mleha-pr__photo-link');
      var photo = create('img', 'mleha-pr__photo');
      photoLink.href = String(review.reviewImageUrl);
      photoLink.target = '_blank';
      photoLink.rel = 'noopener noreferrer';
      photo.src = String(review.reviewImageUrl);
      photo.alt = 'صورة مرفقة من ' + String(review.reviewerName || 'العميلة');
      photo.loading = 'lazy';
      photoLink.appendChild(photo);
      content.appendChild(photoLink);
    }
    item.appendChild(person);
    item.appendChild(content);
    return item;
  }

  function formatReviewDate(value) {
    if (!value) { return ''; }
    try {
      return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
        day: 'numeric', month: 'numeric', year: 'numeric'
      }).format(new Date(value));
    } catch (error) { return ''; }
  }

  function buildSection(reviews) {
    var section = create('section', 'mleha-pr s-block s-block--custom-reviews relative');
    var container = create('div', 'mleha-pr__container');
    var track = create('div', 'mleha-pr__track');
    section.id = SECTION_ID;
    track.id = 'mleha-product-reviews-track';
    track.setAttribute('role', 'list');
    reviews.forEach(function (review) {
      var card = buildReviewCard(review);
      card.setAttribute('role', 'listitem');
      track.appendChild(card);
    });
    container.appendChild(track);
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
