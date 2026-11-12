// Cookie pop-up manager: only ever clicks "reject / necessary only" style buttons, never "accept".
module.exports = `(() => new Promise(resolve => {
  let handled = 0;
  const done = new WeakSet();
  const REJECT_SELECTORS = [
    '#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll', '.cc-deny',
    'button[data-testid="reject-all"]', '.fc-cta-do-not-consent', '#didomi-notice-disagree-button',
    '.osano-cm-denyAll', 'button[aria-label="Reject all"]', 'button[aria-label="Reject All"]'
  ];
  const BANNERS = ['#onetrust-banner-sdk', '#CybotCookiebotDialog', '.cc-window', '#cookie-law-info-bar', '#cookiescript_injected'];
  const REJECT_TEXT = /^(reject( all)?|decline( all)?|deny( all)?|refuse( all)?|only (necessary|essential)( cookies)?|(necessary|essential) (cookies )?only|use necessary cookies only|continue without accepting|no,? thanks?)\\b/i;
  const click = el => { if (el && !done.has(el)) { done.add(el); el.click(); handled++; } };
  function pass() {
    for (const s of REJECT_SELECTORS) { const el = document.querySelector(s); if (el && el.offsetParent !== null) click(el); }
    const boxes = document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[role="dialog"],[aria-modal="true"]');
    for (const box of boxes) {
      if (box.offsetParent === null && getComputedStyle(box).position !== 'fixed') continue;
      for (const b of box.querySelectorAll('button,a[role="button"],[role="button"]')) {
        const t = (b.textContent || '').trim();
        if (t.length > 0 && t.length < 40 && REJECT_TEXT.test(t)) { click(b); break; }
      }
    }
  }
  let n = 0;
  const iv = setInterval(() => {
    try { pass(); } catch (e) {}
    if (++n >= 10) {
      clearInterval(iv);
      try { for (const s of BANNERS) document.querySelectorAll(s).forEach(el => { el.style.setProperty('display', 'none', 'important'); }); } catch (e) {}
      resolve(handled);
    }
  }, 500);
}))()`;
