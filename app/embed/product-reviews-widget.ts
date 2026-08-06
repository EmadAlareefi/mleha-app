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
      '.mleha-pr,.mleha-pr *{box-sizing:border-box;}',
      '.mleha-pr__review{display:block;opacity:1!important;transform:none!important;}',
      '.mleha-pr__rating{display:flex;gap:.3rem;color:#fbbf24;font-size:1rem;}',
      '.mleha-pr__star--empty{opacity:.22;}',
      '.mleha-pr__purchase-check{display:inline-grid;place-items:center;width:1.25rem;height:1.25rem;border-radius:999px;background:#fbbf24;color:#111;font-size:.75rem;font-weight:700;line-height:1;}',
      '.mleha-pr__body{margin:0;white-space:pre-wrap;}',
      '.mleha-pr__photo-link{display:inline-block;margin-top:.75rem;border-radius:.45rem;line-height:0;}',
      '.mleha-pr__photo{width:5.25rem;height:5.25rem;border:1px solid var(--color-grey-200,#e5e7eb);border-radius:.45rem;object-fit:cover;}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function buildReviewCard(review) {
    var item = create('article', 's-comments-item mleha-pr__review');
    var wrapper = create('div', 's-comments-item-wrapper');
    var inner = create('div', 's-comments-item-inner s-comments-flex-1');
    var avatarWrap = create('div', 's-comments-item-avatar');
    var avatar = create('img', 's-comments-item-avatar-img');
    var column = create('div', 's-comments-flex-1');
    var userWrap = create('div', 's-comments-item-user-wrapper');
    var userInfo = create('div', 's-comments-item-user-info');
    var name = create('h3', 's-comments-item-user-info-name-with-margin', String(review.reviewerName || ''));
    var status = create('div', 's-comments-flex');
    var rated = create('span', 's-comments-item-rated-widget', 'تم التقييم');
    var timestamp = create('p', 's-comments-item-timestamp s-ltr', formatReviewDate(review.createdAt));
    var ratingRow = create('div', 'flex flex-row gap-4 mt-2 mb-4');
    var rating = create('div', 'comment__rating mleha-pr__rating');
    var content = create('div', 's-comments-item-content');
    var body = create('p', 'mleha-pr__body', String(review.body || ''));
    var stars = Math.max(1, Math.min(5, Number(review.rating) || 5));

    avatar.src = AVATAR;
    avatar.alt = String(review.reviewerName || '');
    avatar.loading = 'lazy';
    if (review.createdAt) { timestamp.setAttribute('datetime', String(review.createdAt)); }

    for (var index = 1; index <= 5; index += 1) {
      var star = create('i', 'sicon-star2' + (index > stars ? ' mleha-pr__star--empty' : ''));
      star.setAttribute('aria-hidden', 'true');
      rating.appendChild(star);
    }
    rating.setAttribute('aria-label', stars + ' من 5');

    userInfo.appendChild(name);
    if (review.isVerifiedPurchase) {
      var purchaseCheck = create(
        'span',
        's-comments-item-has-order-check-icon mleha-pr__purchase-check',
        '✓'
      );
      var purchaseText = create(
        'span',
        's-comments-item-has-order-check-text',
        'قام بالشراء،'
      );
      purchaseCheck.setAttribute('aria-hidden', 'true');
      status.appendChild(purchaseCheck);
      status.appendChild(purchaseText);
    }
    status.appendChild(rated);
    userInfo.appendChild(status);
    userWrap.appendChild(userInfo);
    userWrap.appendChild(timestamp);
    ratingRow.appendChild(rating);
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
    avatarWrap.appendChild(avatar);
    column.appendChild(userWrap);
    column.appendChild(ratingRow);
    column.appendChild(content);
    inner.appendChild(avatarWrap);
    inner.appendChild(column);
    wrapper.appendChild(inner);
    item.appendChild(wrapper);
    return item;
  }

  function formatReviewDate(value) {
    if (!value) { return ''; }
    try {
      var date = new Date(value);
      if (isNaN(date.getTime())) { return ''; }
      return date.getDate() + '/' + (date.getMonth() + 1) + '/' + date.getFullYear();
    } catch (error) { return ''; }
  }

  function buildReviewList(reviews) {
    var list = create('div', 'mleha-pr mleha-pr__native-list');
    list.id = SECTION_ID;
    reviews.forEach(function (review) { list.appendChild(buildReviewCard(review)); });
    return list;
  }

  function isVisible(element) {
    if (!element || !element.getClientRects) { return false; }
    return element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0;
  }

  function mount(reviews) {
    if (!reviews.length) { return true; }
    var host = document.querySelector('#single-product-details #reviews salla-comments, #reviews salla-comments');
    if (!host || !isVisible(host)) { return false; }
    var existing = document.getElementById(SECTION_ID);
    if (existing && host.contains(existing)) { return true; }
    if (existing) { existing.remove(); }
    var container = host.querySelector('.s-comments-container');
    if (!container) { return false; }

    injectStyles();
    var list = buildReviewList(reviews);
    var nativeItem = container.querySelector('salla-comment-item');
    if (nativeItem && nativeItem.parentElement) {
      nativeItem.parentElement.insertBefore(list, nativeItem);
    } else {
      var emptyState = container.querySelector('.s-comments-empty, .s-comments-empty-state');
      container.insertBefore(list, emptyState || null);
    }
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
      mount(reviews);
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
      var watchRoot = document.querySelector('#single-product-details #reviews, #reviews') || document.documentElement;
      observer.observe(watchRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }
    window.addEventListener('pagehide', cleanup, { once: true });
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
      buildReviewCard: buildReviewCard,
      formatReviewDate: formatReviewDate
    };
    return;
  }

  start();
})();
`;
