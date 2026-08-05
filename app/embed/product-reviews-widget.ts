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
      '.mleha-pr__card{position:relative;}',
      '.mleha-pr__city{margin-inline-start:.35rem;}',
      '.mleha-pr__star--empty{opacity:.22;}',
      '.mleha-pr__photo-link{display:inline-block;margin-top:.75rem;border-radius:.45rem;line-height:0;}',
      '.mleha-pr__photo{width:5.25rem;height:5.25rem;border:1px solid var(--color-grey-200,#e5e7eb);border-radius:.45rem;object-fit:cover;}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function buildReviewCard(review) {
    var slide = create('div', 'review mleha-pr__review');
    var card = create('div', 'mleha-pr__card flex flex-col justify-between h-full w-full p-[1.4rem] bg-store-bg-secondary rounded-md shadow-[rgba(50,_50,_105,_0.15)_0px_2px_5px_0px,_rgba(0,_0,_0,_0.05)_0px_1px_1px_0px]');
    var copy = create('div', 'relative text-store-text-secondary break-words');
    var body = create('p', 'leading-6 text-sm mb-2 mt-2.5 md:mt-4 text-store-text-primary', String(review.body || ''));
    var person = create('div', 'flex items-center mt-6 -mx-2');
    var avatar = create('img', 'object-cover mx-2 rounded-full w-14 h-14');
    var meta = create('div', 'mx-2');
    var name = create('h4', 'text-base text-store-text-primary mb-2');
    var nameText = create('span', 'review-name', String(review.reviewerName || ''));
    var cityText = create('span', 'review-city mleha-pr__city', String(review.reviewerCity || ''));
    var rating = create('div', 'w-full comment__rating text-xs mb-2.5 rtl:space-x-reverse space-x-1');
    var quote = create('i', 'sicon-quote -scale-y-100 -scale-x-100 absolute top-4 end-4 text-3xl opacity-10 text-store-text-secondary');
    var stars = Math.max(1, Math.min(5, Number(review.rating) || 5));

    avatar.src = AVATAR;
    avatar.alt = String(review.reviewerName || '') + ' - ' + String(review.reviewerCity || '');
    avatar.loading = 'lazy';
    name.appendChild(nameText);
    name.appendChild(cityText);

    for (var index = 1; index <= 5; index += 1) {
      var star = create('i', 'sicon-star2 inline-block text-amber-400' + (index > stars ? ' mleha-pr__star--empty' : ''));
      star.setAttribute('aria-hidden', 'true');
      rating.appendChild(star);
    }
    rating.setAttribute('aria-label', stars + ' من 5');

    copy.appendChild(body);
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
      copy.appendChild(photoLink);
    }
    meta.appendChild(name);
    meta.appendChild(rating);
    person.appendChild(avatar);
    person.appendChild(meta);
    card.appendChild(copy);
    card.appendChild(person);
    card.appendChild(quote);
    slide.appendChild(card);
    return slide;
  }

  function buildSection(reviews) {
    var section = create('section', 'mleha-pr s-block s-block--custom-reviews relative');
    var container = create('div', 'container mx-auto mleha-pr__container');
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

  function isVisible(element) {
    if (!element || !element.getClientRects) { return false; }
    return element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0;
  }

  function mount(reviews) {
    if (!reviews.length || document.getElementById(SECTION_ID)) { return true; }
    var target = document.querySelector('#single-product-details #reviews, #reviews');
    if (!target || !isVisible(target)) { return false; }
    injectStyles();
    target.insertBefore(buildSection(reviews), target.firstChild || null);
    setTimeout(function () {
      try { window.dispatchEvent(new Event('resize')); }
      catch (error) { /* layout refresh is best effort */ }
    }, 100);
    return true;
  }

  function mountWhenReady(reviews) {
    var observer = null;
    var frame = 0;

    function cleanup() {
      if (observer) { observer.disconnect(); }
      document.removeEventListener('click', scheduleMount, true);
      window.removeEventListener('resize', scheduleMount);
      if (frame && window.cancelAnimationFrame) { window.cancelAnimationFrame(frame); }
      frame = 0;
    }

    function tryMount() {
      frame = 0;
      if (mount(reviews)) { cleanup(); }
    }

    function scheduleMount() {
      if (frame) { return; }
      var enqueue = window.requestAnimationFrame || function (callback) { return setTimeout(callback, 16); };
      frame = enqueue(tryMount);
    }

    document.addEventListener('click', scheduleMount, true);
    window.addEventListener('resize', scheduleMount);
    if (window.MutationObserver && document.documentElement) {
      observer = new MutationObserver(scheduleMount);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }
    scheduleMount();
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
