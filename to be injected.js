(function () {
  'use strict';

  if (window.__mlehaHostedWidgetLoaders) return;
  window.__mlehaHostedWidgetLoaders = true;
  window.__mlehaHostedSizeGuide = true;

  var API_BASE = 'https://app.mleha.com';
  var WIDGETS = [
    { id: 'mleha-notify-me-loader', src: API_BASE + '/embed/notify-me.js' },
    { id: 'mleha-product-reviews-loader', src: API_BASE + '/embed/product-reviews.js' },
    { id: 'mleha-size-guide-loader', src: API_BASE + '/embed/size-guide.js' }
  ];

  function isSingleProductPage() {
    try {
      if (window.salla && window.salla.url && typeof window.salla.url.is_page === 'function' && window.salla.url.is_page('product.single')) return true;
      var config = window.salla && window.salla.config;
      var page = config && typeof config.get === 'function' ? config.get('page') || {} : {};
      var slug = page.slug || (config && typeof config.get === 'function' ? config.get('page.slug') || config.get('page.type') : '') || '';
      return ['product.single', 'single-product', 'product'].includes(String(slug).toLowerCase());
    } catch (error) { return false; }
  }

  function loadWidgets() {
    if (!isSingleProductPage()) return;
    WIDGETS.forEach(function (widget) {
      if (document.getElementById(widget.id)) return;
      var script = document.createElement('script');
      script.id = widget.id;
      script.src = widget.src;
      script.setAttribute('data-api', API_BASE);
      script.async = true;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function start() {
    if (window.salla && typeof window.salla.onReady === 'function') window.salla.onReady(loadWidgets);
    else window.addEventListener('salla::created', loadWidgets, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

(function () {
'use strict';

if (window.__mlehaStorefrontBundleLoaded) return;
window.__mlehaStorefrontBundleLoaded = true;

function getMlehaSallaPage() {
  try {
    const config = window.salla?.config;
    if (!config || typeof config.get !== 'function') return {};
    const page = config.get('page');
    return page && typeof page === 'object' ? page : {};
  } catch {
    return {};
  }
}

function getMlehaPageSlug() {
  const page = getMlehaSallaPage();
  try {
    return String(
      page.slug ||
      window.salla?.config?.get?.('page.slug') ||
      window.salla?.config?.get?.('page.type') ||
      ''
    ).toLowerCase();
  } catch {
    return String(page.slug || '').toLowerCase();
  }
}

function isMlehaProductPage() {
  try {
    if (window.salla?.url?.is_page?.('product.single')) return true;
  } catch {}

  const slug = getMlehaPageSlug();
  if (slug) {
    return slug === 'product.single' || slug === 'single-product' || slug === 'product';
  }

  // Use only main-product roots as a late-loading fallback. Product-card add
  // buttons appear on home/category pages and must never qualify the page.
  return !!document.querySelector('#product-form, .product-single');
}

function isMlehaCartPage() {
  const slug = getMlehaPageSlug();
  return slug === 'cart' || /^\/(?:ar|en)\/cart\/?$/i.test(location.pathname);
}

function isMlehaListingPage() {
  const slug = getMlehaPageSlug();
  if (['category.index', 'products.index', 'latest-products', 'offers', 'search'].includes(slug)) {
    return true;
  }
  return !!document.querySelector('#filters-menu, salla-products-list[autoload]') ||
    /\/c\d+(?:\/|$)|\/(?:latest-products|offers|search)(?:\/|$)/i.test(location.pathname);
}

/* ======================================================================
   MLEHA — Table of Contents
   ======================================================================
    0. Category Nav History Fix  (line 25)
    1. Utilities & Helpers  (line 94)
    2. Theme & Global Settings  (line 119)
    3. Navbar  (line 134)
    4. Advanced Slider — Click-through Navigation  (line 183)
    5. Twin Banners — Content Injection  (line 215)
    6. Home Page / Sections Enhancements  (line 306)
    7. mleha-best-sellers  (line 456)
    8. Videos Gallery Section  (line 533)
    9. Product Slider - Salla Integration  (line 668)
   10. Product Page  (line 1270)
   11. Infinite Scroll Auto Load  (line 1957)
   12. Size Calculator - Script  (line 2102)
   13. Filter Popup  (line 2793)
   14. Cart Page Modifications  (line 3346)
   15. Popup Modal  (line 3603)
   16. Footer  (line 3824)
   17. Floating Action Button  (line 4278)
   ====================================================================== */


/* =====================================
========================================
========================================
========================================
========================================
========================================
  MLEHA — Category Nav History Fix
========================================


========================================
========================================
========================================
===================================== */

/*
  المشكلة:
  عند دخول أي قسم، مكوّن الفلاتر في سلة يضيف تلقائياً
  ?filters[category_id]=<id> إلى الرابط عبر history.pushState،
  فيُنشئ إدخالين في سجل التصفح لنفس صفحة القسم:
    1) /new-arrivals/c<ID>
    2) /new-arrivals/c<ID>?filters[category_id]=<ID>
  فيصير زر الرجوع يبقى داخل القسم بدل العودة للرئيسية (رجوع مرتين).

  الحل:
  نعترض history.pushState ونحوّل هذا الإدخال المكرّر تحديداً إلى
  replaceState (استبدال بدل إضافة) — بشرط دقيق لا يمسّ الفلترة الحقيقية:
    • نفس مسار الصفحة الحالية، و
    • المُعامل الوحيد هو filters[category_id]، و
    • قيمته = رقم القسم الموجود في مسار الرابط (/c<ID>).
  أي فلترة حقيقية (لون/مقاس/سعر) تحمل مُعاملات إضافية فلا ينطبق الشرط
  وتبقى تعمل طبيعياً (يزيدها في السجل ليعمل زر الرجوع لإزالتها).
*/

(function () {
  'use strict';
  if (window.__mlehaCategoryNavFix) return;
  window.__mlehaCategoryNavFix = true;

  var origPush = history.pushState;

  history.pushState = function (state, title, url) {
    try {
      if (url != null) {
        var next = new URL(url, location.href);
        var m = location.pathname.match(/\/c(\d+)(?=$|[/?])/);
        var cat = m && m[1];
        var params = next.searchParams;

        if (
          cat &&
          next.pathname === location.pathname &&
          params.get('filters[category_id]') === cat &&
          Array.from(params.keys()).length === 1
        ) {
          // إدخال مكرّر لنفس القسم => استبدل بدل الإضافة
          return history.replaceState(state, title, url);
        }
      }
    } catch (e) { /* تجاهل أي خطأ وتابع بالسلوك الأصلي */ }

    return origPush.apply(history, arguments);
  };
})();


/* ######################################################################
   FOUNDATION
   ###################################################################### */

/* =====================================
   1. UTILITIES & HELPERS
===================================== */

/**
 * دالة مساعدة لتشغيل الكود بعد تحميل DOM
 */
function onReady(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

/**
 * دالة مساعدة لإنشاء MutationObserver بسيط
 */
function observeDOM(callback, options = { childList: true, subtree: true }, target) {
  let observer = null;
  let frame = 0;
  let stopped = false;

  function schedule() {
    if (stopped || frame) return;
    const enqueue = window.requestAnimationFrame || (fn => window.setTimeout(fn, 16));
    frame = enqueue(() => {
      frame = 0;
      if (!stopped) callback();
    });
  }

  function connect() {
    if (stopped || observer) return;
    const root = typeof target === 'function' ? target() : target || document.body;
    if (!root) return;
    observer = new MutationObserver(schedule);
    observer.observe(root, options);
  }

  if (document.body) {
    connect();
  } else {
    document.addEventListener('DOMContentLoaded', connect, { once: true });
  }

  return {
    disconnect() {
      stopped = true;
      document.removeEventListener('DOMContentLoaded', connect);
      if (observer) observer.disconnect();
      if (frame && window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}


/* =====================================
   2. THEME & GLOBAL SETTINGS
===================================== */

// 2.1 لون شريط المتصفح (theme-color)
(function setThemeColor() {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', '#9d3d38');
})();

/* =====================================
   3. NAVBAR
===================================== */

/* MLEHA navbar — one idempotent scroll-state controller. */
(function initMlehaNavbar() {
  "use strict";

  const controllerKey = "__mlehaNavbarController";
  const previousController = window[controllerKey];

  if (previousController && typeof previousController.destroy === "function") {
    previousController.destroy();
  }

  const navbar = document.querySelector("#mainnav, .main-nav-container");
  if (!navbar) return;

  let framePending = false;

  function updateNavbarState() {
    navbar.classList.toggle("mleha-navbar-scrolled", window.scrollY > 50);
    framePending = false;
  }

  function handleScroll() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(updateNavbarState);
  }

  window.addEventListener("scroll", handleScroll, { passive: true });
  updateNavbarState();

  window[controllerKey] = {
    destroy() {
      window.removeEventListener("scroll", handleScroll);
      navbar.classList.remove("mleha-navbar-scrolled");
      framePending = false;
    },
  };
})();



/* ######################################################################
   HOME PAGE SECTIONS
   ###################################################################### */

/* =========================================
   ADVANCED SLIDER --2 ONLY
========================================= */

document.addEventListener("DOMContentLoaded", function () {
  const slides = document.querySelectorAll(
    "section.advanced-slider.advanced-slider--2 .advanced-slider__slide, section.advanced-slider.advanced-slider--4 .advanced-slider__slide"
  );

  slides.forEach(function (slide) {
    const link = slide.querySelector(".advanced-slider__caption a[href]");

    if (!link) return;

    const href = link.getAttribute("href");

    if (!href || href === "#") return;

    slide.style.cursor = "pointer";

    slide.addEventListener("click", function (event) {
      if (event.target.closest("a")) return;
      window.location.href = href;
    });
  });
});

/* =========================================
   ADVANCED SLIDER --2 ONLY
========================================= */


/* =====================================
   Twin Banners
===================================== */

window.addEventListener('load', function () {
  const sectionConfigs = [
    {
      selector: 'section.s-block--fixed-banner.double-banner--2',
      items: [
        {
          title: 'أحدث الإصدارات',
          text: 'تصاميم جديدة تم اختيارها بعناية.',
          link: 'اكتشفي الجديد'
        },
        {
          title: 'فساتين السهرة',
          text: 'نتميز عن الكل بفخامة الفساتين.',
          link: 'شاهدي التشكيلة'
        }
      ]
    },
    {
      selector: 'section.s-block--fixed-banner.double-banner--3',
      items: [
        {
          title: 'فساتين ناعمه',
          text: 'موديلات ناعمه وتخليكِ دايماً متميزه.',
          link: 'شاهدي التشكيلة'
        },
        {
          title: 'اوتلت مليحة',
          text: 'تصفية على آخر القطع بأسعار تبرد القلب.',
          link: 'تسوّقي الأوتلت'
        }
      ]
    }
  ];

  function injectMlehaDoubleBanners() {
    sectionConfigs.forEach(function (config) {
      const section = document.querySelector(config.selector);
      if (!section) return;

      const banners = section.querySelectorAll('a.banner');
      if (!banners.length) return;

      banners.forEach((banner, index) => {
        const item = config.items[index];
        if (!item || banner.querySelector('.mleha-banner-content')) return;

        const box = document.createElement('div');
        box.className = 'mleha-banner-content';

        const title = document.createElement('div');
        title.className = 'mleha-banner-title';
        title.textContent = item.title;

        const text = document.createElement('div');
        text.className = 'mleha-banner-text';
        text.textContent = item.text;

        const link = document.createElement('div');
        link.className = 'mleha-banner-link';
        link.textContent = item.link;

        box.appendChild(title);
        box.appendChild(text);
        box.appendChild(link);

        banner.appendChild(box);
      });
    });
  }

  injectMlehaDoubleBanners();

  const observer = new MutationObserver(function () {
    injectMlehaDoubleBanners();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  setTimeout(function () { observer.disconnect(); }, 10000);
});

/* =====================================
   Twin Banners
===================================== */


/* =====================================
   6. HOME PAGE / SECTIONS ENHANCEMENTS
===================================== */

// 6.1 إضافة أزرار "تصفح المزيد" تحت أقسام منتجات محددة
onReady(function addBrowseMoreButtons() {
  const swipers = [
    { id: 'featured-products-style2-2', link: '/ar/فساتين-سهرة/c86491111' },
    { id: 'featured-products-style2-6', link: '/ar/فساتين-نواعم/c1460461280' },
    { id: 'featured-products-style2-5', link: '/ar/جلابيات/c511204076' }
  ];

  swipers.forEach(swiper => {
    const section = document.getElementById(swiper.id);
    if (!section) return;

    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'text-align: center; margin-top: 30px;';

    const browseBtn = document.createElement('a');
    browseBtn.textContent = 'تصفح المزيد';
    browseBtn.href = swiper.link;
    browseBtn.style.cssText = `
      display: inline-block;
      padding: 8px 16px;
      background-color: #f1edeb;
      color: rgb(119, 119, 119);
      font-weight: var(--fw-bold);
      border-radius: 8px;
      text-decoration: none;
      font-size: var(--text-price);
      line-height: var(--lh-price);
      transition: 0.3s;
    `;
    browseBtn.addEventListener('mouseenter', () => browseBtn.style.opacity = '0.85');
    browseBtn.addEventListener('mouseleave', () => browseBtn.style.opacity = '1');

    btnWrapper.appendChild(browseBtn);
    section.appendChild(btnWrapper);
  });
});

// 6.2 شريط الترويج المتحرك (أعلى الصفحة)
(function promoTopBar() {
  const MESSAGES = [
    '🇸🇦✨ بمناسبة اليوم الوطني نتحدى الكل ✨🇸🇦',
    '👗 اختاري ٢ فساتين بـ ٩٥ ريال شامل الضريبة',
    '🚚 شحن مجاني لجميع الطلبات فوق ٣٩٩ ريال',
    '🎁 باكج فاخر هدية مع كل شحنة مجانية',
    '💚 ومو بس كذا… لك كود خصم خاص'
  ];
  const TOTAL_MS = 3500;
  const FADE_MS = 300;
  const HOLD_MS = TOTAL_MS - FADE_MS;
  const FIXED = true;

  onReady(() => {
    const style = document.createElement('style');
    style.textContent = `
      #promo-topbar {
        display: none;
        position: ${FIXED ? 'fixed' : 'sticky'};
        top: 0; left: 0; right: 0;
        z-index: 30;
        background: #9d3d38;
        color: #fff;
        text-align: center;
        padding: .6rem .8rem;
        font-size: var(--text-body);
        line-height: var(--lh-body);
        font-weight: var(--fw-bold);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        ${FIXED ? 'width: 100%;' : ''}
      }
      #promo-topbar .promo-text {
        opacity: 0;
        transition: opacity ${FADE_MS}ms ease;
        display: inline-block;
      }
      #promo-topbar .promo-text.show { opacity: 1; }
      @media (prefers-reduced-motion: reduce) {
        #promo-topbar .promo-text { transition: none; }
      }
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'promo-topbar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('dir', 'rtl');

    const span = document.createElement('span');
    span.className = 'promo-text';
    bar.appendChild(span);

    document.body.prepend(bar);

    if (FIXED) {
      requestAnimationFrame(() => {
        const h = bar.getBoundingClientRect().height;
        document.body.style.paddingTop = (parseFloat(getComputedStyle(document.body).paddingTop || '0') + h) + 'px';
      });
    }

    let i = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function cycle() {
      span.textContent = MESSAGES[i];
      if (!reduceMotion) {
        span.classList.add('show');
        setTimeout(() => {
          span.classList.remove('show');
          setTimeout(() => {
            i = (i + 1) % MESSAGES.length;
            cycle();
          }, FADE_MS);
        }, HOLD_MS);
      } else {
        span.classList.add('show');
        setTimeout(() => {
          i = (i + 1) % MESSAGES.length;
          cycle();
        }, TOTAL_MS);
      }
    }
    cycle();
  });
})();

// 6.3 إبقاء أول عنصر فقط في قسم animated-text
(function keepFirstAnimatedTextOnly() {
  function clean() {
    document.querySelectorAll('section.animated-text .animated-text__inner ul').forEach(ul => {
      const items = Array.from(ul.children).filter(item => item.tagName === 'LI');
      if (!items.length) return;

      // Removing/re-appending the first item on every observer callback created
      // an infinite MutationObserver feedback loop. Only remove actual extras.
      items.slice(1).forEach(item => item.remove());
      if (items[0].style.display !== 'block') items[0].style.display = 'block';
    });
  }
  onReady(clean);
  const observer = observeDOM(clean);
  setTimeout(() => observer.disconnect(), 10000);
})();


/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================

   mleha-best-sellers

========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

(function () {
  function applyBestSelling(selector) {
    const slider = document.querySelector(selector);
    if (!slider) return;
    if (slider.getAttribute('source') === 'best_selling') return;

    slider.setAttribute('source', 'best_selling');
    slider.removeAttribute('source-value');
    slider.removeAttribute('includes');
  }

  function run() {
    /* صفحة السلة — قسم "قد يعجبك أيضاً" */
    if (window.location.pathname.includes('/cart')) {
      applyBestSelling('salla-products-slider[block-title*="يعجبك"]');
    }

    /* صفحة المنتج — قسم "عادة ما يتم شراؤه مع" */
    applyBestSelling('salla-products-slider[block-title*="يتم شراؤه"]');
  }

  /* تشغيل فوري */
  if (document.readyState !== 'loading') {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }

  /* MutationObserver لأي مكوّن يتحمّل بعد الصفحة */
  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(function () { observer.disconnect(); }, 6000);

})();




/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
  MLEHA — Videos Gallery Section
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
======================================== */

(function initVideosGallery() {
  function setup() {
    const section = document.querySelector('.s-block--videos-gallery');
    if (!section || section.dataset.vgReady) return;

    const relDiv = section.querySelector('.relative.overflow-hidden');
    const clip   = relDiv && relDiv.querySelector('.mx-auto.container');
    if (!clip) return;
    section.dataset.vgReady = '1';

    const CLOSED_H = 150;
    const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const DUR  = 780;

    section.querySelectorAll('.enhanced-title-border, .home-block-line')
      .forEach(el => el.style.display = 'none');

    clip.classList.add('vg-clip');

    // طبقة البلور — مستقلة عن vg-fade حتى تتحرك بـ backdrop-filter
    const blurEl = document.createElement('div');
    blurEl.className = 'vg-blur';
    clip.appendChild(blurEl);

    // طبقة التغطية: تدرّج لوني + زر "مشاهدة الكواليس"
    const fade = document.createElement('div');
    fade.className = 'vg-fade';
    fade.innerHTML = '<div class="vg-tint"></div>';
    const openBtn = document.createElement('button');
    openBtn.className = 'vg-btn';
    openBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>مشاهدة الكواليس';
    fade.appendChild(openBtn);
    clip.appendChild(fade);

    const bottomWrap = document.createElement('div');
    bottomWrap.className = 'vg-btn-bottom';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'vg-btn';
    closeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>اخفاء الكواليس';
    bottomWrap.appendChild(closeBtn);
    clip.appendChild(bottomWrap);

    function ensurePlaying() {
      section.querySelectorAll('video').forEach(v => {
        v.muted = true;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      });
    }

    section.classList.add('vg-closed');
    clip.style.height = CLOSED_H + 'px';

    let busy = false;

    function openIt() {
      if (busy) return; busy = true;
      section.classList.add('vg-animating');
      section.classList.remove('vg-closed');
      clip.style.height = CLOSED_H + 'px';
      const full = clip.scrollHeight;
      clip.style.transition = 'height ' + DUR + 'ms ' + EASE;
      requestAnimationFrame(() => { clip.style.height = full + 'px'; });
      const done = (e) => {
        if (e.propertyName !== 'height') return;
        clip.removeEventListener('transitionend', done);
        clip.style.height = 'auto';
        clip.style.transition = '';
        section.classList.remove('vg-animating');
        busy = false;
        ensurePlaying();
      };
      clip.addEventListener('transitionend', done);
    }

    function closeIt() {
      if (busy) return; busy = true;
      const cur = clip.scrollHeight;
      clip.style.height = cur + 'px';
      clip.offsetHeight; // force reflow before transition
      clip.style.transition = 'height ' + DUR + 'ms ' + EASE;
      section.classList.add('vg-closed');
      requestAnimationFrame(() => { clip.style.height = CLOSED_H + 'px'; });
      const done = (e) => {
        if (e.propertyName !== 'height') return;
        clip.removeEventListener('transitionend', done);
        clip.style.transition = '';
        busy = false;
        ensurePlaying();
        setTimeout(ensurePlaying, 500);
      };
      clip.addEventListener('transitionend', done);
    }

    openBtn.addEventListener('click', openIt);
    closeBtn.addEventListener('click', closeIt);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
  // السلايدر يُبنى بشكل متأخر في Salla
  setTimeout(setup, 1500);
  setTimeout(setup, 3000);
})();


/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
   MLEHA — PRODUCT SLIDER (SALLA INTEGRATION)
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

/*
  يستبدل معرض صور المنتج في ثيم Salla بسلايدر MLEHA:
  - لوب لا نهائي سلس بنفس الاتجاه
  - الصورة الأولى بعرض كامل أثناء نشاطها ثم تنضم بعرضها الطبيعي لبقية الصور
  - full-bleed بعرض 100vw من أعلى الصفحة
  تم اختباره حيًّا على صفحة منتج mleha.com.
*/

(function () {
  if (!isMlehaProductPage()) return;
  let initialized = false;
  let retryTimer = 0;

  function initProductSlider() {
    if (initialized) return true;
    if (!document.body.classList.contains("product-single")) return true;
  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     1. جلب صور المنتج من معرض Salla
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  const wrap = document.querySelector("body.product-single .s-slider-wrapper");
  if (!wrap) return false;

  wrap.classList.add("ps-pending");

  const mainSlider = wrap.querySelector(".s-slider-container");
  const injectedSlider = wrap.querySelector("[data-product-slider]");
  const imageScope = mainSlider || injectedSlider;
  if (!imageScope) return false;
  const seen = new Set();
  const IMGS = [];
  const imageSelector = mainSlider ? ".swiper-slide img" : ".ps-slide[data-real] .ps-image";
  imageScope.querySelectorAll(imageSelector).forEach((im) => {
    const src = (im.currentSrc || im.src || "").split("?")[0];
    if (src && !seen.has(src)) {
      seen.add(src);
      IMGS.push(src);
    }
  });
  if (IMGS.length === 0) return false;

  initialized = true;

  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     2. حقن أنماط السلايدر
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  const CSS = `
.ps-inj *{box-sizing:border-box}
.ps-inj{--ps-ease:cubic-bezier(.5,0,0,1);--ps-bg:#FAFAFA;--ps-surface:rgba(20,20,20,.42);--ps-white:#fff;}
.ps-carousel{position:relative;direction:ltr;display:grid;grid-template-rows:minmax(0,1fr);justify-items:center;width:100%;height:clamp(380px, min(68vh, 128vw), 540px);height:clamp(380px, min(68svh, 128vw), 540px);overflow:hidden;background:var(--ps-bg);touch-action:pan-y;user-select:none}
.ps-track{display:flex;gap:0;width:100%;height:100%;transition:transform .8s var(--ps-ease);will-change:transform}
.ps-track.is-dragging{transition:none;cursor:grabbing}
.ps-slide{flex:0 0 var(--slide-size,100%);width:var(--slide-size,100%);height:100%;margin:0;background:var(--slide-bg,var(--ps-bg));transform:translateZ(0)}
.ps-slide.is-full-width{transition:flex-basis .8s var(--ps-ease),width .8s var(--ps-ease)}
.ps-track.is-dragging .ps-slide.is-full-width{transition:none}
.ps-zoom-hit{all:unset;position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;cursor:grab;overflow:hidden}
.ps-image-frame{position:relative;display:block;flex:0 0 100%;width:100%;height:100%;max-width:100%}
.ps-track.is-dragging .ps-zoom-hit{cursor:grabbing}
.ps-image{display:block;width:100%;max-width:100%;height:100%;object-fit:contain;pointer-events:none}
.ps-carousel,.ps-track,.ps-slide,.ps-zoom-hit,.ps-image{border-radius:0!important}
.product-single salla-slider img.ps-image{border-radius:0!important}
.ps-widget{position:absolute;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;pointer-events:none;z-index:2}
.ps-arrow{position:relative;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--ps-white);cursor:pointer;pointer-events:auto}
.ps-arrow::before{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--ps-surface);backdrop-filter:blur(10px);transition:transform .8s var(--ps-ease)}
.ps-arrow:hover::before{transform:scale(.8)}
.ps-arrow span{position:relative;z-index:1;line-height:1}
.ps-thumbs{all:unset;display:flex;gap:2px;max-width:300px;padding:2px;overflow:hidden;border-radius:4px;background:var(--ps-surface);backdrop-filter:blur(10px);pointer-events:auto}
.ps-thumbs li{display:flex;list-style:none}
.ps-thumb{all:unset;position:relative;width:24px;height:28px;cursor:pointer;transition:width .8s var(--ps-ease)}
.ps-thumb:hover,.ps-thumb.is-active{width:28px}
.ps-thumb-frame{display:block;position:relative;width:100%;height:100%;overflow:hidden;border-radius:2px}
.ps-thumb img{display:block;width:100%;height:100%;object-fit:cover;opacity:.5;transition:opacity .8s var(--ps-ease)}
.ps-thumb:hover img,.ps-thumb.is-active img{opacity:1}
.ps-counter{position:absolute;left:16px;bottom:16px;margin:0;min-width:52px;padding:7px 10px;border-radius:4px;background:var(--ps-surface);color:#fff;font-size:12px;line-height:1;text-align:center;backdrop-filter:blur(10px);z-index:2}
@media (max-width:1023px){.ps-thumbs{display:none}.ps-image-frame{display:flex;align-items:center;justify-content:center}.ps-image{width:100%;height:auto;max-height:100%;object-fit:contain}}
@media (min-width:391px){.ps-carousel{height:clamp(420px, min(72vh, 128vw), 620px);height:clamp(420px, min(72svh, 128vw), 620px)}}
@media (min-width:768px){.ps-carousel{height:clamp(480px, min(68vh, 88vw), 680px);height:clamp(480px, min(68svh, 88vw), 680px)}}
@media (min-width:1024px){.ps-carousel{height:clamp(540px, min(74vh, 72vw), 760px);height:clamp(540px, min(74svh, 72vw), 760px)}}
@media (min-width:1280px){.ps-carousel{height:clamp(600px, min(78vh, 62vw), 900px);height:clamp(600px, min(78svh, 62vw), 900px)}}
`;
  let st = document.getElementById("ps-inj-style");
  if (!st) {
    st = document.createElement("style");
    st.id = "ps-inj-style";
    document.head.appendChild(st);
  }
  st.textContent = CSS;

  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     3. بناء ماركب السلايدر
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  wrap.classList.remove("ps-pending");
  wrap.classList.add("ps-inj");
  wrap.innerHTML = `
<section class="ps-carousel" data-product-slider>
  <div class="ps-track" data-slider-track></div>
  <div class="ps-widget">
    <button class="ps-arrow" type="button" data-slider-prev aria-label="السابق"><span>&lsaquo;</span></button>
    <button class="ps-arrow" type="button" data-slider-next aria-label="التالي"><span>&rsaquo;</span></button>
    <ul class="ps-thumbs" data-slider-thumbs></ul>
  </div>
  <p class="ps-counter" data-slider-counter>1 / ${IMGS.length}</p>
</section>`;

  const slides = IMGS.map((src, i) => ({ src, thumb: src, alt: "صورة المنتج " + (i + 1) }));
  const root = wrap.querySelector("[data-product-slider]");
  const track = root.querySelector("[data-slider-track]");
  const thumbsEl = root.querySelector("[data-slider-thumbs]");
  const counter = root.querySelector("[data-slider-counter]");
  const prevBtn = root.querySelector("[data-slider-prev]");
  const nextBtn = root.querySelector("[data-slider-next]");
  const count = slides.length;
  const COPIES = 3;
  const baseUnit = count;
  let activeIndex = 0;
  let unit = baseUnit;
  let widths = [];
  let offsets = [];
  let viewportWidth = 0;
  let isDesktopView = false;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  let pendingRebase = false;
  let resizeFrame = 0;
  const nextI = (i) => (i + 1) % count;
  const prevI = (i) => (i - 1 + count) % count;
  function getNaturalAspectHeight({ width, naturalWidth, naturalHeight }) {
    const values = [Number(width), Number(naturalWidth), Number(naturalHeight)];
    if (!values.every(Number.isFinite) || values.some((value) => value <= 0)) return null;
    return Math.round((values[0] * values[2] / values[1]) * 100) / 100;
  }
  function getNaturalAspectWidth({ height, naturalWidth, naturalHeight }) {
    const values = [Number(height), Number(naturalWidth), Number(naturalHeight)];
    if (!values.every(Number.isFinite) || values.some((value) => value <= 0)) return null;
    return Math.round((values[0] * values[1] / values[2]) * 100) / 100;
  }

  const items = [];
  for (let c = 0; c < COPIES; c += 1) slides.forEach((s, i) => items.push({ ...s, realIndex: i }));
  track.innerHTML = items
    .map((s, pos) => `<article class="ps-slide${s.realIndex === 0 ? " is-full-width" : ""}" data-pos="${pos}" data-real="${s.realIndex}"><button class="ps-zoom-hit" type="button"><span class="ps-image-frame"><img class="ps-image" src="${s.src}" alt="${s.alt}" draggable="false"></span></button></article>`)
    .join("");
  track.querySelectorAll(".ps-image").forEach((image) => {
    if (!image.complete) image.addEventListener("load", refreshLayout, { once: true });
  });
  thumbsEl.innerHTML = slides
    .map((s, i) => `<li><button class="ps-thumb" type="button" data-thumb="${i}"><span class="ps-thumb-frame"><img src="${s.thumb}" alt="" draggable="false"></span></button></li>`)
    .join("");
  thumbsEl.querySelectorAll("[data-thumb]").forEach((b) =>
    b.addEventListener("click", () => {
      activeIndex = Number(b.dataset.thumb);
      unit = baseUnit + activeIndex;
      update(true);
    })
  );

  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     4. منطق اللوب اللانهائي + العرض الديناميكي
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  function measure() {
    isDesktopView = window.matchMedia("(min-width:1024px)").matches;
    viewportWidth = root.clientWidth;
  }
  function computeLayout() {
    const desktopMaxWidth = viewportWidth / 2;
    const fallbackWidth = Math.min(desktopMaxWidth, root.clientHeight * 0.667);
    const rw = slides.map((slide, index) => {
      if (!isDesktopView) return viewportWidth;
      if (index === 0 && activeIndex === 0) return viewportWidth;
      const image = track.querySelector(`[data-pos="${baseUnit + index}"] .ps-image`);
      const naturalWidth = image
        ? getNaturalAspectWidth({
            height: root.clientHeight,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          })
        : null;
      return Math.min(desktopMaxWidth, naturalWidth ?? fallbackWidth);
    });
    widths = [];
    for (let c = 0; c < COPIES; c += 1) widths.push(...rw);
    offsets = [0];
    for (let p = 0; p < widths.length; p += 1) offsets.push(offsets[p] + widths[p]);
  }
  function baseOffset() {
    const copyStart = offsets[unit - activeIndex];
    const endAligned = offsets[unit + 1] - viewportWidth;
    return Math.max(copyStart, endAligned);
  }
  function update(animate) {
    syncMobileCarouselHeight();
    computeLayout();
    track.classList.toggle("is-dragging", !animate);
    track.style.transform = "translate3d(" + -baseOffset() + "px,0,0)";
    track.querySelectorAll(".ps-slide").forEach((sl) => {
      const p = Number(sl.dataset.pos);
      sl.style.setProperty("--slide-size", widths[p] + "px");
      sl.classList.toggle("is-active", p === unit);
    });
    thumbsEl.querySelectorAll("[data-thumb]").forEach((t, i) => {
      const a = i === activeIndex;
      t.classList.toggle("is-active", a);
      t.disabled = a;
    });
    counter.textContent = activeIndex + 1 + " / " + count;
    if (!animate) rebase();
    else pendingRebase = true;
  }
  function step(d) {
    activeIndex = d > 0 ? nextI(activeIndex) : prevI(activeIndex);
    unit += d;
    update(true);
  }
  function rebase() {
    let r = false;
    if (unit >= baseUnit + count) {
      unit -= count;
      r = true;
    } else if (unit < baseUnit) {
      unit += count;
      r = true;
    }
    if (r) {
      track.classList.add("is-dragging");
      track.style.transform = "translate3d(" + -baseOffset() + "px,0,0)";
      track.querySelectorAll(".ps-slide").forEach((sl) => sl.classList.toggle("is-active", Number(sl.dataset.pos) === unit));
      void track.offsetWidth;
      track.classList.remove("is-dragging");
    }
  }

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  function refreshLayout() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      measure();
      update(false);
    });
  }
  function syncMobileCarouselHeight() {
    if (isDesktopView) {
      root.style.removeProperty("height");
      return;
    }

    const image = track.querySelector(".ps-image");
    if (!image?.naturalWidth || !image.naturalHeight) {
      if (image && image.dataset.heightObserved !== "true") {
        image.dataset.heightObserved = "true";
        image.addEventListener("load", refreshLayout, { once: true });
      }
      return;
    }

    const height = getNaturalAspectHeight({
      width: viewportWidth,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
    if (height === null) return;

    const nextHeight = height + "px";
    if (root.style.height !== nextHeight) root.style.height = nextHeight;
  }
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(refreshLayout);
    resizeObserver.observe(root);
  } else {
    window.addEventListener("resize", refreshLayout, { passive: true });
  }
  track.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform" || !pendingRebase) return;
    pendingRebase = false;
    rebase();
  });
  track.addEventListener("pointerdown", (e) => {
    isDragging = true;
    startX = currentX = e.clientX;
    track.setPointerCapture(e.pointerId);
    track.classList.add("is-dragging");
  });
  track.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    track.style.transform = "translate3d(" + (currentX - startX - baseOffset()) + "px,0,0)";
  });
  const up = () => {
    if (!isDragging) return;
    const dx = currentX - startX;
    isDragging = false;
    track.classList.remove("is-dragging");
    const th = Math.min(90, root.clientWidth * 0.08);
    if (Math.abs(dx) < th) update(true);
    else if (dx < 0) step(1);
    else step(-1);
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  track.addEventListener("lostpointercapture", up);

  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     5. تخطيط full-bleed (100vw)
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  // كدّس عمود السلايدر أعلى وعمود البيانات تحته بكامل العرض
  let sliderCol = wrap;
  for (let i = 0; i < 5; i += 1) sliderCol = sliderCol.parentElement;
  const row = sliderCol.parentElement;
  row.style.setProperty("flex-direction", "column", "important");
  row.style.setProperty("flex-wrap", "nowrap", "important");
  row.style.setProperty("align-items", "stretch", "important");

  // كامل السلسلة من wrap حتى عمود السلايدر = عرض 100% وبلا قصّ/حشوة أفقية
  let el = wrap;
  while (el) {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("flex-basis", "auto", "important");
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("overflow-x", "visible", "important");
    el.style.setProperty("padding-left", "0", "important");
    el.style.setProperty("padding-right", "0", "important");
    if (el === sliderCol) break;
    el = el.parentElement;
  }
  [...row.children].forEach((ch) => {
    if (ch !== sliderCol) {
      ch.style.setProperty("width", "100%", "important");
      ch.style.setProperty("max-width", "100%", "important");
      ch.style.setProperty("flex-basis", "auto", "important");
    }
  });

  // ألغِ الحشوة العلوية على حاوية السلايدر ليلامس أعلى الصفحة
  wrap.style.setProperty("padding-top", "0", "important");
  wrap.style.setProperty("padding-bottom", "0", "important");
  wrap.style.setProperty("margin-top", "0", "important");
  const mainMedia = wrap.closest(".product-single__main-media");
  mainMedia?.style.setProperty("margin-top", "0", "important");
  sliderCol.style.setProperty("position", "static", "important");
  sliderCol.style.setProperty("top", "auto", "important");
  sliderCol.style.setProperty("margin-bottom", "24px", "important");

  // full-bleed 100vw
  const car = wrap.querySelector(".ps-carousel");
  car.style.setProperty("width", "100vw", "important");
  car.style.setProperty("max-width", "100vw", "important");
  car.style.setProperty("margin-left", "calc(50% - 50vw)", "important");
  car.style.setProperty("margin-right", "calc(50% - 50vw)", "important");
  car.style.setProperty("border-radius", "0", "important");

  measure();
  update(false);

  /* =====================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
     6. تكبير الصورة في مكانها عند النقر (زوم داخلي)
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ========================================
  ===================================== */
  // نقرة على الصورة = تقريب عند نقطة الضغط، نقرة ثانية = إبعاد. بدون نافذة منفصلة.
  const zst = document.createElement("style");
  zst.id = "ps-inzoom-style";
  zst.textContent = `.ps-image{transition:transform .4s cubic-bezier(.5,0,0,1)}
.ps-zoom-hit{cursor:zoom-in}
.ps-slide.is-zoomed .ps-zoom-hit{cursor:zoom-out}
.ps-slide.is-zoomed .ps-image{transition:transform .12s ease-out}`;
  document.head.appendChild(zst);

  const ZOOM = 2.4;
  let zoomImg = null;
  let zoomSlide = null;

  function zoomOut() {
    if (zoomImg) {
      zoomImg.style.transform = "scale(1)";
      zoomSlide.classList.remove("is-zoomed");
      zoomImg = null;
      zoomSlide = null;
    }
  }
  // نحسب نقطة الأصل من حاوية السلايد (غير المكبّرة) لا من الصورة المكبّرة،
  // وإلا ستكون القيم غير صحيحة والصورة لا تتحرك مع الماوس.
  function setOrigin(cx, cy) {
    if (!zoomImg || !zoomSlide) return;
    const r = zoomSlide.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((cx - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((cy - r.top) / r.height) * 100));
    zoomImg.style.transformOrigin = x + "% " + y + "%";
  }
  function toggleZoom(im, slide, cx, cy) {
    if (zoomImg === im) { zoomOut(); return; }
    zoomOut();
    zoomImg = im;
    zoomSlide = slide;
    slide.classList.add("is-zoomed");
    setOrigin(cx, cy);
    im.style.transform = "scale(" + ZOOM + ")";
  }

  // ملاحظة: لا يوجد تحريك (pan) مع الماوس — الصورة تبقى ثابتة عند نقطة التكبير.

  // كشف النقر (بدون سحب). السلايدر يستدعي setPointerCapture فيصبح هدف pointerup هو الـ track،
  // لذلك نستخدم elementFromPoint بالإحداثيات لإيجاد الصورة الفعلية تحت المؤشر.
  let dx0 = 0;
  let dy0 = 0;
  let moved = false;
  track.addEventListener("pointerdown", (e) => { dx0 = e.clientX; dy0 = e.clientY; moved = false; }, true);
  track.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - dx0) > 6 || Math.abs(e.clientY - dy0) > 6) moved = true; }, true);
  track.addEventListener("pointerup", (e) => {
    if (moved) { zoomOut(); return; } // السحب يلغي التكبير
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slide = el && el.closest && el.closest(".ps-slide");
    const im = slide && slide.querySelector("img");
    if (im) toggleZoom(im, slide, e.clientX, e.clientY);
  }, true);

  // إلغاء التكبير عند استخدام الأسهم/المصغّرات
  [prevBtn, nextBtn].forEach((b) => b.addEventListener("click", zoomOut));
  thumbsEl.querySelectorAll("[data-thumb]").forEach((b) => b.addEventListener("click", zoomOut));
  return true;
  }

  function startProductSlider() {
    if (initProductSlider()) return;
    if (retryTimer) return;
    let attempts = 0;
    retryTimer = setInterval(function () {
      attempts += 1;
      if (initProductSlider() || attempts >= 80) {
        clearInterval(retryTimer);
        retryTimer = 0;
      }
    }, 250);
  }

  startProductSlider();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startProductSlider, { once: true });
  }
  document.addEventListener("salla::ready", startProductSlider);
})();

/* ######################################################################
   PRODUCT PAGE
   ###################################################################### */

/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
  MLEHA — Product Page
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

/* ════════════════════════════════════════
   0. دوال مساعدة مشتركة (Utilities & Helpers)
   ═══════════════════════════════════════ */

if (isMlehaProductPage()) {

/* ═══════════════════════════════════════════════════════════
   1. تنسيق أزرار الدفع السريع
   ═══════════════════════════════════════════════════════════ */

function styleFastCheckoutButtons() {
  document.querySelectorAll('.s-fast-checkout-button').forEach(btn => {
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.fontSize = 'var(--text-label)';
    btn.style.fontWeight = 'var(--fw-bold)';
    btn.style.lineHeight = 'var(--lh-label)';
  });
}


/* ═══════════════════════════════════════════════════════════
   2. تنسيق زر Apple Pay داخل الـ Shadow DOM
   ═══════════════════════════════════════════════════════════ */

onReady(function styleApplePayButton() {
  const widget = document.querySelector('salla-mini-checkout-widget');
  if (widget && widget.shadowRoot) {
    const button = widget.shadowRoot.querySelector('button');
    if (button) {
      button.style.border = 'none';
      button.style.borderRadius = '8px';
      button.style.fontSize = 'var(--text-label)';
      button.style.fontWeight = 'var(--fw-bold)';
      button.style.lineHeight = 'var(--lh-label)';
    }
  }
  styleFastCheckoutButtons();
});


/* ═══════════════════════════════════════════════════════════
   3. قفل الطلب المسبق — يشترط كتابة "اوافق" للشراء (منتج محدد)
   ═══════════════════════════════════════════════════════════ */

if (location.pathname === '/ar/oZEXQmz') {
  (function preorderConsentLock() {
    const style = document.createElement('style');
    style.textContent = `
      .product-entry__sub-title {
        margin: 20px 0 0 0 !important;
        color: red !important;
      }
      .preorder-locked,
      .preorder-locked * { pointer-events: none !important; }
      .preorder-locked button,
      .preorder-locked [role="button"] { opacity: .5 !important; }
    `;
    document.head.appendChild(style);

    const h2 = document.querySelector('h2.product-entry__sub-title');
    if (!h2) return;

    if (!document.getElementById('preorder-consent-input')) {
      const consentWrapper = document.createElement('div');
      consentWrapper.dir = 'rtl';
      consentWrapper.style.margin = '10px 0 16px';
      consentWrapper.innerHTML = `
        <label for="preorder-consent-input" style="display:block; font-size:var(--text-label); font-weight:var(--fw-regular); line-height:var(--lh-label); color:var(--color-text-secondary,#555); margin-bottom:6px;">
          لتأكيد الطلب المسبق، اكتب <strong>اوافق</strong> في الحقل التالي:
        </label>
        <input id="preorder-consent-input" type="text" inputmode="text"
          placeholder="اكتب اوافق لإكمال الطلب"
          style="width:100%;max-width:420px;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:var(--text-body);font-weight:var(--fw-regular);line-height:var(--lh-body);outline:none;"
        />
      `;
      h2.insertAdjacentElement('afterend', consentWrapper);
    }

    const input = document.getElementById('preorder-consent-input');
    const containerSelector = '.s-add-product-button-main';
    let consentOK = false;

    function getContainer() { return document.querySelector(containerSelector); }

    function hardLock() {
      const container = getContainer();
      if (!container) return;
      container.classList.add('preorder-locked');
      container.querySelectorAll('button, [role="button"]').forEach(b => {
        b.setAttribute('disabled', 'disabled');
        b.setAttribute('aria-disabled', 'true');
      });
    }

    function unlock() {
      consentOK = true;
      const container = getContainer();
      if (!container) return;
      container.classList.remove('preorder-locked');
      container.querySelectorAll('button, [role="button"]').forEach(b => {
        b.removeAttribute('disabled');
        b.setAttribute('aria-disabled', 'false');
        b.style.pointerEvents = '';
        b.style.opacity = '';
      });
    }

    hardLock();
    observeDOM(() => { if (!consentOK) hardLock(); });
    const watchdog = setInterval(() => { if (!consentOK) hardLock(); }, 300);

    function checkConsent() {
      const val = (input.value || '').trim();
      if (val === 'اوافق') {
        unlock();
        clearInterval(watchdog);
      } else {
        consentOK = false;
        hardLock();
      }
    }
    ['input', 'change', 'paste'].forEach(evt => input.addEventListener(evt, checkConsent, { passive: true }));
  })();
}


/* ═══════════════════════════════════════════════════════════
   4. فصل اسم العميل والمدينة في تقييمات المنتج
   ═══════════════════════════════════════════════════════════ */

onReady(function formatReviewNames() {
  document.querySelectorAll('.s-block--custom-reviews h4').forEach(el => {
    if (el.textContent.includes(' - ')) {
      const [name, city] = el.textContent.split(' - ');
      el.innerHTML = `<span class="review-name">${name}</span><span class="review-city">${city}</span>`;
    }
  });
});


/* ═══════════════════════════════════════════════════════════
   5. إضافة أيقونات السوشيال ميديا في صفحة المنتج
   ═══════════════════════════════════════════════════════════ */

onReady(function addSocialMediaIcons() {
  const socialLinks = [
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/mleha.sa/',
      svg: `<svg fill="#000000" width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M20.445 5h-8.891A6.559 6.559 0 0 0 5 11.554v8.891A6.559 6.559 0 0 0 11.554 27h8.891a6.56 6.56 0 0 0 6.554-6.555v-8.891A6.557 6.557 0 0 0 20.445 5zm4.342 15.445a4.343 4.343 0 0 1-4.342 4.342h-8.891a4.341 4.341 0 0 1-4.341-4.342v-8.891a4.34 4.34 0 0 1 4.341-4.341h8.891a4.342 4.342 0 0 1 4.341 4.341l.001 8.891z"/><path d="M16 10.312c-3.138 0-5.688 2.551-5.688 5.688s2.551 5.688 5.688 5.688 5.688-2.551 5.688-5.688-2.55-5.688-5.688-5.688zm0 9.163a3.475 3.475 0 1 1-.001-6.95 3.475 3.475 0 0 1 .001 6.95zM21.7 8.991a1.363 1.363 0 1 1-1.364 1.364c0-.752.51-1.364 1.364-1.364z"/></svg>`
    },
    {
      name: 'Snapchat',
      url: 'https://www.snapchat.com/add/mleha.sa',
      svg: `<svg fill="#ffffff" width="32px" height="32px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><title>snapchat</title><path d="M16.257 1.995c0.029-0 0.064-0.001 0.099-0.001 3.249 0 6.044 1.94 7.291 4.725l0.020 0.051c0.333 1.18 0.524 2.534 0.524 3.934 0 0.749-0.055 1.485-0.161 2.205l0.010-0.082-0.004 0.075c-0.015 0.225-0.027 0.431-0.037 0.637 0.132 0.072 0.289 0.114 0.456 0.114 0.016 0 0.032-0 0.048-0.001l-0.002 0c0.478-0.045 0.916-0.179 1.31-0.385l-0.019 0.009c0.162-0.082 0.352-0.13 0.554-0.13 0.009 0 0.018 0 0.027 0l-0.001-0c0.008-0 0.017-0 0.026-0 0.219 0 0.429 0.041 0.622 0.117l-0.012-0.004c0.496 0.117 0.868 0.532 0.917 1.042l0 0.005q0.028 0.842-1.516 1.46c-0.111 0.036-0.261 0.094-0.43 0.149-0.562 0.169-1.423 0.45-1.666 1.012-0.036 0.114-0.056 0.244-0.056 0.38 0 0.262 0.077 0.506 0.209 0.71l-0.003-0.005 0.019 0.019c1.117 2.493 3.286 4.344 5.926 5.003l0.061 0.013c0.299 0.049 0.525 0.306 0.525 0.616 0 0.007-0 0.014-0 0.021l0-0.001c-0.001 0.102-0.021 0.198-0.058 0.286l0.002-0.005c-0.3 0.711-1.591 1.235-3.931 1.588-0.087 0.204-0.158 0.444-0.202 0.692l-0.003 0.020c-0.046 0.268-0.104 0.501-0.177 0.727l0.010-0.036c-0.069 0.293-0.329 0.508-0.638 0.508-0.019 0-0.039-0.001-0.058-0.003l0.002 0h-0.037c-0.246-0.013-0.476-0.046-0.699-0.098l0.027 0.005c-0.477-0.107-1.024-0.169-1.586-0.169-0.002 0-0.003 0-0.005 0h0c-0.024-0-0.053-0.001-0.082-0.001-0.374 0-0.74 0.034-1.096 0.099l0.037-0.006c-0.83 0.222-1.551 0.603-2.162 1.112l0.009-0.007c-1.108 0.944-2.536 1.541-4.102 1.609l-0.014 0c-0.075 0-0.149-0.019-0.225-0.019h-0.186c-1.575-0.060-3-0.659-4.106-1.617l0.008 0.007c-0.596-0.501-1.311-0.882-2.094-1.096l-0.039-0.009c-0.346-0.055-0.747-0.089-1.156-0.092l-0.004-0c-0.568 0.008-1.115 0.076-1.642 0.196l0.053-0.010c-0.199 0.049-0.43 0.082-0.667 0.092l-0.007 0c-0.016 0.001-0.034 0.002-0.052 0.002-0.325 0-0.597-0.222-0.675-0.522l-0.001-0.005c-0.076-0.24-0.112-0.486-0.169-0.709-0.047-0.269-0.119-0.508-0.216-0.734l0.008 0.022c-2.397-0.277-3.686-0.802-3.985-1.513l-0.006-0.016c-0.034-0.083-0.054-0.179-0.054-0.279 0-0.306 0.221-0.561 0.512-0.613l0.004-0.001c2.64-0.659 4.809-2.51 5.913-4.972l0.024-0.059 0.019-0.019c0.132-0.199 0.209-0.443 0.209-0.705 0-0.136-0.021-0.267-0.059-0.39l0.002 0.009c-0.243-0.562-1.104-0.843-1.666-1.012-0.176-0.057-0.327-0.115-0.472-0.162l-0.051-0.019c-1.043-0.431-1.516-0.899-1.488-1.478 0.050-0.51 0.422-0.924 0.908-1.036l0.009-0.002c0.181-0.072 0.39-0.113 0.609-0.113 0.009 0 0.018 0 0.027 0l-0.001-0c0.202 0 0.392 0.048 0.561 0.133l-0.007-0.003c0.388 0.198 0.826 0.332 1.291 0.377l0.019 0.001c0.016 0.001 0.032 0.001 0.048 0.001 0.167 0 0.324-0.042 0.462-0.116l-0.006 0.003c-0.012-0.206-0.023-0.411-0.037-0.637l-0.004-0.075c-0.096-0.638-0.151-1.374-0.151-2.123 0-1.4 0.192-2.754 0.551-4.038l-0.026 0.104c1.228-2.836 4.023-4.776 7.272-4.776 0.035 0 0.070 0 0.105 0.001l-0.005-0z"></path></svg>`
    },
    {
      name: 'TikTok',
      url: 'https://www.tiktok.com/@mleha.sa',
      svg: `<svg fill="#ffffff" width="32px" height="32px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><title>tiktok</title><path d="M16.656 1.029c1.637-0.025 3.262-0.012 4.886-0.025 0.054 2.031 0.878 3.859 2.189 5.213l-0.002-0.002c1.411 1.271 3.247 2.095 5.271 2.235l0.028 0.002v5.036c-1.912-0.048-3.71-0.489-5.331-1.247l0.082 0.034c-0.784-0.377-1.447-0.764-2.077-1.196l0.052 0.034c-0.012 3.649 0.012 7.298-0.025 10.934-0.103 1.853-0.719 3.543-1.707 4.954l0.020-0.031c-1.652 2.366-4.328 3.919-7.371 4.011l-0.014 0c-0.123 0.006-0.268 0.009-0.414 0.009-1.73 0-3.347-0.482-4.725-1.319l0.040 0.023c-2.508-1.509-4.238-4.091-4.558-7.094l-0.004-0.041c-0.025-0.625-0.037-1.25-0.012-1.862 0.49-4.779 4.494-8.476 9.361-8.476 0.547 0 1.083 0.047 1.604 0.136l-0.056-0.008c0.025 1.849-0.050 3.699-0.050 5.548-0.423-0.153-0.911-0.242-1.42-0.242-1.868 0-3.457 1.194-4.045 2.861l-0.009 0.030c-0.133 0.427-0.21 0.918-0.21 1.426 0 0.206 0.013 0.41 0.037 0.61l-0.002-0.024c0.332 2.046 2.086 3.59 4.201 3.59 0.061 0 0.121-0.001 0.181-0.004l-0.009 0c1.463-0.044 2.733-0.831 3.451-1.994l0.010-0.018c0.267-0.372 0.45-0.822 0.511-1.311l0.001-0.014c0.125-2.237 0.075-4.461 0.087-6.698 0.012-5.036-0.012-10.060 0.025-15.083z"></path></svg>`
    },
    {
      name: 'YouTube',
      url: 'https://www.youtube.com/@mlehasa',
      svg: `<svg width="32px" height="32px" viewBox="0 -3 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg"><title>youtube [#168]</title><desc>Created with Sketch.</desc><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="Dribbble-Light-Preview" transform="translate(-300.000000, -7442.000000)" fill="#ffffff"><g id="icons" transform="translate(56.000000, 160.000000)"><path d="M251.988432,7291.58588 L251.988432,7285.97425 C253.980638,7286.91168 255.523602,7287.8172 257.348463,7288.79353 C255.843351,7289.62824 253.980638,7290.56468 251.988432,7291.58588 M263.090998,7283.18289 C262.747343,7282.73013 262.161634,7282.37809 261.538073,7282.26141 C259.705243,7281.91336 248.270974,7281.91237 246.439141,7282.26141 C245.939097,7282.35515 245.493839,7282.58153 245.111335,7282.93357 C243.49964,7284.42947 244.004664,7292.45151 244.393145,7293.75096 C244.556505,7294.31342 244.767679,7294.71931 245.033639,7294.98558 C245.376298,7295.33761 245.845463,7295.57995 246.384355,7295.68865 C247.893451,7296.0008 255.668037,7296.17532 261.506198,7295.73552 C262.044094,7295.64178 262.520231,7295.39147 262.895762,7295.02447 C264.385932,7293.53455 264.28433,7285.06174 263.090998,7283.18289" id="youtube-[#168]"></path></g></g></g></svg>`
    }
  ];

  const wrapper = document.querySelector('.s-social-share-wrapper');
  if (!wrapper) return;

  const ul = wrapper.querySelector('.s-social-share-list') || document.createElement('ul');
  ul.className = 's-social-share-list';

  socialLinks.forEach(link => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'nofollow noopener';
    a.ariaLabel = `Visit us on ${link.name}`;
    a.className = 's-social-share-icon';
    a.innerHTML = link.svg;
    li.appendChild(a);
    ul.appendChild(li);
  });

  if (!wrapper.contains(ul)) {
    wrapper.appendChild(ul);
  }
});


/* ═══════════════════════════════════════════════════════════
   6. إعادة تسمية تبويب "جدول المقاسات" إلى "وصف المنتج"
   ═══════════════════════════════════════════════════════════ */

onReady(function renameDetailsTab() {
  const button = document.querySelector('button.tab-trigger[data-target="details_table"]');
  if (button) {
    const span = button.querySelector('.s-button-text');
    if (span) span.textContent = 'وصف المنتج';
  }
});


/* ═══════════════════════════════════════════════════════════
   7. نقل رقم الموديل إلى الشريط اللاصق (Sticky Bar)
   ═══════════════════════════════════════════════════════════ */

onReady(function moveModelNumberToStickyBar() {
  let modelDiv = null;
  document.querySelectorAll('span').forEach(span => {
    const text = span.textContent.trim();
    if (text.includes('رمز الموديل') || text.includes('رقم الموديل')) {
      const parent = span.closest('.center-between');
      if (parent) modelDiv = parent;
    }
  });

  const stickySection = document.querySelector('.sticky-product-bar');
  if (modelDiv && stickySection) {
    modelDiv.classList.remove('center-between');
    modelDiv.style.cssText = 'margin-top: 12px; gap: 10px; display: flex; justify-content: flex-start; align-items: center;';
    stickySection.appendChild(modelDiv);
  }
});


/* ═══════════════════════════════════════════════════════════
   8. ترتيب رقم الموديل بعد عداد المشاهدين مباشرةً
   ═══════════════════════════════════════════════════════════ */

onReady(function positionModelAfterViewers() {
  const modelRow = document.querySelector('.center-between.pb-5.mb-5.border-b-\\[1px\\]');
  const viewersBorder = document.querySelector('.viewers-border');
  if (modelRow && viewersBorder) {
    viewersBorder.insertAdjacentElement('afterend', modelRow);
    modelRow.style.marginTop = '10px';
  }
});


/* ═══════════════════════════════════════════════════════════
   9. نقل صف الوزن تحت رقم الموديل
   ═══════════════════════════════════════════════════════════ */

onReady(function moveWeightUnderModelNumber() {
  function findRowByText(text) {
    let targetRow = null;

    document.querySelectorAll(".center-between, div").forEach(function (el) {
      const elText = (el.textContent || "").trim();

      if (
        elText.includes(text) &&
        el.querySelector("span")
      ) {
        const row = el.closest(".center-between") || el;
        targetRow = row;
      }
    });

    return targetRow;
  }

  function moveWeight() {
    const modelRow = findRowByText("رقم الموديل");
    const weightRow = findRowByText("الوزن");

    if (!modelRow || !weightRow) return false;

    const weightSection = weightRow.closest("section") || weightRow;

    if (weightSection.dataset.mlehaWeightMoved === "true") return true;

    modelRow.insertAdjacentElement("afterend", weightSection);

    weightSection.dataset.mlehaWeightMoved = "true";
    weightSection.classList.add("mleha-weight-under-model");

    return true;
  }

  moveWeight();

  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    if (moveWeight() || tries > 80) {
      clearInterval(timer);
    }
  }, 250);

  window.addEventListener("load", moveWeight);
  document.addEventListener("salla::ready", moveWeight);
});


/* ═══════════════════════════════════════════════════════════
   10. عداد المشاهدين لكل منتج
   ═══════════════════════════════════════════════════════════ */

onReady(function fakeViewersCounter() {
  const productForm = document.getElementById('product-form');
  if (!productForm) return;

  const urlParts = window.location.pathname.split('/').filter(Boolean);
  const productId = urlParts[urlParts.length - 1];
  const STORAGE_KEY = `product_viewers_count:${productId}`;
  const EXPIRY_MS = 2 * 60 * 1000;

  let viewersCount;
  let storedData = localStorage.getItem(STORAGE_KEY);
  if (storedData) {
    try {
      storedData = JSON.parse(storedData);
      if (Date.now() - storedData.timestamp < EXPIRY_MS) viewersCount = storedData.count;
    } catch (e) {}
  }

  if (!viewersCount) {
    viewersCount = Math.floor(Math.random() * (35 - 7 + 1)) + 7;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: viewersCount, timestamp: Date.now() }));
  }

  const viewersBlock = document.createElement('div');
  viewersBlock.className = 'viewers-border';
  viewersBlock.innerHTML = `
    <svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
    </svg>
    <span>${viewersCount}</span> عملاء يشاهدون هذا المنتج الآن
  `;
  productForm.append(viewersBlock);
});


/* ═══════════════════════════════════════════════════════════
   11. إزالة الحدود الحمراء من زر "اشتري الآن"
   ═══════════════════════════════════════════════════════════ */

onReady(function removeBuyNowRedBorder() {
  function cleanBuyNowBorder() {
    document.querySelectorAll('salla-mini-checkout-widget').forEach(widget => {
      widget.style.setProperty('border', 'none', 'important');
      widget.style.setProperty('box-shadow', 'none', 'important');
      widget.style.setProperty('outline', 'none', 'important');

      if (widget.shadowRoot) {
        widget.shadowRoot.querySelectorAll('button, .s-fast-checkout-button').forEach(btn => {
          btn.style.setProperty('border', 'none', 'important');
          btn.style.setProperty('box-shadow', 'none', 'important');
          btn.style.setProperty('outline', 'none', 'important');
        });
      }
    });

    document.querySelectorAll('.s-fast-checkout-button').forEach(btn => {
      btn.style.setProperty('border', 'none', 'important');
      btn.style.setProperty('box-shadow', 'none', 'important');
      btn.style.setProperty('outline', 'none', 'important');
    });
  }

  cleanBuyNowBorder();

  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    cleanBuyNowBorder();
    if (tries > 60) clearInterval(timer);
  }, 250);

  window.addEventListener('load', cleanBuyNowBorder);
  document.addEventListener('salla::ready', cleanBuyNowBorder);
});


/* ═══════════════════════════════════════════════════════════
   12. نقل أيقونات المشاركة والمفضلة تحت عداد المشاهدين
   ═══════════════════════════════════════════════════════════ */

onReady(function moveProductIconsUnderViewers() {
  function moveIcons() {
    const viewers = document.querySelector(".viewers-border");
    const share = document.querySelector("salla-social-share");

    if (!viewers || !share) return false;

    const iconsSection = share.closest(".flex.items-center.justify-between.mb-5");

    if (!iconsSection) return false;

    if (iconsSection.dataset.mlehaMovedUnderViewers === "true") return true;

    viewers.insertAdjacentElement("afterend", iconsSection);

    iconsSection.dataset.mlehaMovedUnderViewers = "true";
    iconsSection.classList.add("mleha-icons-under-viewers");

    return true;
  }

  moveIcons();

  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    if (moveIcons() || tries > 80) clearInterval(timer);
  }, 250);

  window.addEventListener("load", moveIcons);
  document.addEventListener("salla::ready", moveIcons);
});


/* ═══════════════════════════════════════════════════════════
   13. بانر "قارب على النفاذ" الديناميكي
   ═══════════════════════════════════════════════════════════ */

(function addLowStockBanner() {
  var BANNER_SELECTOR = '.mleha-low-stock-banner';
  var LOW_STOCK_QTY   = 40;   // الحد الأدنى للكمية
  var MAX_SIZES_LEFT  = 3;    // الحد الأقصى للمقاسات المتبقية كي يظهر البانر

  // قراءة الكمية الحقيقية من بيانات سلة المضمّنة في الصفحة
  function getProductQuantity() {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      var match = scripts[i].textContent.match(/"quantity"\s*:\s*(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  // شرط الكمية: أقل من 20
  function isQuantityLow() {
    var qty = getProductQuantity();
    return qty !== null && qty < LOW_STOCK_QTY;
  }

  // شرط المقاسات: تبقّى 2 أو 3 فقط من أصل 4 مقاسات أو أكثر
  function hasFewSizesRemaining() {
    var disabled = document.querySelectorAll('.s-product-options-grid-mode label.s-product-options-disabled');
    var enabled  = document.querySelectorAll('.s-product-options-grid-mode label:not(.s-product-options-disabled)');
    var total    = disabled.length + enabled.length;
    return total >= 4 && enabled.length >= 1 && enabled.length <= MAX_SIZES_LEFT;
  }

  function injectBanner(text) {
    var existing = document.querySelector(BANNER_SELECTOR);
    if (existing) {
      var existingSpan = existing.querySelector('.mleha-low-stock-text');
      if (existingSpan && existingSpan.textContent === text) return;
      existing.remove();
    }
    var form = document.getElementById('product-form');
    if (!form) return;
    var div = document.createElement('div');
    div.className = 'mleha-low-stock-banner';
    div.innerHTML = [
      '<span class="mleha-low-stock-text">' + text + '</span>',
      '<img class="mleha-fire-icon" src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a0851e81216d16bb1514286_burn%201-p-1600.png" alt="" />'
    ].join('');
    form.insertAdjacentElement('beforebegin', div);
  }

  function removeBanner() {
    var b = document.querySelector(BANNER_SELECTOR);
    if (b) b.remove();
  }

  function sync() {
    var hasOptions = document.querySelector('.s-product-options-wrapper') !== null;
    var fewSizes   = hasOptions && hasFewSizesRemaining();
    // var lowQty  = isQuantityLow(); // مخفي مؤقتاً

    if (fewSizes) {
      injectBanner('بعض المقاسات نفدت، والمتوفر منها محدود');
    } else {
      removeBanner();
    }
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (document.querySelectorAll('.s-product-options-grid-mode').length > 0 || tries > 80) {
      clearInterval(timer);
      sync();
    }
  }, 250);

  window.addEventListener('load', function () {
    sync();
    setTimeout(sync, 1500);
  });
  document.addEventListener('salla::ready', sync);
  observeDOM(
    sync,
    { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] },
    () => document.getElementById('product-form') || document.querySelector('.product-single') || document.body
  );
})();


/* ═══════════════════════════════════════════════════════════
   17. ترتيب عنوان المقاسات وزر دليل المقاس في صف واحد
   ═══════════════════════════════════════════════════════════ */

(function setupSizeGuideHeading() {
  // The hosted size-guide runtime owns placement when its loader is enabled.
  if (window.__mlehaHostedSizeGuide) return;
  function alignSizeGuideWithOptions() {
    const productInfo = document.querySelector('.product-single .product-single__info');
    if (!productInfo) return false;

    const trigger = productInfo.querySelector('#mlhcTrigger');
    const label = productInfo.querySelector('.s-product-options-option-label');
    if (!trigger || !label) return false;

    label.classList.add('mleha-size-heading');
    if (trigger.parentElement !== label) label.appendChild(trigger);
    return true;
  }

  onReady(function initSizeGuideHeading() {
    alignSizeGuideWithOptions();

    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      if (alignSizeGuideWithOptions() || attempts >= 80) clearInterval(timer);
    }, 250);

    const observer = observeDOM(alignSizeGuideWithOptions);
    setTimeout(function () { observer.disconnect(); }, 20000);
  });

  document.addEventListener('salla::ready', alignSizeGuideWithOptions);
})();


/* ═══════════════════════════════════════════════════════════
   14. نقل بنر تمارا وتابي تحت عداد المشاهدين
   ═══════════════════════════════════════════════════════════ */

(function movePaymentBannersUnderViewers() {
  function moveBanners() {
    try {
      const viewersBorder = document.querySelector('.viewers-border');
      if (!viewersBorder) return false;

      if (document.querySelector('.mleha-payment-moved')) return true;

      const installment = document.querySelector('salla-installment');
      if (!installment) return false;
      if (!installment.querySelector('tamara-widget, #tabbyPromoWrapper')) return false;

      installment.classList.add('mleha-payment-moved');
      viewersBorder.insertAdjacentElement('afterend', installment);

      return true;
    } catch (e) {
      return false;
    }
  }

  if (!moveBanners()) {
    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      if (moveBanners() || tries > 120) clearInterval(timer);
    }, 250);
    window.addEventListener('load', function () { moveBanners(); });
    document.addEventListener('salla::ready', function () { moveBanners(); });
  }
})();


/* ═══════════════════════════════════════════════════════════
   15. تنظيف نص "نفدت الكمية" من خيارات المقاسات المعطّلة
   ═══════════════════════════════════════════════════════════ */

(function stripOutOfStockText() {
  const OUT_OF_STOCK_REGEX = /\s*[-–—|/•·]?\s*(?:نف(?:ذ|د)ت?\s*الكمية|غير\s*متوفر(?:ة)?|Out\s*of\s*stock)\s*/giu;

  function clean() {
    document.querySelectorAll('.s-product-options-disabled .s-product-options-grid-mode-span:not([data-stripped])').forEach(el => {
      const original = el.textContent || '';
      const cleaned = original.replace(OUT_OF_STOCK_REGEX, '').trim();
      if (cleaned && cleaned !== original.trim()) {
        el.textContent = cleaned;
      }
      el.dataset.stripped = '1';
    });
  }

  onReady(clean);
  observeDOM(
    clean,
    { childList: true, subtree: true },
    () => document.querySelector('salla-product-options') || document.getElementById('product-form') || document.body
  );
})();


/* ═══════════════════════════════════════════════════════════
   16. قسم "عادة ما يتم شراؤه مع" — أكثر المنتجات مبيعاً تلقائياً
   الحل: تغيير source="best_selling" في salla-products-slider
   ═══════════════════════════════════════════════════════════ */

(function () {

  /* يعمل فقط في صفحة المنتج */
  if (!isMlehaProductPage()) return;

  function applyBestSelling() {
    const slider = document.querySelector('salla-products-slider[block-title*="يتم شراؤه"]');
    if (!slider) return;

    /* إذا الكود سبق وطُبِّق لا تكرر */
    if (slider.getAttribute('source') === 'best_selling') return;

    slider.setAttribute('source', 'best_selling');
    slider.removeAttribute('source-value');
    slider.removeAttribute('includes');
  }

  /* تشغيل فوري لو DOM جاهز */
  if (document.readyState !== 'loading') {
    applyBestSelling();
  } else {
    document.addEventListener('DOMContentLoaded', applyBestSelling);
  }

  /* MutationObserver كـ backup لو المكوّن يتحمّل بعدين */
  const observer = new MutationObserver(function () {
    const slider = document.querySelector('salla-products-slider[block-title*="يتم شراؤه"]');
    if (slider && slider.getAttribute('source') !== 'best_selling') {
      applyBestSelling();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  /* وقف الـ observer بعد 6 ثوانٍ */
  setTimeout(function () { observer.disconnect(); }, 6000);

})();


} // end product-page-only enhancements





/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
  MLEHA — Infinite Scroll Auto Load
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
======================================== */

(function () {
  if (!isMlehaListingPage()) return;

  var MAX_BATCHES = 50; // hard safety cap; batches load only as the user scrolls
  var RENDER_POLL_MS = 200;
  var RENDER_TIMEOUT_MS = 6000; // how long to wait for a batch to actually render before giving up
  var READY_POLL_MS = 150;
  var READY_TIMEOUT_MS = 10000; // how long to wait for loadMore() to actually become callable
  var CARD_SELECTOR = 'custom-salla-product-card, salla-product-card';
  var hooked = new WeakSet();

  function countCards(list) {
    return list.querySelectorAll(CARD_SELECTOR).length;
  }

  function waitForGrowth(list, before) {
    return new Promise(function (resolve) {
      var waited = 0;
      var timer = setInterval(function () {
        var after = countCards(list);
        waited += RENDER_POLL_MS;
        if (after > before) {
          clearInterval(timer);
          resolve(true);
        } else if (waited >= RENDER_TIMEOUT_MS) {
          clearInterval(timer);
          resolve(false);
        }
      }, RENDER_POLL_MS);
    });
  }

  function waitUntilLoadMoreIsReady(list) {
    return new Promise(function (resolve, reject) {
      var waited = 0;
      var timer = setInterval(function () {
        if (typeof list.loadMore === 'function') {
          clearInterval(timer);
          resolve();
        } else {
          waited += READY_POLL_MS;
          if (waited >= READY_TIMEOUT_MS) {
            clearInterval(timer);
            reject(new Error('loadMore never became ready'));
          }
        }
      }, READY_POLL_MS);
    });
  }

  function attachViewportLoader(list) {
    if (!('IntersectionObserver' in window)) return;

    var batches = 0;
    var loading = false;
    var sentinel = document.createElement('span');
    sentinel.className = 'mleha-products-load-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'display:block;width:1px;height:1px;pointer-events:none;';
    list.insertAdjacentElement('afterend', sentinel);

    var viewportObserver = new IntersectionObserver(function (entries) {
      if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
      if (loading || batches >= MAX_BATCHES || !document.body.contains(list)) return;

      loading = true;
      batches++;
      var before = countCards(list);

      Promise.resolve()
        .then(function () {
          return list.loadMore();
        })
        .then(function () {
          return waitForGrowth(list, before);
        })
        .then(function (grew) {
          loading = false;
          if (!grew || batches >= MAX_BATCHES) {
            viewportObserver.disconnect();
            sentinel.remove();
          }
        })
        .catch(function () {
          loading = false;
          viewportObserver.disconnect();
          sentinel.remove();
        });

    }, { rootMargin: '600px 0px' });

    viewportObserver.observe(sentinel);
  }

  function hook(list) {
    if (!list || hooked.has(list) || !list.hasAttribute('autoload')) return;
    hooked.add(list);

    waitUntilLoadMoreIsReady(list)
      .then(function () {
        attachViewportLoader(list);
      })
      .catch(function () {
        // element never finished hydrating — give up quietly on this list
      });
  }

  document.querySelectorAll('salla-products-list').forEach(hook);

  // Filters/category AJAX can swap in a fresh <salla-products-list>, so keep watching for new ones.
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('salla-products-list')) hook(node);
        if (node.querySelectorAll) node.querySelectorAll('salla-products-list').forEach(hook);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();





/* ######################################################################
   SIZE & FIT TOOLS
   ###################################################################### */

/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
  MLEHA — Size Calculator Script
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

(function(){
'use strict';
// Retained only as an emergency rollback copy; the hosted runtime is authoritative.
if(window.__mlehaHostedSizeGuide) return;
if(window._mlhcLoaded) return;
window._mlhcLoaded = true;

// ─── يعمل فقط على صفحة المنتج المفردة التي تعلنها سلة ─────────────────────
if(!isMlehaProductPage()) return;

// ─── حقن CSS ──────────────────────────────────────────────────────────────
(function injectStyles(){
  const style = document.createElement('style');
  style.id = 'mlhc-styles';
  style.textContent = `:root{--wine:#9d3d38;--wine-dk:#7d2f2b;--cream:#eeddc7;--beige:#eee2d4;--beige-s:#f8f0e8;--beige-m:#e5d4c0;--brown:#452e1e;--ink:#262626;--line:#ddd0c4;--muted:#8a7f74;--ok:#2f7d5b;--bad:#b03a3a}
#mlhcTrigger{display:inline-flex;align-items:center;gap:7px;background:none;border:1.5px solid #9d3d38;color:#9d3d38;border-radius:8px;padding:8px 16px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:'Zain',-apple-system,sans-serif;transition:all .2s;margin-top:10px}
#mlhcTrigger:hover{background:#9d3d38;color:#fff}
#mlhcTrigger svg{width:16px;height:16px;flex-shrink:0}
.mlhc-ov{position:fixed;inset:0;background:rgba(178,178,178,.2)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;z-index:99998;opacity:0;visibility:hidden;transition:opacity .3s ease}
.mlhc-ov.open{opacity:1;visibility:visible}
.mlhc-drawer{position:fixed;z-index:99999;background:#fafafa;display:flex;flex-direction:column;font-family:'Zain',-apple-system,BlinkMacSystemFont,sans-serif;direction:rtl;-webkit-font-smoothing:antialiased;transition:transform .3s cubic-bezier(.25,.46,.45,.94)!important}
@media(min-width:700px){.mlhc-drawer{top:0;left:0;height:100vh;width:440px;border-radius:0 16px 16px 0;transform:translateX(-100%);box-shadow:4px 0 30px rgba(0,0,0,.15)}.mlhc-drawer.open{transform:translateX(0)}}
@media(max-width:699px){.mlhc-drawer{bottom:0;left:0;right:0;height:90vh;border-radius:18px 18px 0 0;transform:translateY(100%);box-shadow:0 -4px 30px rgba(0,0,0,.15)}.mlhc-drawer.open{transform:translateY(0)}}
.mlhc-dh{background:linear-gradient(160deg,#e8d8c4,#eee2d4);padding:20px 20px 16px;border-bottom:1.5px solid #ddd0c4;flex-shrink:0;position:relative}
.mlhc-dh-inner{display:flex;align-items:center;gap:14px;direction:rtl}
.mlhc-dh-inner img{height:48px;width:48px;object-fit:contain;flex-shrink:0;opacity:.85;border-radius:8px}
.mlhc-dh-text{display:flex;flex-direction:column;gap:3px;text-align:right}
.mlhc-dh h3{font-size:20px;font-weight:900;color:#452e1e;margin:0}
.mlhc-dh p{font-size:12px;color:#452e1e;opacity:.6;margin:0}
.mlhc-close{position:absolute;top:14px;left:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#8a7f74;line-height:1;padding:4px}
.mlhc-close:hover{color:#262626}
.mlhc-db{flex:1;overflow-y:auto;padding:18px;-webkit-overflow-scrolling:touch}
.mlhc-loading{text-align:center;padding:40px;color:#8a7f74;font-size:14px;display:none}
.mlhc-loading.show{display:block}
.mlhc-db .sku-bar{display:flex;align-items:center;justify-content:space-between;background:var(--beige-s);border:1.5px solid var(--line);border-radius:10px;padding:10px 15px;margin-bottom:18px;font-size:13.5px}
.mlhc-db .sku-bar .lbl{color:var(--muted);font-size:12px}
.mlhc-db .sku-bar .val{font-weight:800;font-size:15px;color:var(--brown)}
.mlhc-db .nodata{display:none;text-align:center;padding:30px 0}
.mlhc-db .nodata .icon{font-size:36px;margin-bottom:15px;opacity:.7}
.mlhc-db .nodata p{font-size:15px;color:var(--muted)}
.mlhc-db .accordion{margin-bottom:16px}
.mlhc-db .acc-header{display:flex;align-items:center;justify-content:space-between;background:var(--beige-s);border:1.5px solid var(--line);border-radius:10px;padding:11px 14px;cursor:pointer;font-size:13.5px;font-weight:700;color:var(--brown);user-select:none;transition:background .15s}
.mlhc-db .acc-header:hover{background:var(--beige)}
.mlhc-db .acc-header.open{border-radius:10px 10px 0 0}
.mlhc-db .acc-header .arr{font-size:10px;color:var(--wine);transition:transform .2s}
.mlhc-db .acc-header.open .arr{transform:rotate(180deg)}
.mlhc-db .acc-body{display:none}
.mlhc-db .acc-body.show{display:block}
.mlhc-db .guide-simple{display:flex;align-items:center;gap:14px;background:var(--beige-s);border:1.5px solid var(--line);border-radius:12px;padding:14px 15px;margin-bottom:18px}
.mlhc-db .guide-simple img{width:82px;flex-shrink:0;display:block;opacity:.93;border-radius:8px}
.mlhc-db .guide-simple-list{font-size:13px;color:var(--ink);flex:1;display:flex;flex-direction:column;gap:10px}
.mlhc-db .guide-simple-list .gnum{width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#c25c3a;color:#fff;font-weight:800;font-size:11px;margin-left:6px;vertical-align:middle;flex-shrink:0}
.mlhc-db .guide-item{display:flex;flex-direction:column;gap:2px}
.mlhc-db .guide-label{font-size:13px;font-weight:700;color:var(--ink);display:flex;align-items:center}
.mlhc-db .guide-hint{font-size:11px;color:#9b8c7f;padding-right:25px}
.mlhc-db .sec-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;border-bottom:1.5px solid var(--line);padding-bottom:8px}
.mlhc-db .sec-title{font-size:13px;font-weight:800;color:var(--brown);letter-spacing:.2px}
.mlhc-db .inputs-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:18px}
.mlhc-db .inp-group{display:flex;flex-direction:column;gap:5px}
.mlhc-db .inp-group label{font-size:12.5px;font-weight:700;color:var(--brown);display:flex;align-items:center;gap:6px}
.mlhc-db .inp-group label .dot{width:8px;height:8px;display:inline-block;border-radius:2px}
.mlhc-db .inp-wrap{position:relative}
.mlhc-db .inp-wrap input{width:100%;border:1.5px solid var(--line);border-radius:9px;padding:11px 12px;padding-left:40px;font-size:17px;font-weight:700;font-family:inherit;transition:border-color .2s,box-shadow .2s;direction:ltr;text-align:center;color:var(--ink);background:#fff}
.mlhc-db .inp-wrap input:focus{outline:none;border-color:var(--wine);box-shadow:0 0 0 3px rgba(157,61,56,.08)}
.mlhc-db .inp-wrap input::placeholder{font-size:14px;font-weight:400;color:#ccc}
.mlhc-db .inp-wrap .utag{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11.5px;color:var(--muted);font-weight:700;pointer-events:none}
.mlhc-db .calc-btn{width:100%;padding:15px;background:var(--wine);color:var(--cream);border:none;border-radius:11px;font-size:17px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .2s;margin-bottom:18px;letter-spacing:.4px;box-shadow:0 3px 12px rgba(157,61,56,.25)}
.mlhc-db .calc-btn:hover{background:var(--wine-dk);box-shadow:0 4px 16px rgba(157,61,56,.35);transform:translateY(-1px)}
.mlhc-db .calc-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(157,61,56,.2)}
.mlhc-db .result{display:none}
.mlhc-db .result.show{display:block}
.mlhc-db .rc{background:linear-gradient(135deg,var(--wine-dk) 0%,#6b2420 100%);color:var(--cream);border-radius:14px;padding:26px 22px;text-align:center;margin-bottom:16px;box-shadow:0 4px 20px rgba(100,30,28,.2)}
.mlhc-db .rc.no-fit{background:linear-gradient(135deg,#6b5144 0%,#452e1e 100%)}
.mlhc-db .rc.warning{background:linear-gradient(135deg,var(--brown) 0%,#2d1a0e 100%)}
.mlhc-db .rc.poor{background:linear-gradient(135deg,var(--bad) 0%,#7a2020 100%)}
.mlhc-db .rc-size{font-size:64px;font-weight:900;color:#fff;line-height:1;margin-bottom:10px;text-shadow:0 2px 8px rgba(0,0,0,.15)}
.mlhc-db .rc.no-fit .rc-size{font-size:24px;line-height:1.45;margin-bottom:12px;text-shadow:none}
.mlhc-db .rc.no-fit .rc-note{font-size:14px;line-height:1.8;margin-bottom:0}
.mlhc-db .rc-note{font-size:14px;color:var(--cream);opacity:.92;line-height:1.7;margin-bottom:8px}
.mlhc-db .rc-alt{font-size:13.5px;color:var(--cream);opacity:.85;line-height:1.65;border-top:1px solid rgba(255,255,255,.18);padding-top:10px;margin-top:6px}
.mlhc-db .sizetable{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.mlhc-db .sizetable th{background:var(--brown);color:var(--cream);padding:9px 5px;text-align:center;font-size:12px;font-weight:700}
.mlhc-db .sizetable th:first-child{text-align:right;padding-right:10px;border-radius:0 8px 0 0}
.mlhc-db .sizetable th:last-child{border-radius:8px 0 0 0}
.mlhc-db .sizetable td{padding:9px 5px;text-align:center;border-bottom:1px solid var(--line);color:var(--ink)}
.mlhc-db .sizetable td:first-child{text-align:right;padding-right:10px;font-weight:700;font-size:12px;color:var(--brown);white-space:nowrap}
.mlhc-db .sizetable tr:last-child td{border-bottom:none}
.mlhc-db .sizetable td.best{background:var(--beige);font-weight:800;color:var(--wine)}
.mlhc-db .sizetable td.info-col{color:var(--beige-m)}
.mlhc-db .sizetable tr.info-row{opacity:.6}
.mlhc-db .you-val{display:block;font-size:11px;color:var(--muted);margin-top:2px}
.mlhc-db .save-row{display:flex;align-items:center;justify-content:space-between;padding-top:12px;font-size:12.5px;color:var(--muted);border-top:1.5px solid var(--line);margin-top:4px}
.mlhc-db .save-btn{background:none;border:1.5px solid var(--line);border-radius:8px;padding:6px 13px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--brown);transition:all .2s}
.mlhc-db .save-btn:hover{border-color:var(--wine);color:var(--wine)}
.mlhc-db .saved-ok{color:var(--ok);font-weight:700;display:none;font-size:13.5px}
.mlhc-db .prev-size{display:none;background:linear-gradient(90deg,var(--beige-s),#fff);border:1.5px solid var(--beige-m);border-radius:10px;padding:9px 14px;font-size:13px;color:var(--brown);margin-bottom:14px;font-weight:700}`;
  document.head.appendChild(style);
})();

// ─── حقن HTML الدرور في الصفحة ────────────────────────────────────────────
document.body.insertAdjacentHTML('beforeend', `
<div class="mlhc-ov" id="mlhcOv" onclick="mlhcClose()"></div>
<div class="mlhc-drawer" id="mlhcDrawer">
  <div class="mlhc-dh">
    <button class="mlhc-close" onclick="mlhcClose()">✕</button>
    <div class="mlhc-dh-inner">
      <img id="storeLogo" src="" alt="" style="display:none" onload="this.style.display='block'">
      <div class="mlhc-dh-text">
        <h3>اعرفي مقاسك</h3>
        <p>أدخلي قياساتك واحصلي على المقاس المثالي لك</p>
      </div>
    </div>
  </div>
  <div class="mlhc-db">
    <div class="mlhc-loading show" id="mlhcLoad">⏳ جاري تحميل البيانات...</div>
    <div id="mlhcMain" style="display:none">
      <div class="sku-bar">
        <span class="lbl">رمز المنتج</span>
        <span class="val" id="skuDisplay">—</span>
      </div>
      <div class="nodata" id="noDataState">
        <div class="icon">📋</div>
        <p>جدول المقاسات لهذا المنتج غير متوفر حالياً</p>
      </div>
      <div id="mainForm" style="display:none">
        <div class="prev-size" id="prevSize"></div>
        <div class="guide-simple">
          <img src="https://drive.google.com/thumbnail?id=16NlFhYgDXgvGu5ij_fx1-sHfbx3tVUEJ&sz=w200" alt="دليل القياس" onerror="this.style.display='none'">
          <div class="guide-simple-list">
            <div class="guide-item">
              <div class="guide-label"><span class="gnum">1</span> الصدر</div>
              <div class="guide-hint">قيسيه عند أوسع نقطة من الكتف</div>
            </div>
            <div class="guide-item">
              <div class="guide-label"><span class="gnum">2</span> الخصر</div>
              <div class="guide-hint">أضيق نقطة فوق السرة</div>
            </div>
          </div>
        </div>
        <div class="pre-table" id="preTable" style="display:none">
          <div class="sec-title-row">
            <span class="sec-title">جدول المقاسات</span>
          </div>
          <div style="overflow-x:auto" id="sizeTableWrap"></div>
        </div>
        <div class="sec-title-row">
          <span class="sec-title">قياساتك (إنش)</span>
        </div>
        <div class="inputs-grid" id="inputsGrid"></div>
        <button class="calc-btn" onclick="mlhcCalculate()">احسبي مقاسي ←</button>
        <div class="result" id="resultBlock">
          <div class="rc" id="rcCard">
            <div class="rc-size" id="rcSize">—</div>
            <div class="rc-note" id="rcNote"></div>
            <div class="rc-alt" id="rcAlt" style="display:none"></div>
          </div>
          <div class="save-row">
            <span>🔒 قياساتك محفوظة في جهازك</span>
            <button class="save-btn" id="saveBtn" onclick="mlhcSaveConfirm()">حفظ المقاس</button>
            <span class="saved-ok" id="savedOk">✓ تم الحفظ</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`);

// ─── إعدادات ───────────────────────────────────────────────────────────────
// شيت المقاسات — مثبّت على الـ gid مباشرةً (نفس رابط التبويب المفتوح في المتصفح)
// https://docs.google.com/spreadsheets/d/1ecUgL4nKGnG9wKO0kBiOdyL3TiVZbNnlXHiBYBVhx8M/edit?gid=1781216773
const SHEET_ID   = '1ecUgL4nKGnG9wKO0kBiOdyL3TiVZbNnlXHiBYBVhx8M';
const SHEET_GID  = '1781216773';
// نقرأ عبر export?format=csv وليس gviz.
// السبب: gviz يصنّف عمود SKU كـ number، فيرجّع أي خلية نصية فيه فارغة (null)
// وتختفي عشرات الموديلات المكتوبة كنص. أما export فيرجّع القيم كما تُعرض تماماً.
// كسر الكاش: بدون هذا قد يُخدم للعميلة نسخة قديمة من الشيت بعد أي تحديث
const sheetsUrl = () =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}&_cb=${Date.now()}`;
const GUIDE_IMG  = 'https://drive.google.com/thumbnail?id=16NlFhYgDXgvGu5ij_fx1-sHfbx3tVUEJ&sz=w200';

const LABEL_MAP      = {CHEST:'محيط الصدر',WAIST:'محيط الخصر',HIP:'الورك',SHOULDER:'محيط الكتف',LENGTH:'الطول',SLEEVE:'طول الكم',BLOUSE_LEN:'طول البلوزة',SKIRT_LEN:'طول التنورة'};
const DISPLAY_ORDER  = ['BLOUSE_LEN','SKIRT_LEN','LENGTH','SLEEVE','SHOULDER','CHEST','WAIST','HIP'];
// قطعتان: الصدر/الكتف = القطعة العلوية، الخصر/الورك = القطعة السفلية
const TOP_KEY        = 'CHEST';
const BOTTOM_KEY     = 'WAIST';
const VISIBLE_KEYS   = ['CHEST','WAIST'];
const SCORE_ORDER    = ['CHEST','WAIST','HIP','SHOULDER'];
const META = {
  CHEST:   {ar:'محيط الصدر', color:'#9d3d38'},
  WAIST:   {ar:'محيط الخصر', color:'#b5894e'},
  HIP:     {ar:'الورك',      color:'#6b7a4f'},
  SHOULDER:{ar:'محيط الكتف', color:'#6d4357'},
};

// ─── حالة ─────────────────────────────────────────────────────────────────
let SIZE_DATA = {}, sku = null;
const unit = 'in';

// ─── أدوات ────────────────────────────────────────────────────────────────
const c2i = v => +(v/2.54).toFixed(2);
const i2c = v => +(v*2.54).toFixed(1);

function fmt(v, u){
  if(v==null||v==='') return '—';
  if(typeof v==='string'){ const n=parseFloat(v); if(isNaN(n)) return v; v=n; }
  return u==='in' ? (Number.isInteger(v)?v:+v.toFixed(1)) : Math.round(i2c(v));
}
function fmtCell(v, u){
  if(v==null||v==='') return '—';
  if(typeof v==='string'){
    const parts = v.split(/[\/\-]/).map(x=>x.trim()).filter(x=>x!=='');
    if(parts.length>1 && parts.every(x=>!isNaN(parseFloat(x))))
      return parts.map(x=>fmt(parseFloat(x),u)).join(' / ');
    const n=parseFloat(v); return isNaN(n)?v:fmt(n,u);
  }
  return fmt(v,u);
}

function escapeMlehaHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function findFittingSize(data,user){
  const keys=Object.keys(user);
  const si=data.sizes.findIndex((_,i)=>keys.every(k=>Number.isFinite(data.score[k]?.[i])&&data.score[k][i]>=user[k]));
  if(si<0) return null;
  const exact=keys.every(k=>Math.abs(data.score[k][si]-user[k])<0.001);
  return {size:data.sizes[si],si,exact,smaller:si>0?{size:data.sizes[si-1],si:si-1}:null};
}
// أصغر مقاس تتحقق فيه قيمة مفتاح واحد (لحساب مقاس كل قطعة على حدة)
function fitIndexForKey(data,key,val){
  if(val==null||!data.score[key]) return -1;
  return data.score[key].findIndex(v=>Number.isFinite(v)&&v>=val);
}
function labelPart(ar){
  if(ar.includes('صدر')) return 'CHEST';
  if(ar.includes('خصر')) return 'WAIST';
  if(ar.includes('ورك')) return 'HIP';
  if(ar.includes('كتف')) return 'SHOULDER';
  return null;
}

// ─── تحليل CSV (يدعم الفواصل وعلامات الاقتباس داخل الخلايا) ──────────────
function parseCSV(text){
  const rows=[]; let row=[], cell='', q=false;
  text = text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; }
      else cell+=ch;
    } else if(ch==='"') q=true;
    else if(ch===','){ row.push(cell); cell=''; }
    else if(ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
    else if(ch!=='\r') cell+=ch;
  }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows;
}

// ─── جلب البيانات من Google Sheets ────────────────────────────────────────
async function fetchSizeData(){
  try{
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 10000) : null;
    const res  = await fetch(sheetsUrl(), {
      cache:'no-store',
      ...(controller ? { signal: controller.signal } : {})
    });
    if (timeout) clearTimeout(timeout);
    if (!res.ok) throw new Error(`Size data request failed (${res.status})`);
    const text = await res.text();
    const all  = parseCSV(text).filter(r=>r.some(c=>String(c).trim()!==''));
    if(!all.length) throw new Error('الشيت فارغ');
    const cols = all[0].map(c=>String(c).trim());
    const rows = all.slice(1).map(r=>cols.map((_,i)=>{
      const v=(r[i]==null?'':String(r[i]).trim());
      return v===''?null:v;
    }));

    const grouped = {};
    rows.forEach(row=>{
      const obj={}; cols.forEach((col,i)=>obj[col]=row[i]);
      const s=canonSku(obj.SKU); if(!s) return;
      if(!grouped[s]) grouped[s]=[];
      grouped[s].push(obj);
    });

    SIZE_DATA = {};
    Object.entries(grouped).forEach(([s,sizeRows])=>{
      const sizes = sizeRows.map(r=>String(r.Size).trim());
      const score = {};
      ['CHEST','WAIST','HIP','SHOULDER'].forEach(key=>{
        const vals=sizeRows.map(r=>r[key]!=null?Number(r[key]):null);
        if(vals.some(v=>v!=null)) score[key]=vals;
      });
      const display = [];
      DISPLAY_ORDER.forEach(key=>{
        const vals=sizeRows.map(r=>r[key]!=null?r[key]:null);
        if(vals.some(v=>v!=null)) display.push({label:LABEL_MAP[key],values:vals});
      });
      // منتج مكوّن من قطعتين: نستنتجه تلقائياً إذا عُبّئ طول البلوزة أو طول التنورة
      const twoPiece = sizeRows.some(r=>r.BLOUSE_LEN!=null||r.SKIRT_LEN!=null);
      SIZE_DATA[s] = {sizes,score,display,twoPiece};
    });
    return true;
  }catch(e){
    console.error('mlhc: خطأ في تحميل البيانات', e);
    return false;
  }
}

// ─── قراءة رقم الموديل من الصفحة ──────────────────────────────────────────
function getSkuFromPage(){
  // الأولوية للـ SKU الحقيقي — لا لمعرّف المنتج (product.id) لأنه رقم مختلف تماماً
  try{
    const v = window.salla?.product?.sku
      || window.Salla?.product?.get?.()?.sku
      || window.salla?.config?.get?.('page.product.sku');
    if(v) return String(v).trim();
  }catch(e){}

  const textSelectors = ['[data-product-sku]','[data-sku]','.product-sku','.sku-value','[itemprop="sku"]'];
  for(const sel of textSelectors){
    const el = document.querySelector(sel);
    if(el){
      const v = (el.getAttribute('data-product-sku')||el.getAttribute('data-sku')||el.getAttribute('content')||el.textContent||'').trim();
      if(v) return v;
    }
  }

  const idEl = document.querySelector('[data-product-id]');
  if(idEl){ const v=(idEl.getAttribute('data-product-id')||'').trim(); if(v) return v; }

  const m = location.pathname.match(/\/products?\/(\d+)/);
  if(m) return m[1];

  return null;
}

// ─── توحيد صيغة الـ SKU للمطابقة ─────────────────────────────────────────
// جوجل شيت يخزّن العمود كأرقام فيحذف الأصفار البادئة (00229 ← 229)،
// لذلك نوحّد الطرفين: حروف كبيرة، بدون رموز، وبدون أصفار بادئة.
function canonSku(raw){
  if(raw==null) return null;
  let s = String(raw).trim().toUpperCase().replace(/[^0-9A-Z]/g,'');
  s = s.replace(/^0+(?=.)/,'');
  return s || null;
}

// ─── استخراج رقم الموديل من نص الـ SKU المعروض ──────────────────────────
// يرجّع قائمة احتمالات مرتبة (الأدق أولاً) لأن صيغة SKU المتجر تختلف:
// 7628 / 7628-A / ML-7628 / 7628 أسود ... إلخ
function skuCandidates(raw){
  if(!raw) return [];
  const txt  = String(raw).trim();
  const out  = [];
  const push = v => { const c=canonSku(v); if(c && !out.includes(c)) out.push(c); };

  push(txt);                                   // النص كامل
  txt.split(/[-\/_\s]+/).forEach(push);         // كل مقطع على حدة
  (txt.match(/\d{3,7}/g)||[]).forEach(push);    // أي كتلة أرقام 3–7 خانات
  const m4 = txt.match(/(\d{4})/);              // السلوك القديم: أول 4 أرقام
  if(m4) push(m4[1]);

  // نستبعد الاحتمالات القصيرة جداً (مثل "1" من "1248-01") تفادياً لمطابقة خاطئة،
  // إلا إذا كان رقم الموديل نفسه قصيراً أصلاً
  const minLen = canonSku(txt)?.length <= 2 ? 1 : 3;
  return out.filter(c=>c.length>=minLen);
}

// يختار أول احتمال له بيانات فعلية في الشيت، وإلا الاحتمال الأول
function extractSku(raw){
  const cands = skuCandidates(raw);
  if(!cands.length) return null;
  const hit = cands.find(c=>SIZE_DATA[c]);
  if(!hit) console.warn('mlhc: لا توجد بيانات مقاسات لهذا المنتج. SKU الصفحة:', raw, '| الاحتمالات المجرَّبة:', cands);
  return hit || cands[0];
}

// ─── تحميل بيانات المنتج في الدرور ────────────────────────────────────────
function loadSku(s, display){
  sku = s||null;
  // نعرض رقم الموديل كما هو في المتجر، ونطابق داخلياً بالصيغة الموحّدة
  document.getElementById('skuDisplay').textContent = display||s||'—';
  document.getElementById('resultBlock').classList.remove('show');
  document.getElementById('noDataState').style.display = 'none';
  document.getElementById('mainForm').style.display    = 'none';
  document.getElementById('prevSize').style.display    = 'none';
  if(!s) return;

  const data = SIZE_DATA[s];
  if(!data||!data.score||!Object.keys(data.score).length){
    document.getElementById('noDataState').style.display = 'block';
    return;
  }

  document.getElementById('mainForm').style.display = 'block';
  buildInputs(data);
  // إظهار جدول المقاسات فوق الإدخالات مباشرة عند فتح الدرج (بدون تظليل بعد)
  renderSizeTable(data, -1, {});
  document.getElementById('preTable').style.display = 'block';
  fillSaved();
  showPrevSize(s);
}

// ─── بناء حقول الإدخال ────────────────────────────────────────────────────
function buildInputs(data){
  const keys = VISIBLE_KEYS.filter(k=>data.score[k]);
  document.getElementById('inputsGrid').innerHTML = keys.map(k=>`
    <div class="inp-group">
      <label><span class="dot" style="background:${META[k].color}"></span>${META[k].ar.replace('محيط ','')}</label>
      <div class="inp-wrap">
        <input type="number" id="inp_${k}" min="1" step="0.1" placeholder="—">
        <span class="utag">إنش</span>
      </div>
    </div>`).join('');
}

// ─── Accordion ────────────────────────────────────────────────────────────
window.mlhcToggleAcc = function(id){
  const hdr  = document.querySelector(`#${id} .acc-header`);
  const body = document.getElementById(id+'Body');
  const open = body.classList.contains('show');
  body.classList.toggle('show',!open);
  hdr.classList.toggle('open',!open);
};

// ─── الحساب ────────────────────────────────────────────────────────────────
window.mlhcCalculate = function(){
  const data = SIZE_DATA[sku];
  if(!data||!data.score){ alert('لا توجد بيانات لهذا المنتج'); return; }

  const parts = VISIBLE_KEYS.filter(k=>data.score[k]);
  const user  = {};
  parts.forEach(k=>{
    const v=parseFloat(document.getElementById('inp_'+k)?.value);
    if(!isNaN(v)&&v>0) user[k] = v;
  });
  if(!Object.keys(user).length){ alert('الرجاء إدخال قياس واحد على الأقل'); return; }

  autoSave(user);

  const best=findFittingSize(data,user);

  // أكبر من أكبر مقاس: تجاوز بسيط (≤2 إنش) => أكبر مقاس مع تنبيه ضيّق، وإلا لا يوجد مقاس
  if(!best){
    const last = data.sizes.length-1;
    const over = Math.max(...Object.keys(user).map(k=>
      Number.isFinite(data.score[k]?.[last]) ? (user[k]-data.score[k][last]) : -Infinity));
    if(over>0 && over<=2) renderTightLargest(data,user);
    else renderNoFit(data,user,'large');
    return;
  }

  // أصغر من أصغر مقاس (best.si===0): تجاوز بسيط (≤2 إنش) => أصغر مقاس مع تنبيه واسع، وإلا لا يوجد مقاس
  if(best.si===0){
    const under = Math.max(...Object.keys(user).map(k=>
      Number.isFinite(data.score[k]?.[0]) ? (data.score[k][0]-user[k]) : -Infinity));
    if(under>2){ renderNoFit(data,user,'small'); return; }
    if(under>0){ renderTightSmallest(data,user); return; }
  }

  renderResult(data,best,user);
};

// ─── عرض النتيجة ──────────────────────────────────────────────────────────
function renderResult(data,best,user){
  document.getElementById('rcCard').className = 'rc';
  document.getElementById('rcSize').textContent = best.size;

  // قطعتان: نحسب مقاس كل قطعة على حدة ونوصي بالأكبر مع ملاحظة توضيحية
  const twoPiece = data.twoPiece;
  const topIdx    = twoPiece?fitIndexForKey(data,TOP_KEY,user[TOP_KEY]):-1;
  const bottomIdx = twoPiece?fitIndexForKey(data,BOTTOM_KEY,user[BOTTOM_KEY]):-1;

  let note = 'قياساتك تناسب هذا المقاس';
  if(twoPiece && topIdx>=0 && bottomIdx>=0){
    if(topIdx!==bottomIdx){
      const bigger  = topIdx>bottomIdx?'العلوية':'السفلية';
      const smaller = topIdx>bottomIdx?'السفلية':'العلوية';
      note = `صدركِ يناسب مقاس ${data.sizes[topIdx]} وخصركِ يناسب ${data.sizes[bottomIdx]} — اخترنا الأكبر (${best.size}) ليتّسع للقطعة ${bigger}، وقد تكون القطعة ${smaller} أوسع قليلاً.`;
    } else {
      note = 'قياساتكِ تناسب هذا المقاس في القطعتين';
    }
  }
  document.getElementById('rcNote').textContent = note;

  // اقتراح مقاس أضيق: نُخفيه للقطعتين لأن الأصغر سيضيّق القطعة الأكبر
  const altEl = document.getElementById('rcAlt');
  if(!twoPiece && !best.exact && best.smaller){
    altEl.style.display = 'block';
    altEl.textContent = `إذا كنتِ تفضلين مقاسًا أضيق قليلًا، يمكنك تجربة ${best.smaller.size}.`;
  } else {
    altEl.style.display = 'none';
    altEl.textContent = '';
  }

  renderSizeTable(data, best.si, user);
  saveBestSize(sku, best.size);
  document.getElementById('resultBlock').classList.add('show');
}

function renderNoFit(data,user,dir){
  document.getElementById('rcCard').className = 'rc no-fit';
  document.getElementById('rcSize').textContent = 'لا يوجد مقاس مناسب';
  document.getElementById('rcNote').textContent = dir==='small'
    ? 'بحسب القياسات المدخلة، قياساتك أصغر من أصغر مقاس متوفر حاليًا لهذا المنتج.'
    : 'بحسب القياسات المدخلة، تتجاوز قياساتك أكبر مقاس متوفر حاليًا لهذا المنتج.';
  const altEl=document.getElementById('rcAlt');
  altEl.style.display = 'none';
  altEl.textContent = '';
  renderSizeTable(data,-1,user);
  document.getElementById('resultBlock').classList.add('show');
}

// تجاوز بسيط أصغر (≤ 2 إنش): نرشّح أصغر مقاس مع تنبيه أنه سيكون واسعاً
function renderTightSmallest(data,user){
  const si = 0;
  document.getElementById('rcCard').className = 'rc warning';
  document.getElementById('rcSize').textContent = data.sizes[si];
  document.getElementById('rcNote').textContent = `قياساتكِ أصغر قليلاً من أصغر مقاس متوفر لدينا (${data.sizes[si]}). هو الأقرب لكِ لكنه سيكون واسعاً بعض الشيء.`;
  const altEl=document.getElementById('rcAlt');
  altEl.style.display = 'none';
  altEl.textContent = '';
  renderSizeTable(data, si, user);
  saveBestSize(sku, data.sizes[si]);
  document.getElementById('resultBlock').classList.add('show');
}

// تجاوز بسيط أكبر (≤ 2 إنش): نرشّح أكبر مقاس مع تنبيه أنه سيكون ضيّقاً
function renderTightLargest(data,user){
  const si = data.sizes.length-1;
  document.getElementById('rcCard').className = 'rc warning';
  document.getElementById('rcSize').textContent = data.sizes[si];
  document.getElementById('rcNote').textContent = `قياساتكِ أكبر قليلاً من أكبر مقاس متوفر لدينا (${data.sizes[si]}). هو الأقرب لكِ لكنه سيكون ضيّقاً بعض الشيء.`;
  const altEl=document.getElementById('rcAlt');
  altEl.style.display = 'none';
  altEl.textContent = '';
  renderSizeTable(data, si, user);
  saveBestSize(sku, data.sizes[si]);
  document.getElementById('resultBlock').classList.add('show');
}

// ─── جدول المقاسات ────────────────────────────────────────────────────────
function renderSizeTable(data, bestSi, user){
  const ths = '<th>القياس</th>' + data.sizes.map((s,i)=>
    `<th style="${i===bestSi?'background:#9d3d38;color:#fff':''}">${escapeMlehaHtml(s)}</th>`).join('');
  const trs = data.display.map(r=>{
    const part  = labelPart(r.label);
    const isInfo= !part;
    const u     = part?user[part]:undefined;
    const uSpan = u!==undefined?`<span class="you-val">أنتِ: ${fmt(u,unit)}</span>`:'';
    const tds   = r.values.map((v,i)=>{
      const cls = !isInfo&&i===bestSi?'best':isInfo?'info-col':'';
      return `<td class="${cls}">${escapeMlehaHtml(fmtCell(v,unit))}</td>`;
    }).join('');
    return `<tr class="${isInfo?'info-row':''}"><td>${escapeMlehaHtml(r.label)}${uSpan}</td>${tds}</tr>`;
  }).join('');
  document.getElementById('sizeTableWrap').innerHTML =
    `<table class="sizetable"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ─── التخزين المحلي ────────────────────────────────────────────────────────
const MKEY = 'mleha_measurements', BKEY = 'mleha_sizes';
function getSaved(){ try{return JSON.parse(localStorage.getItem(MKEY)||'{}')}catch{return{}} }
function autoSave(u){ try{localStorage.setItem(MKEY,JSON.stringify({...getSaved(),...u}))}catch{} }
function saveBestSize(s,size){
  try{ const d=JSON.parse(localStorage.getItem(BKEY)||'{}'); d[s]={size,ts:Date.now()}; localStorage.setItem(BKEY,JSON.stringify(d)); }catch{}
}
function showPrevSize(s){
  try{
    const d=JSON.parse(localStorage.getItem(BKEY)||'{}'); const prev=d[s];
    const el=document.getElementById('prevSize');
    if(prev){ el.style.display='block'; el.textContent=`✓ مقاسك السابق لهذا المنتج: ${prev.size}`; }
  }catch{}
}
function fillSaved(){
  const saved=getSaved(); const data=SIZE_DATA[sku]; if(!data||!data.score) return;
  SCORE_ORDER.filter(k=>data.score[k]).forEach(k=>{
    const inp=document.getElementById('inp_'+k); const v=saved[k];
    if(inp&&v!==undefined) inp.value=unit==='in'?(Number.isInteger(v)?v:+v.toFixed(1)):Math.round(i2c(v));
  });
}
window.mlhcSaveConfirm = function(){
  document.getElementById('saveBtn').style.display  = 'none';
  document.getElementById('savedOk').style.display  = 'inline';
  setTimeout(()=>{
    document.getElementById('saveBtn').style.display = 'inline-block';
    document.getElementById('savedOk').style.display = 'none';
  }, 2000);
};

// ─── فتح / إغلاق الدرور ───────────────────────────────────────────────────
let mlhcPreviousBodyOverflow = '';
window.mlhcOpen = function(){
  document.getElementById('mlhcOv').classList.add('open');
  document.getElementById('mlhcDrawer').classList.add('open');
  mlhcPreviousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  // إذا لم يُحمَّل SKU بعد (مثلاً أول مرة تُفتح)
  if(!sku){
    const pageSku = getSkuFromPage();
    if(pageSku) loadSku(extractSku(pageSku), pageSku);
  }
};
window.mlhcClose = function(){
  const overlay = document.getElementById('mlhcOv');
  const drawer = document.getElementById('mlhcDrawer');
  if (!overlay || !drawer || !drawer.classList.contains('open')) return;
  overlay.classList.remove('open');
  drawer.classList.remove('open');
  document.body.style.overflow = mlhcPreviousBodyOverflow;
};
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && typeof window.mlhcClose === 'function') mlhcClose(); });

// ─── حقن زر "اعرفي مقاسك" ────────────────────────────────────────────────
function injectTriggerBtn(){
  if(document.getElementById('mlhcTrigger')) return;

  // أضف البنر فوق خيار المقاسات مباشرة
  const sizeEl = document.querySelector('salla-product-options');
  if(sizeEl){
    const banner = document.createElement('button');
    banner.id = 'mlhcTrigger';
    banner.type = 'button';
    banner.onclick = mlhcOpen;
    banner.style.cssText = 'display:flex;align-items:center;justify-content:center;text-align:center;gap:8px;direction:rtl;font-family:Zain,-apple-system,sans-serif;font-size:13px;font-weight:500;color:#9d3d38;background:#fdf6f5;padding:12px 16px;border-radius:10px;width:100%;box-sizing:border-box;border:none;margin-bottom:16px;cursor:pointer;letter-spacing:.2px';
    banner.innerHTML = '<i class="sicon-ruler" style="font-size:17px;line-height:1"></i><span style="display:flex;align-items:center">اعرفي مقاسك</span>';
    sizeEl.insertAdjacentElement('beforebegin', banner);
    return;
  }

  // fallback: أضف الزر بجانب رقم الموديل
  const btn = document.createElement('button');
  btn.id = 'mlhcTrigger';
  btn.type = 'button';
  btn.onclick = mlhcOpen;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/></svg>اعرفي مقاسك';
  const skuEl = document.querySelector('.product-sku,[itemprop="sku"]');
  if(skuEl&&skuEl.parentElement) skuEl.parentElement.after(btn);
}

// ─── التهيئة التلقائية عند تحميل الصفحة ──────────────────────────────────
(async function init(){
  // جلب بيانات القياسات
  await fetchSizeData().catch(e=>console.warn('mlhc fetch error',e));

  // إخفاء شاشة التحميل وإظهار المحتوى
  document.getElementById('mlhcLoad').classList.remove('show');
  document.getElementById('mlhcMain').style.display = '';

  // شعار المتجر
  try{
    const logo = window.salla?.config?.get?.('store.logo')
      || window.Salla?.store?.get?.()?.logo
      || document.querySelector('header img.logo,img.site-logo,.store-logo img')?.src;
    if(logo) document.getElementById('storeLogo').src = logo;
  }catch(e){}

  // قراءة SKU وتحميل بيانات المنتج مسبقاً (قبل أن تفتح العميلة الدرور)
  const pageSku = getSkuFromPage();
  if(pageSku) loadSku(extractSku(pageSku), pageSku);

  // إضافة زر الفتح بجانب المقاسات
  injectTriggerBtn();
  setTimeout(injectTriggerBtn, 2000);
})();

})();






/* ######################################################################
   FILTERS
   ###################################################################### */

/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
    MLEHA — Filter Popup
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

(function mlehaGucciStyleFilterDrawer() {
  if (!isMlehaListingPage()) return;

  if (window.__mlehaFilterDrawer?.destroy) {
    window.__mlehaFilterDrawer.destroy();
  }

  document.querySelectorAll('.mleha-filter-shell, .mleha-filter-trigger').forEach(element => {
    element.remove();
  });
  document.body.classList.remove('mleha-filter-enhanced', 'mleha-filter-lock');

  const LABELS = {
    filters: '\u0627\u0644\u0641\u0644\u0627\u062a\u0631',
    clearAll: '\u0645\u0633\u062d \u0627\u0644\u0643\u0644',
    showItems: '\u0639\u0631\u0636 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a',
    close: '\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0641\u0644\u0627\u062a\u0631'
  };

  const STATE = {
    mounted: false,
    boundEvents: false,
    shell: null,
    drawer: null,
    content: null,
    trigger: null,
    count: null,
    triggerCount: null,
    clearButton: null,
    showButton: null,
    filters: null,
    closeTimer: null,
    originalParent: null,
    originalNextSibling: null,
    toolbarRow: null,
    openWidgetKey: '',
    cleanup: []
  };

  function runWhenReady(fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  function getFiltersElement() {
    return document.querySelector('#filters-menu');
  }

  function getProductsList() {
    return document.querySelector('salla-products-list');
  }

  function isListingPageReady() {
    return !!getFiltersElement() && !!getProductsList();
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function getToolbarPlacement() {
    const sortBar = document.querySelector('.main-content .center-between');

    if (sortBar) {
      let row = sortBar.closest('.mleha-filter-toolbar-row');

      if (!row) {
        row = createElement('div', 'mleha-filter-toolbar-row');
        sortBar.parentElement.insertBefore(row, sortBar);
        row.appendChild(sortBar);
      }

      STATE.toolbarRow = row;
      return { parent: row, before: row.firstChild };
    }

    const fallback = (
      document.querySelector('.main-content .mb-4, .main-content .sm\\:mb-6') ||
      document.querySelector('.main-content') ||
      document.querySelector('salla-products-list')?.parentElement
    );

    return fallback ? { parent: fallback, before: fallback.firstChild } : null;
  }

  function ensureTrigger() {
    if (STATE.trigger && document.body.contains(STATE.trigger)) return;

    const placement = getToolbarPlacement();
    if (!placement) return;
    if (Array.from(placement.parent.children).some(child => child.classList.contains('mleha-filter-trigger'))) return;

    const trigger = createElement('button', 'mleha-filter-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'mleha-filter-drawer');

    const icon = createElement('i', 'sicon-filter');
    const label = createElement('span', '', LABELS.filters);
    const count = createElement('span', 'mleha-filter-trigger-count');

    trigger.appendChild(icon);
    trigger.appendChild(label);
    trigger.appendChild(count);
    trigger.addEventListener('click', openDrawer);

    placement.parent.insertBefore(trigger, placement.before);

    STATE.trigger = trigger;
    STATE.triggerCount = count;
  }

  function buildShell() {
    if (STATE.shell && document.body.contains(STATE.shell)) return;

    const shell = createElement('div', 'mleha-filter-shell');
    const overlay = createElement('div', 'mleha-filter-overlay');
    const drawer = createElement('aside', 'mleha-filter-drawer');
    const close = createElement('button', 'mleha-filter-close');
    const panel = createElement('div', 'mleha-filter-panel');
    const heading = createElement('div', 'mleha-filter-heading');
    const titleWrap = createElement('div', 'mleha-filter-title-wrap');
    const title = createElement('h2', 'mleha-filter-title', LABELS.filters);
    const count = createElement('span', 'mleha-filter-active-count');
    const clearButton = createElement('button', 'mleha-filter-clear', LABELS.clearAll);
    const content = createElement('div', 'mleha-filter-content');
    const footer = createElement('div', 'mleha-filter-footer');
    const showButton = createElement('button', 'mleha-filter-show', LABELS.showItems);
    const closeIcon = createElement('i', 'sicon-cancel');

    shell.setAttribute('aria-hidden', 'true');
    drawer.id = 'mleha-filter-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', LABELS.filters);

    close.type = 'button';
    close.setAttribute('aria-label', LABELS.close);
    close.appendChild(closeIcon);

    clearButton.type = 'button';
    showButton.type = 'button';

    titleWrap.appendChild(title);
    titleWrap.appendChild(count);
    heading.appendChild(titleWrap);
    heading.appendChild(close);
    footer.appendChild(showButton);
    footer.appendChild(clearButton);
    panel.appendChild(heading);
    panel.appendChild(content);
    panel.appendChild(footer);
    drawer.appendChild(panel);
    shell.appendChild(overlay);
    shell.appendChild(drawer);
    document.body.appendChild(shell);

    overlay.addEventListener('click', closeDrawer);
    close.addEventListener('click', closeDrawer);
    showButton.addEventListener('click', closeDrawer);
    clearButton.addEventListener('click', resetFilters);

    STATE.shell = shell;
    STATE.drawer = drawer;
    STATE.content = content;
    STATE.count = count;
    STATE.clearButton = clearButton;
    STATE.showButton = showButton;
  }

  function mountFilters() {
    const filters = getFiltersElement();
    if (!filters || !STATE.content) return;

    if (!STATE.originalParent && filters.parentElement !== STATE.content) {
      STATE.originalParent = filters.parentElement;
      STATE.originalNextSibling = filters.nextSibling;
    }

    if (filters.parentElement !== STATE.content) {
      STATE.content.appendChild(filters);
    }

    filters.dataset.mlehaDrawerMounted = '1';
    STATE.filters = filters;
  }

  function activeInputs() {
    if (!STATE.filters) return [];

    return Array.from(STATE.filters.querySelectorAll('input:checked')).filter(input => {
      const name = (input.getAttribute('name') || '').trim();
      return name !== 'category_id';
    });
  }

  function activeCount() {
    return activeInputs().length;
  }

  function syncWidgetSelections() {
    if (!STATE.filters) return;

    STATE.filters.querySelectorAll('salla-filters-widget').forEach(widget => {
      if (isRatingWidget(widget)) return;

      const selected = Array.from(widget.querySelectorAll('input:checked')).some(input => {
        const name = (input.getAttribute('name') || '').trim();
        return name !== 'category_id';
      });

      widget.classList.toggle('mleha-filter-widget-has-selection', selected);
    });
  }

  function widgetKey(widget) {
    const title = widget?.querySelector?.('.s-filters-widget-title');
    const label = title?.querySelector('span:first-child')?.textContent || title?.textContent || '';
    return label.replace(/[+\-\u2212]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isRatingWidget(widget) {
    const key = widgetKey(widget || document.createElement('div'));

    return !!(
      widget?.querySelector?.('.s-rating-stars-wrapper') ||
      key.includes('\u0627\u0644\u062a\u0642\u064a\u064a\u0645') ||
      key.toLowerCase().includes('rating')
    );
  }

  function toggleWidget(widget) {
    const open = !widget.classList.contains('mleha-filter-widget-open');
    const content = widget.querySelector('.s-filters-widget-content');

    if (content && open) {
      content.style.setProperty('--mleha-content-h', content.scrollHeight + 'px');
    }

    widget.classList.toggle('mleha-filter-widget-open', open);
    const icon = widget.querySelector('.mleha-filter-accordion-icon');
    if (icon) icon.textContent = open ? '−' : '+';
    widget.setAttribute('aria-expanded', String(open));
    widget.querySelector('.s-filters-widget-title')?.setAttribute('aria-expanded', String(open));
  }

  function prepareWidgets() {
    if (!STATE.filters) return;

    const widgets = Array.from(STATE.filters.querySelectorAll('salla-filters-widget'));

    widgets.forEach((widget, index) => {
      if (isRatingWidget(widget)) {
        widget.style.setProperty('display', 'none', 'important');
        return;
      }

      if (!widget.querySelector('.s-filters-widget-container')) {
        widget.style.setProperty('border-top', '1px solid var(--mleha-filter-line)', 'important');
        if (index === widgets.length - 1) {
          widget.style.setProperty('border-bottom', '1px solid var(--mleha-filter-line)', 'important');
        }
      }

      const title = widget.querySelector('.s-filters-widget-title');
      if (!title) return;

      title.querySelectorAll('.mleha-filter-accordion-icon').forEach((icon, index) => {
        if (index > 0) icon.remove();
      });

      let icon = title.querySelector('.mleha-filter-accordion-icon');
      if (!icon) {
        icon = createElement('span', 'mleha-filter-accordion-icon');
        icon.setAttribute('aria-hidden', 'true');
        title.appendChild(icon);
      }

      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');

      if (!widget.dataset.mlehaAccordionBound) {
        const handleTitleToggle = event => {
          // Do not suppress Salla's own capture/bubble handlers. The earlier
          // stopImmediatePropagation left its web component in a stale state.
          toggleWidget(widget);
        };

        const handleTitleKeydown = event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          handleTitleToggle(event);
        };

        title.addEventListener('click', handleTitleToggle, true);
        title.addEventListener('keydown', handleTitleKeydown, true);
        STATE.cleanup.push(() => title.removeEventListener('click', handleTitleToggle, true));
        STATE.cleanup.push(() => title.removeEventListener('keydown', handleTitleKeydown, true));
        widget.dataset.mlehaAccordionBound = '1';
      }
    });
  }

  function syncWidgetOpenStates() {
    if (!STATE.filters) return;

    prepareWidgets();

    STATE.filters.querySelectorAll('salla-filters-widget').forEach(widget => {
      const open = widget.classList.contains('mleha-filter-widget-open');
      const icon = widget.querySelector('.mleha-filter-accordion-icon');

      if (icon) icon.textContent = open ? '−' : '+';
      widget.setAttribute('aria-expanded', String(open));
      widget.querySelector('.s-filters-widget-title')?.setAttribute('aria-expanded', String(open));
    });
  }

  function closeOtherWidgets(activeWidget) {
    if (!STATE.filters || !activeWidget) return;

    STATE.filters.querySelectorAll('salla-filters-widget').forEach(widget => {
      if (widget === activeWidget) return;

      widget.classList.remove('mleha-filter-widget-open');
      const icon = widget.querySelector('.mleha-filter-accordion-icon');
      if (icon) icon.textContent = '+';
      widget.setAttribute('aria-expanded', 'false');
      widget.querySelector('.s-filters-widget-title')?.setAttribute('aria-expanded', 'false');
    });
  }
  function updateCounts() {
    const count = activeCount();
    const visible = count > 0;

    if (STATE.count) {
      STATE.count.textContent = String(count);
      STATE.count.classList.toggle('is-visible', visible);
    }

    if (STATE.triggerCount) {
      STATE.triggerCount.textContent = String(count);
      STATE.triggerCount.classList.toggle('is-visible', visible);
    }

    if (STATE.clearButton) {
      STATE.clearButton.disabled = !visible;
    }

    syncWidgetSelections();
    syncWidgetOpenStates();
  }

  function openDrawer(event) {
    if (event) event.preventDefault();
    if (!STATE.shell) return;

    window.clearTimeout(STATE.closeTimer);
    mountFilters();
    updateCounts();
    STATE.shell.classList.remove('is-closing');
    STATE.shell.classList.add('is-open');
    STATE.shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mleha-filter-lock');
    prepareWidgets();
    syncWidgetOpenStates();

    window.setTimeout(() => {
      STATE.drawer?.querySelector('.mleha-filter-close')?.focus({ preventScroll: true });
    }, 180);
  }

  function closeDrawer() {
    if (!STATE.shell) return;

    window.clearTimeout(STATE.closeTimer);
    STATE.shell.classList.remove('is-open');
    STATE.shell.classList.add('is-closing');
    STATE.shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mleha-filter-lock');
    STATE.trigger?.focus({ preventScroll: true });

    STATE.closeTimer = window.setTimeout(() => {
      STATE.shell?.classList.remove('is-closing');
    }, 560);
  }

  function resetFilters() {
    if (!STATE.filters || !activeCount()) return;

    if (typeof STATE.filters.resetFilters === 'function') {
      STATE.filters.resetFilters();
    } else {
      const resetButton = STATE.filters.querySelector('.s-filters-footer button, .s-filters-footer salla-button button, .s-filters-footer salla-button');
      resetButton?.click();
    }

    window.setTimeout(updateCounts, 500);
  }

  function bindRuntimeEvents() {
    if (STATE.boundEvents) return;
    STATE.boundEvents = true;

    const handleChange = event => {
      if (STATE.filters?.contains(event.target)) {
        const widget = event.target.closest('salla-filters-widget');
        if (widget) {
          STATE.openWidgetKey = widgetKey(widget);
          widget.classList.add('mleha-filter-widget-open');
          const icon = widget.querySelector('.mleha-filter-accordion-icon');
          if (icon) icon.textContent = '-';
        }
        window.setTimeout(updateCounts, 80);
        window.setTimeout(() => {
          prepareWidgets();
          syncWidgetOpenStates();
        }, 300);
      }
    };

    const handleFilterClick = event => {
      if (STATE.filters?.contains(event.target)) {
        const title = event.target.closest('.s-filters-widget-title');
        const widget = event.target.closest('salla-filters-widget');

        if (title && widget) {
          return;
        } else if (widget) {
          STATE.openWidgetKey = widgetKey(widget);
          widget.classList.add('mleha-filter-widget-open');
        }

        window.setTimeout(updateCounts, 160);
      }
    };

    const handleKeydown = event => {
      if (event.key === 'Escape' && STATE.shell?.classList.contains('is-open')) {
        closeDrawer();
      }
    };

    document.addEventListener('change', handleChange, true);
    document.addEventListener('click', handleFilterClick, true);
    document.addEventListener('keydown', handleKeydown);

    const handlePopstate = () => window.setTimeout(updateCounts, 300);
    window.addEventListener('popstate', handlePopstate);

    STATE.cleanup.push(
      () => document.removeEventListener('change', handleChange, true),
      () => document.removeEventListener('click', handleFilterClick, true),
      () => document.removeEventListener('keydown', handleKeydown),
      () => window.removeEventListener('popstate', handlePopstate)
    );

    if (window.salla?.event?.on) {
      const handleSallaFiltersUpdate = () => {
        window.setTimeout(() => { prepareWidgets(); updateCounts(); }, 300);
      };

      salla.event.on('salla-filters::changed', handleSallaFiltersUpdate);
      salla.event.on('filters::fetched', handleSallaFiltersUpdate);
      salla.event.on('salla-filters::reset', handleSallaFiltersUpdate);
    }
  }

  function setup() {
    if (!isListingPageReady()) return;

    document.body.classList.add('mleha-filter-enhanced');
    buildShell();
    ensureTrigger();
    mountFilters();
    prepareWidgets();
    bindRuntimeEvents();
    updateCounts();
    STATE.mounted = true;
  }

  function destroy() {
    window.clearTimeout(STATE.closeTimer);
    STATE.cleanup.forEach(cleanup => cleanup());
    STATE.cleanup = [];
    STATE.trigger?.remove();
    STATE.shell?.remove();
    if (STATE.toolbarRow?.parentElement) {
      const sortBar = STATE.toolbarRow.querySelector('.center-between');
      if (sortBar) STATE.toolbarRow.parentElement.insertBefore(sortBar, STATE.toolbarRow);
      STATE.toolbarRow.remove();
    }
    document.body.classList.remove('mleha-filter-enhanced', 'mleha-filter-lock');

    if (STATE.filters && STATE.originalParent && document.body.contains(STATE.originalParent)) {
      const nextSibling = STATE.originalNextSibling?.parentElement === STATE.originalParent ? STATE.originalNextSibling : null;
      STATE.originalParent.insertBefore(STATE.filters, nextSibling);
      delete STATE.filters.dataset.mlehaDrawerMounted;
    }
  }

  window.__mlehaFilterDrawer = { destroy };

  runWhenReady(function initMlehaFilterDrawer() {
    setup();

    if (STATE.mounted) return;

    const timer = window.setInterval(() => {
      setup();
      if (STATE.mounted) window.clearInterval(timer);
    }, 300);

    window.setTimeout(() => window.clearInterval(timer), 10000);
  });
})();



/* ######################################################################
   CART
   ###################################################################### */

/* =====================================
   3. CART PAGE MODIFICATIONS
===================================== */

// 3.1 صندوق الموافقة على الشروط والأحكام
(function termsAndConditionsCheckbox() {
  if (!isMlehaCartPage()) return;

  function setup() {
    const checkoutWrap = document.querySelector('.cart-submit-wrap');
    const checkoutBtn = document.querySelector('#cart-submit button');
    if (!checkoutWrap || !checkoutBtn) return false;

    if (!document.getElementById('agreeTerms')) {
      const box = document.createElement('div');
      box.className = 'terms-box';

      const label = document.createElement('label');
      label.className = 'terms-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'agreeTerms';

      const text = document.createElement('span');
      text.innerHTML = `
        أقر بأنني قرأت وأوافق على 
        <a href="https://mleha.com/ar/return-policy/page-1302158389" target="_blank">سياسة الاستبدال والاسترجاع</a> و
        <a href="https://mleha.com/ar/shipping-policy/page-692100276" target="_blank">سياسة الشحن والتوصيل</a>
      `;

      label.appendChild(checkbox);
      label.appendChild(text);
      box.appendChild(label);
      checkoutWrap.prepend(box);
    }

    const checkbox = document.getElementById('agreeTerms');
    if (!checkbox) return false;
    if (checkoutBtn.dataset.mlehaTermsBound === '1') return true;

    const handleCheckout = function (e) {
      if (!checkbox.checked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showTermsMessage();
      }
    };

    const updateButtonState = () => {
      if (!checkbox.checked) {
        checkoutBtn.style.opacity = '0.5';
        checkoutBtn.style.cursor = 'not-allowed';
      } else {
        checkoutBtn.style.opacity = '1';
        checkoutBtn.style.cursor = 'pointer';
      }
    };

    checkoutBtn.addEventListener('click', handleCheckout, true);
    checkbox.addEventListener('change', updateButtonState);
    checkoutBtn.dataset.mlehaTermsBound = '1';
    updateButtonState();
    return true;
  }

  function showTermsMessage() {
    if (document.getElementById('terms-msg')) return;

    const msg = document.createElement('div');
    msg.id = 'terms-msg';
    msg.innerText = 'يجب الموافقة على الشروط والأحكام لإتمام الطلب';
    msg.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #000;
      color: #fff;
      padding: 12px 20px;
      border-radius: 10px;
      z-index: 9999;
      font-size: var(--text-label);
      font-weight: var(--fw-regular);
      line-height: var(--lh-label);
    `;
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 2500);
  }

  let observer = null;
  const attemptSetup = () => {
    if (setup() && observer) observer.disconnect();
  };
  observer = observeDOM(attemptSetup);
  onReady(attemptSetup);
  setTimeout(() => observer?.disconnect(), 10000);
})();

// 3.2 تعديل نص "الإجمالي" إلى "الإجمالي (شامل الضريبة)"
onReady(function updateTotalLabel() {
  const label = document.querySelector('.flex.justify-between.text-lg.mb-5 span.text-store-text-secondary');
  if (label && label.textContent.trim() === 'الإجمالي') {
    label.textContent = 'الإجمالي (شامل الضريبة)';
  }
});

// 3.3 إخفاء عبارات "الأسعار شاملة للضريبة" و "السعر شامل الضريبه"
onReady(function hideTaxMessages() {
  document.querySelectorAll('.text-store-text-secondary').forEach(el => {
    if (el.textContent.includes('الأسعار شاملة للضريبة')) {
      el.remove();
    }
  });

  document.querySelectorAll('*').forEach(el => {
    if (el.textContent.trim() === 'السعر شامل الضريبه') {
      el.style.display = 'none';
    }
  });
});

// 3.4 صندوق التغليف المجاني عند الوصول للحد الأدنى
if (location.href.startsWith('https://mleha.com/ar/cart')) {
  (function freeGiftBoxOnThreshold() {
    const SUBTOTAL_THRESHOLD = 346.95;
    const PRODUCT_OPTIONS_SELECTOR = 'salla-product-options[product-id="3014694887033630745"]';
    const BADGE_ID = 'ml-free-box-badge';

    const style = document.createElement('style');
    style.textContent = `
      #${BADGE_ID} {
        display: flex; align-items: center; gap: 10px;
        background: #f9f5f5;
        border: 1px solid #f0d9d8;
        color: #9d3d38;
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 10px;
        font-size: var(--text-label);
        font-weight: var(--fw-bold);
        line-height: var(--lh-label);
        direction: rtl;
        box-shadow: 0 6px 14px rgba(0,0,0,0.06);
        transform: translateY(0);
        transition: transform .2s ease, opacity .2s ease;
        opacity: 1;
      }
      #${BADGE_ID}.is-hidden { opacity: 0; transform: translateY(-4px); }
      #${BADGE_ID} .icon {
        width: 22px; height: 22px; border-radius: 6px;
        background: #9d3d38; color: #fff;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: var(--text-label); flex: 0 0 22px;
      }
      #${BADGE_ID} .text { line-height: 1.35; }
      #${BADGE_ID} .hl { background: #9d3d38; color: #fff; padding: 2px 6px; border-radius: 8px; margin: 0 2px; }
      #${BADGE_ID} .sub {
        font-weight: var(--fw-regular);
        opacity: .9;
        font-size: 12px;
        line-height: 18px;
        display:block;
        margin-top:2px;
      }
    `;
    document.head.appendChild(style);

    const parsePrice = (txt) => {
      if (!txt) return NaN;
      let s = txt.replace(/[^\d,.\-]/g, '');
      if (/,/.test(s) && /,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
      return parseFloat(s);
    };

    function findSubtotalEl() {
      const candidates = [
        '[data-cart-subtotal]',
        '.summary__subtotal .price',
        '.cart-summary .subtotal .price',
        '.cart-summary [data-value="subtotal"]',
        '.s-cart-summary [data-price]',
        '.cart__summary .price',
        '[data-cart-total]'
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && /\d/.test(el.textContent)) return el;
      }
      return null;
    }

    function getSubtotal() {
      const el = findSubtotalEl();
      return el ? parsePrice(el.textContent) : NaN;
    }

    function getOptionsContainer() {
      const opts = document.querySelector(PRODUCT_OPTIONS_SELECTOR);
      if (!opts) return null;
      return opts.querySelector('.s-product-options-option-container') ||
             opts.querySelector('.s-product-options-wrapper') ||
             opts;
    }

    function removeDuplicateBadge() {
      const all = Array.from(document.querySelectorAll(`#${BADGE_ID}`));
      if (all.length > 1) all.slice(1).forEach(n => n.remove());
    }

    function ensureUI(meets) {
      const container = getOptionsContainer();
      if (!container) return;
      removeDuplicateBadge();

      let badge = document.getElementById(BADGE_ID);
      if (meets) {
        container.style.display = 'none';
        if (!badge) {
          badge = document.createElement('div');
          badge.id = BADGE_ID;
          badge.className = 'is-hidden';
          badge.innerHTML = `
            <span class="icon" aria-hidden="true">🎁</span>
            <span class="text">
              صندوق التغليف الفاخر <span class="hl">مجّاني</span> مع طلبك
              <span class="sub">المجموع وصل إلى<b>٣٩٩</b> (شامل الضريبة) أو أكثر</span>
            </span>
          `;
          container.parentNode.prepend(badge);
          requestAnimationFrame(() => badge.classList.remove('is-hidden'));
        } else {
          badge.classList.remove('is-hidden');
        }
      } else {
        container.style.display = '';
        if (badge) {
          badge.classList.add('is-hidden');
          setTimeout(() => {
            const b = document.getElementById(BADGE_ID);
            if (b) b.remove();
          }, 200);
        }
      }
      removeDuplicateBadge();
    }

    function refresh() {
      const subtotal = getSubtotal();
      if (isNaN(subtotal)) return;
      ensureUI(subtotal + 0.001 >= SUBTOTAL_THRESHOLD);
    }

    refresh();
    observeDOM(() => {
      clearTimeout(refresh._t);
      refresh._t = setTimeout(refresh, 120);
    });
    setTimeout(refresh, 600);
    setTimeout(refresh, 1500);
  })();
}




/* ######################################################################
   MARKETING POPUPS
   ###################################################################### */

/* =====================================
   7. POPUP MODAL (خصم للمستخدمين الجدد)
===================================== */
(function discountPopupModal() {
  const DISMISS_KEY = 'bcio_modal_dismissed_until';
  const AUTO_SHOW_DELAY_MS = 3000;

  const isDismissed = () => {
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      return v && Date.now() < Number(v);
    } catch {
      return false;
    }
  };

  const dismissForToday = () => {
    try {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      localStorage.setItem(DISMISS_KEY, String(endOfDay.getTime()));
    } catch {}
  };

  if (isDismissed()) return;

  onReady(() => {
    const container = document.createElement('div');
    container.id = 'bcio-popups';
    container.style.cssText = `
      z-index: 1000000;
      position: fixed;
      inset-block-start: 0;
      inset-inline-start: 0;
    `;
    document.body.appendChild(container);

    const overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'bcio__popupRoot');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.5);
      display: none;
      justify-content: center;
      align-items: center;
      direction: rtl;
      z-index: 1000002;
    `;

    const style = document.createElement('style');
    style.innerHTML = `
      #bcio-popups h1,
      #bcio-popups h2,
      #bcio-popups p {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
    `;
    overlay.appendChild(style);

    const modal = document.createElement('div');
    modal.style.cssText = `
      display: flex;
      flex-direction: column-reverse;
      width: 90%;
      height: 382px;
      max-width: 400px;
      max-height: 450px;
      background: #eeeeee;
      box-shadow: rgba(0, 0, 0, 0.3) 0 2px 5px;
      position: relative;
      border: none;
      border-radius: 4px;
      align-items: stretch;
      justify-content: stretch;
    `;

    const closeBtn = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeBtn.setAttribute('width', '18');
    closeBtn.setAttribute('height', '18');
    closeBtn.setAttribute('viewBox', '0 0 18 18');
    closeBtn.setAttribute('role', 'button');
    closeBtn.style.cssText = `
      position: absolute;
      inset-inline-end: 1rem;
      top: 1rem;
      cursor: pointer;
    `;
    closeBtn.innerHTML = `
      <rect width="18" height="18" rx="9" fill="white" fill-opacity="0.4"></rect>
      <path d="M10.9425 6L9 7.9425L7.0575 6L6 7.0575L7.9425 9L6 10.9425L7.0575 12L9 10.0575L10.9425 12L12 10.9425L10.0575 9L12 7.0575L10.9425 6Z
               M9 1.5C4.8525 1.5 1.5 4.8525 1.5 9C1.5 13.1475 4.8525 16.5 9 16.5C13.1475 16.5 16.5 13.1475 16.5 9C16.5 4.8525 13.1475 1.5 9 1.5Z
               M9 15C5.6925 15 3 12.3075 3 9C3 5.6925 5.6925 3 9 3C12.3075 3 15 5.6925 15 9C15 12.3075 12.3075 15 9 15Z"
            fill="black" fill-opacity="0.6"></path>
    `;

    const textArea = document.createElement('div');
    textArea.style.cssText = `
      flex: 3 1 0%;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 0 2em 2em 2em;
      gap: 1em;
    `;
    textArea.innerHTML = `
      <h2 style="color:#000;">
        يا هلا وغلا بالمليحة 💛
      </h2>
      <h2 style="color:#000;">
        جهزّنا لك كود شحن مجاني على طلبك الأول 🎁
      </h2>
      <h2 style="color:#000;">
        استخدميه قبل ما ينتهي 👇
      </h2>
      <a
        href="https://wa.me/966531349631?text=مرحبا! أود الحصول على كود الشحن المجاني!"
        target="_blank"
        style="
          background-color:#9d3d38;
          padding:1em 2em;
          border-radius:4px;
          min-width:70%;
          border:none;
          color:#fff;
          cursor:pointer;
          display:inline-block;
          text-decoration:none;
        "
      >
        احصل على كود الشحن المجاني
      </a>
      <p
        style="
          color:#7a7986;
          font-family:sans-serif;
        "
      >
        * بتعبئة هذا النموذج، ستقوم بالتسجيل لتلقي رسائلنا على الواتساب ويمكنك إلغاء الاشتراك في أي وقت.
      </p>
    `;

    const imageArea = document.createElement('div');
    imageArea.style.cssText = `
      flex: none;
      height: 65px;
      background-color: #EEE2D4;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    `;

    const img = document.createElement('img');
    img.src = 'https://cdn.salla.sa/cdn-cgi/image/fit=scale-down,width=400,height=400,onerror=redirect,format=auto/AzEboQ/fvTE4nMRp8E2TspQVyR6HYuaRnDIsiEelEnlruyT.png';
    img.alt = 'mleha logo';
    img.loading = 'lazy';
    img.style.cssText = `
      height: 45px;
      width: auto;
      object-fit: contain;
      background: transparent;
    `;
    imageArea.appendChild(img);

    modal.appendChild(closeBtn);
    modal.appendChild(textArea);
    modal.appendChild(imageArea);
    overlay.appendChild(modal);
    container.appendChild(overlay);

    const openModal = () => {
      if (isDismissed()) return;
      overlay.style.display = 'flex';
    };

    const closeModal = () => {
      overlay.style.display = 'none';
      dismissForToday();
    };

    closeBtn.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display === 'flex') {
        closeModal();
      }
    });

    const scheduleOpen = () => {
      if (isDismissed()) return;
      setTimeout(openModal, AUTO_SHOW_DELAY_MS);
    };

    if (window.scrollY > 0) {
      scheduleOpen();
    } else {
      window.addEventListener('scroll', scheduleOpen, {
        once: true,
        passive: true,
      });
    }
  });
})();





/* ######################################################################
   FOOTER
   ###################################################################### */

/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
   MLEHA FOOTER
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

(function () {function buildMlehaFooter() {const footer = document.querySelector("footer.store-footer");

if (!footer || footer.dataset.mlehaFooterReady === "true") return;

footer.dataset.mlehaFooterReady = "true";
footer.classList.add("mleha-footer");

const isMlehaEnglish = (document.documentElement.lang || "ar").toLowerCase().startsWith("en");
const mlehaLanguageLabel = isMlehaEnglish ? "Language" : "اللغة";
const mlehaCurrencyLabel = isMlehaEnglish ? "Currency" : "العملة";

footer.innerHTML = `
  <div class="mleha-footer-wrapper">

    <!-- ===========================
      SECTION 1: LOGO + DESCRIPTION
    =============================-->
    <section class="mleha-footer-section mleha-footer-brand-section">
      <div class="mleha-footer-brand">
        <img
          src="https://cdn.salla.sa/AzEboQ/fvTE4nMRp8E2TspQVyR6HYuaRnDIsiEelEnlruyT.png"
          alt="شعار مليحة"
          class="mleha-footer-logo"
        >

        <div class="mleha-footer-description">
          قل للمليحة: في كل فستانٍ قصة… وفي كل تصميمٍ نخلق الجمال لأجلك<br>
          مليحة® علامة تجارية مسجلة<br>
          براند سعودي نفتخر به
        </div>
      </div>
    </section>


    <!-- ===========================
      SECTION 2: LINKS + CERTIFICATES
    =============================-->
    <section class="mleha-footer-section mleha-footer-content-section">

      <!-- Footer Columns -->
      <div class="mleha-footer-columns">

        <!-- Important Links -->
<div class="mleha-footer-column mleha-footer-links">
  <h3>روابط مهمة</h3>

  <ul class="footer-list">
    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/1302158389">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a0183113cfa1a30b105ed06_footer-links-icons.png" alt="">
        </span>
        <span class="mleha-link-text">
          سياسة الاستبدال والاسترجاع
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/228417194">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018311efa9995df991afb3_footer-links-icons-1.png" alt="">
        </span>
        <span class="mleha-link-text">
          سياسة الأمان والخصوصية
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/2066594741">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a0183110a7e05389c2f88aa_footer-links-icons-2.png" alt="">
        </span>
        <span class="mleha-link-text">
          سياسة الاستخدام
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/692100276">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018311057ed24720c9973c_footer-links-icons-3.png" alt="">
        </span>
        <span class="mleha-link-text">
          معلومات الشحن
        </span>
      </a>
    </li>
  </ul>
</div>


<!-- Quick Links -->
<div class="mleha-footer-column mleha-footer-links">
  <h3>روابط سريعة</h3>

  <ul class="footer-list">
    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/867188649">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018312d2cb2e924a79ed91_footer-links-icons-7.png" alt="">
        </span>
        <span class="mleha-link-text">
          من نحن
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/1426774710">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a0183119e6041f6657bafb7_footer-links-icons-4.png" alt="">
        </span>
        <span class="mleha-link-text">
          التسويق بالعمولة
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://app.mleha.com/returns">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018311d08111503a6d4625_footer-links-icons-5.png" alt="">
        </span>
        <span class="mleha-link-text">
          تقديم طلب استبدال واسترجاع
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/1641801002">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018311cb633172cc3a086b_footer-links-icons-6.png" alt="">
        </span>
        <span class="mleha-link-text">
          طلبات الجملة
        </span>
      </a>
    </li>

    <li>
      <a class="mleha-link-card" target="_self" href="https://salla.sa/mleha/redirect/pages/1537524623">
        <span class="mleha-link-icon">
          <img src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/6a018312831b89035ae705fe_footer-links-icons-8.png" alt="">
        </span>
        <span class="mleha-link-text">
          اتصل بنا
        </span>
      </a>
    </li>
  </ul>
</div>


        <!-- Social Icons + Language & Currency (merged) -->
        <div class="mleha-footer-column mleha-footer-social">
          <h3>تابعنا</h3>

          <div class="social-icons social-icons--footer">
            <a href="mailto:info@mleha.com" aria-label="البريد الإلكتروني">
              <i class="sicon-mail"></i>
            </a>

            <a href="tel:+966531349631" aria-label="الجوال">
              <i class="sicon-iphone"></i>
            </a>

            <a href="https://wa.me/966531349631" target="_blank" aria-label="واتساب">
              <i class="sicon-whatsapp2"></i>
            </a>

            <a href="https://www.instagram.com/mleha_ksa" target="_blank" aria-label="Instagram">
              <i class="sicon-instagram"></i>
            </a>

            <a href="https://www.snapchat.com/add/mleha.sa" target="_blank" aria-label="Snapchat">
              <i class="sicon-snapchat"></i>
            </a>

            <a href="https://www.tiktok.com/@mleha_ksa" target="_blank" aria-label="TikTok">
              <i class="sicon-tiktok"></i>
            </a>
          </div>

          <div class="mleha-settings-container">
            <button
              type="button"
              class="mleha-setting-btn"
              onclick="salla.event.dispatch('localization::open')"
              aria-label="Change Language"
            >
              <i class="sicon-earth"></i>
              <span>${mlehaLanguageLabel}</span>
              <span class="sicon-keyboard_arrow_down"></span>
            </button>

            <button
              type="button"
              class="mleha-setting-btn"
              onclick="salla.event.dispatch('localization::open')"
              aria-label="Change Currency"
            >
              <i class="sicon-dollar-coin-stack"></i>
              <span>${mlehaCurrencyLabel}</span>
              <span class="sicon-keyboard_arrow_down"></span>
            </button>

            <salla-localization-modal language="ar" currency="SAR"></salla-localization-modal>
          </div>
        </div>

      </div>


      <!-- Certificates -->
      <div class="mleha-footer-certificates">

        <!-- Featured Certificate -->
        <a
          href="https://eauthenticate.saudibusiness.gov.sa/certificate-details/0000173932"
          target="_blank"
          class="mleha-cert-featured"
        >
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69ec914bda62ed0b44f36fc2_Group%2047217.png"
            alt="المركز السعودي للأعمال"
          >

          <div class="cert-text">
            <span class="title">موثق لدى منصة الاعمال</span>
            <span class="number">مركز الأعمال (التوثيق)<br>0000173932</span>
          </div>
        </a>


        <!-- Trademark Certificate -->
        <a
          href="https://fileintegration.saip.gov.sa/previewFile/1ab58835-e51c-444d-b799-e1a4c0632622/IPRs4TM/"
          target="_blank"
          class="mleha-cert-card"
        >
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69ec914b87c10691876a8eb7_Group-2.png"
            alt="الملكية الفكرية"
          >

          <div class="cert-text">
            <span class="title">شهادة العلامة التجارية</span>
            <span class="number">TM-01-00-10719-25</span>
          </div>
        </a>


        <!-- VAT Certificate -->
        <a
          href="https://cdn.salla.sa/AzEboQ/el01gdmTle3bLnCQqh7CdF7Xps6AHKvyOWLFKe7z.jpg"
          target="_blank"
          class="mleha-cert-card"
        >
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69ec914b7917eb31f4bf5e3a_Group-1.png"
            alt="الضريبة"
          >

          <div class="cert-text">
            <span class="title">الرقم الضريبي</span>
            <span class="number">311273037100003</span>
          </div>
        </a>


        <!-- Commercial Registration - No Hover -->
        <div class="mleha-cert-card mleha-cert-no-hover">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69ec914bcdfcf5606a7b01e2_Group.png"
            alt="وزارة التجارة"
          >

          <div class="cert-text">
            <span class="title">رقم السجل التجاري</span>
            <span class="number">7005805622</span>
          </div>
        </div>

      </div>

    </section>


    <!-- ===========================
      SECTION 3: COPYRIGHT + PAYMENT ICONS
    =============================-->
    <section class="mleha-footer-section mleha-footer-bottom-section">

      <div class="mleha-footer-rights">
        <p>
          © جميع الحقوق محفوظة لعلامة "مليحة" التجارية. استخدام الصور دون إذن يُعرّضك للمساءلة القانونية
        </p>
      </div>


      <ul class="s-payments-list mleha-payments-list">

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f89449cd3bffdac89f5f1d_Group%2047248.png"
            alt="mada"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f894484fb639b15911165f_Group%2047247.png"
            alt="mastercard"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f8944847c676c6807d0c37_Group%2047246.png"
            alt="visa"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f89448e839408d0f72a2d8_Group%2047245.png"
            alt="bank transfer"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f89448918729bc7d8a2251_Group%2047244.png"
            alt="stc bank"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f894481faf9249410103c5_Group%2047243.png"
            alt="apple pay"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f89448963df61f9f60241b_Group%2047242.png"
            alt="tabby"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f8944826254ddae3d5bc5f_Group%2047241.png"
            alt="tamara"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

        <li class="s-payments-list-item mleha-payment-item">
          <img
            src="https://cdn.prod.website-files.com/6770fed4a96f4cce9ae1348b/69f89448c24bb6998837ec0f_Group%2047240.png"
            alt="cash on delivery"
            loading="lazy"
            decoding="async"
            class="mleha-payment-icon"
          >
        </li>

      </ul>

    </section>

  </div>
`;

}

function initMlehaFooter() {buildMlehaFooter();

let attempts = 0;
const footerInterval = setInterval(function () {
  attempts++;
  buildMlehaFooter();

  if (
    document.querySelector("footer.store-footer[data-mleha-footer-ready='true']") ||
    attempts >= 20
  ) {
    clearInterval(footerInterval);
  }
}, 300);

}

if (document.readyState === "loading") {document.addEventListener("DOMContentLoaded", initMlehaFooter);} else {initMlehaFooter();}})();

/* ######################################################################
   FLOATING ACTION BUTTON
   ###################################################################### */

/* =====================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
   MLEHA — Floating Action Button (Unified Side Tab)
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
========================================
===================================== */

/*
  يبني شريطاً عمودياً موحّداً أسفل يمين الصفحة يكبر ليكشف أزرار التواصل
  بداخله (واتساب، اتصال، تيك توك، إنستقرام، العودة للأعلى)، ويستبدل زرّي
  سلة الأصليين (واتساب والعودة للأعلى المخفيّين عبر CSS).

  السلوك:
    - الضغط على رأس الشريط يفتح/يغلق (حركة grid-rows سلسة).
    - يُغلق عند النقر خارجه أو Escape أو عند اختيار أي إجراء أو زر X بالأسفل.
    - "العودة للأعلى" تظهر فقط بعد التمرير لأسفل.
    - يختفي الودجت أثناء فتح سلة السحب / قائمة الجوال / أي مودال.

  لإضافة/إزالة/إعادة ترتيب إجراء: عدّل مصفوفة ACTIONS بالأسفل.
*/

(function () {
  "use strict";

  if (window.__mlehaFabInit) return;      // guard against double-injection
  window.__mlehaFabInit = true;

  /* ---- Store contact details ---- */
  var PHONE = "966531349631";
  var WA_MESSAGE = "مرحباً، لدي استفسار بخصوص منتجاتكم";

  /* ---- Returns & exchange page ---- */
  var RETURN_URL = "https://app.mleha.com/returns";
  var RETURN_LABEL = "الاستبدال والاسترجاع";

  /* ---- Action buttons (order = top → bottom inside the open bar) ---- */
  var ACTIONS = [
    {
      cls: "mfab__item--whatsapp",
      icon: "sicon-whatsapp2",
      label: "تواصل عبر واتساب",
      href: "https://wa.me/" + PHONE + "?text=" + encodeURIComponent(WA_MESSAGE),
      target: "_blank"
    },
    {
      cls: "mfab__item--tiktok",
      icon: "sicon-tiktok",
      label: "تابعنا على تيك توك",
      href: "https://www.tiktok.com/@mleha_ksa",
      target: "_blank"
    },
    {
      cls: "mfab__item--instagram",
      icon: "sicon-instagram",
      label: "تابعنا على إنستقرام",
      href: "https://www.instagram.com/mleha_ksa",
      target: "_blank"
    },
    {
      cls: "mfab__item--top",
      icon: "",                 /* CSS-drawn chevron (see .mfab__chevron-up) */
      label: "العودة للأعلى",
      action: "top"
    }
  ];

  function buildActionEl(a) {
    var el = document.createElement(a.href ? "a" : "button");
    el.className = "mfab__item " + a.cls;
    el.setAttribute("aria-label", a.label);
    el.setAttribute("title", a.label);
    el.innerHTML = a.icon
      ? '<i class="' + a.icon + '" aria-hidden="true"></i>'
      : '<span class="mfab__chevron-up" aria-hidden="true"></span>';

    if (a.href) {
      el.href = a.href;
      if (a.target) {
        el.target = a.target;
        el.rel = "noopener";
      }
    } else {
      el.type = "button";
    }
    if (a.action === "top") {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    return el;
  }

  function build() {
    if (document.querySelector(".mfab")) return;

    var root = document.createElement("div");
    root.className = "mfab";

    var bar = document.createElement("div");
    bar.className = "mfab__bar";

    var head = document.createElement("button");
    head.type = "button";
    head.className = "mfab__head";
    head.setAttribute("aria-label", "تواصل معنا");
    head.setAttribute("aria-expanded", "false");
    head.innerHTML =
      '<svg class="mfab__head-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      '<span class="mfab__head-text">تواصل معنا</span>';

    var wrap = document.createElement("div");
    wrap.className = "mfab__items-wrap";
    var items = document.createElement("div");
    items.className = "mfab__items";
    ACTIONS.forEach(function (a) { items.appendChild(buildActionEl(a)); });
    wrap.appendChild(items);

    /* Returns & exchange cell (vertical text) — sits just ABOVE the X when open */
    var ret = document.createElement("a");
    ret.className = "mfab__return";
    ret.href = RETURN_URL;
    ret.setAttribute("aria-label", RETURN_LABEL);
    ret.setAttribute("title", RETURN_LABEL);
    ret.innerHTML = '<span class="mfab__return-text">' + RETURN_LABEL + '</span>';

    /* Close (X) button — the head icon "morphs" into this X at the BOTTOM when open */
    var foot = document.createElement("button");
    foot.type = "button";
    foot.className = "mfab__foot";
    foot.setAttribute("aria-label", "إغلاق");
    foot.setAttribute("title", "إغلاق");
    foot.innerHTML = '<span class="mfab__x" aria-hidden="true"></span>';

    bar.appendChild(head);
    bar.appendChild(wrap);
    bar.appendChild(ret);
    bar.appendChild(foot);
    root.appendChild(bar);
    document.body.appendChild(root);

    wire(root, head, items, foot);
  }

  function wire(root, head, items, foot) {
    function open() {
      root.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
    }
    function close() {
      root.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
    }
    function toggle() {
      root.classList.contains("is-open") ? close() : open();
    }

    head.addEventListener("click", function (e) {
      e.stopPropagation();
      toggle();
    });

    /* The bottom X closes the bar */
    foot.addEventListener("click", function (e) {
      e.stopPropagation();
      close();
    });

    /* Close after tapping any action */
    items.addEventListener("click", function (e) {
      if (e.target.closest(".mfab__item")) close();
    });

    /* Close on outside click */
    document.addEventListener("click", function (e) {
      if (!root.contains(e.target)) close();
    });

    /* Close on Escape */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    /* Reveal "back to top" + close on scroll */
    var lastScrolled = false;
    function onScroll() {
      var scrolled = window.pageYOffset > 300;
      if (scrolled !== lastScrolled) {
        root.classList.toggle("is-scrolled", scrolled);
        lastScrolled = scrolled;
      }
      if (root.classList.contains("is-open")) close();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* Hide the widget while a drawer / mobile menu / modal is open */
    var OVERLAY_SELECTORS = [
      ".s-cart-drawer.is-open",
      ".mm-ocd--open",
      "body.overflow-hidden .modal.show",
      ".s-overlay.is-active"
    ];
    function checkOverlays() {
      var blocked = OVERLAY_SELECTORS.some(function (sel) {
        try { return document.querySelector(sel); } catch (_) { return false; }
      });
      root.classList.toggle("is-hidden", !!blocked);
      if (blocked) close();
    }
    var overlayFrame = 0;
    var mo = new MutationObserver(function (mutations) {
      // Ignore the FAB's own class changes and collapse a burst of menu/theme
      // mutations into a single overlay check per animation frame.
      var externalChange = mutations.some(function (mutation) {
        return mutation.target !== root && !root.contains(mutation.target);
      });
      if (!externalChange || overlayFrame) return;
      overlayFrame = requestAnimationFrame(function () {
        overlayFrame = 0;
        checkOverlays();
      });
    });
    mo.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"]
    });
    checkOverlays();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();

})();
