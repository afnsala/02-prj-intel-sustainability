/**
 * rtl-detect.js — Intel Sustainability Page
 * ─────────────────────────────────────────
 * Detects language/direction changes at runtime (e.g. via Google Translate)
 * and applies or removes RTL layout automatically.
 *
 * Detection layers (most-reliable first):
 *
 *  1. <html lang> MutationObserver
 *     Google Translate rewrites lang="en" → lang="ar" etc.
 *     This is the primary and fastest signal.
 *
 *  2. <html class> MutationObserver
 *     Google Translate adds "translated-rtl" / "translated-ltr" to <html>.
 *
 *  3. Cookie polling (800 ms interval)
 *     Google Translate sets: googtrans=/en/ar
 *     Reliable fallback when DOM attribute mutations are delayed.
 *
 *  4. navigator.language seed
 *     On first load, honours the browser/OS locale so RTL users see the
 *     correct layout immediately without needing to trigger Translate.
 *
 * When RTL is activated:
 *   • Sets dir="rtl" on <html>
 *   • Swaps the Bootstrap LTR stylesheet for Bootstrap RTL
 *   • Injects scoped [dir="rtl"] CSS overrides for custom components
 *   • Shows a dismissable toast confirming the change
 *
 * When LTR is restored:
 *   • Reverts dir="ltr" on <html>
 *   • Swaps Bootstrap RTL back to Bootstrap LTR
 *   • Removes the RTL override <style> block
 */

(() => {
  'use strict';

  /* ─── RTL language codes ────────────────────────────────────── */
  const RTL_LANGS = new Set([
    'ar','arc','dv','fa','ha','he','khw','ks','ku','ps','sd','syr','ur','uz','yi'
  ]);

  /* ─── Bootstrap CDN URLs ────────────────────────────────────── */
  const BS_LTR = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
  const BS_RTL = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css';

  /* ─── State ─────────────────────────────────────────────────── */
  let currentDir  = document.documentElement.getAttribute('dir') || 'ltr';
  let toastTimer  = null;
  let pollTimer   = null;

  /* ─── Utilities ─────────────────────────────────────────────── */

  /** "zh-TW" → "zh",  "ar-EG" → "ar" */
  function baseTag(lang) {
    return (lang || '').toLowerCase().split(/[-_]/)[0];
  }

  function isRTLLang(lang) {
    return RTL_LANGS.has(baseTag(lang));
  }

  /* ─── Core: apply direction ─────────────────────────────────── */
  function applyDirection(dir) {
    if (dir === currentDir) return;
    currentDir = dir;

    const html = document.documentElement;
    html.setAttribute('dir', dir);

    swapBootstrap(dir);
    toggleRTLOverrides(dir);
    showToast(dir);

    console.info('[rtl-detect] Direction →', dir);
  }

  /* ─── Bootstrap stylesheet swap ─────────────────────────────── */
  function swapBootstrap(dir) {
    const link = document.getElementById('bootstrap-css');
    if (!link) return;
    const target = dir === 'rtl' ? BS_RTL : BS_LTR;
    if (link.href !== target) link.href = target;
  }

  /* ─── Scoped RTL overrides for custom components ────────────── */
  const OVERRIDE_ID = 'rtl-overrides';

  function toggleRTLOverrides(dir) {
    if (dir === 'rtl') {
      injectRTLOverrides();
    } else {
      const el = document.getElementById(OVERRIDE_ID);
      if (el) el.remove();
    }
  }

  function injectRTLOverrides() {
    if (document.getElementById(OVERRIDE_ID)) return;
    const style = document.createElement('style');
    style.id = OVERRIDE_ID;
    style.textContent = `
      /* Hero — keep centred in RTL, only mirror the arrow */
      [dir="rtl"] .hero__inner                              { text-align: center; align-items: center; }
      [dir="rtl"] .hero__scroll-hint                        { flex-direction: row-reverse; }
      [dir="rtl"] .hero__scroll-hint svg                    { transform: scaleX(-1); }

      /* Timeline */
      [dir="rtl"] .timeline-cards                           { flex-direction: row-reverse; }
      [dir="rtl"] .card                                     { margin-right: 0; margin-left: 28px; }
      [dir="rtl"] .card:last-child                          { margin-left: 0; }

      /* Pillar cards */
      [dir="rtl"] .pillar-card                              { text-align: right; }
      [dir="rtl"] .pillar-card__link                        { flex-direction: row-reverse; }
      [dir="rtl"] .pillar-card__link .bi-arrow-right        { transform: scaleX(-1); }
      [dir="rtl"] .pillar-card__link:hover .bi-arrow-right  { transform: scaleX(-1) translateX(3px); }

      /* Newsletter */
      [dir="rtl"] .newsletter-form                          { text-align: right; }
      [dir="rtl"] .newsletter-form__check                   { flex-direction: row-reverse; }
      [dir="rtl"] .newsletter-form__submit .bi-send         { transform: scaleX(-1); }

      /* Footer */
      [dir="rtl"] .footer__nav-list                         { justify-content: flex-end; }
      [dir="rtl"] .footer__legal-list                       { justify-content: flex-start; }
      [dir="rtl"] .footer__legal-list li + li::before       { margin-right: 0; margin-left: 0.1rem; }
    `;
    document.head.appendChild(style);
  }

  /* ─── Toast notification ─────────────────────────────────────── */
  const TOAST_CSS = `
    #rtl-toast {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      background: #0D1B35;
      border: 1px solid #1A3560;
      color: #E8F4FD;
      font-family: 'Inter', sans-serif;
      font-size: 0.8rem;
      padding: 0.65rem 1.2rem;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      gap: 0.6rem;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      z-index: 9999;
      white-space: nowrap;
      pointer-events: none;
    }
    #rtl-toast.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    #rtl-toast .toast-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  `;

  let toastStyleInjected = false;

  function showToast(dir) {
    if (!toastStyleInjected) {
      const s = document.createElement('style');
      s.textContent = TOAST_CSS;
      document.head.appendChild(s);
      toastStyleInjected = true;
    }

    let toast = document.getElementById('rtl-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rtl-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    const isRtl  = dir === 'rtl';
    const color  = isRtl ? '#00C49A' : '#00AEEF';
    const label  = isRtl
      ? 'RTL layout applied — reading direction adjusted'
      : 'LTR layout restored';

    toast.innerHTML = `<span class="toast-dot" style="background:${color}"></span>${label}`;

    clearTimeout(toastTimer);
    // Force reflow so transition plays even on repeat calls
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3500);
  }

  /* ─── Detection handlers ─────────────────────────────────────── */

  function checkLang() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    applyDirection(isRTLLang(lang) ? 'rtl' : 'ltr');
  }

  function checkClass() {
    const cl = document.documentElement.classList;
    if (cl.contains('translated-rtl')) { applyDirection('rtl'); return; }
    if (cl.contains('translated-ltr')) { applyDirection('ltr'); }
  }

  /** Parse the googtrans cookie Google Translate sets: /en/ar */
  function checkCookie() {
    const m = document.cookie.match(/googtrans=\/\w+\/(\w+)/);
    if (m) applyDirection(isRTLLang(m[1]) ? 'rtl' : 'ltr');
  }

  /* ─── Initialise ─────────────────────────────────────────────── */
  function init() {
    // 1. Seed: honour browser locale on first load
    checkLang();

    const html = document.documentElement;

    // 2. Observer: <html lang="…">
    new MutationObserver(checkLang).observe(html, {
      attributes: true,
      attributeFilter: ['lang']
    });

    // 3. Observer: <html class="translated-rtl / translated-ltr">
    new MutationObserver(checkClass).observe(html, {
      attributes: true,
      attributeFilter: ['class']
    });

    // 4. Observer: shallow body — catches late Translate DOM rewrites
    new MutationObserver(() => { checkLang(); checkClass(); }).observe(
      document.body,
      { childList: true, subtree: false }
    );

    // 5. Cookie polling fallback
    pollTimer = setInterval(checkCookie, 800);

    console.info('[rtl-detect] Ready. Monitoring lang, class, and cookie for direction changes.');
  }

  /* Run after DOM is available */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();