// The server decides availability; failure never advertises new quote access.
(async () => {
  const banner = document.createElement('p');
  banner.id = 'availabilityNotice'; banner.setAttribute('role', 'status');
  banner.style.cssText = 'padding:16px;margin:0;background:#fff3cd;color:#342800;text-align:center';
  banner.textContent = 'Checking new repair quote availability. Free accounts and existing history remain available.';
  document.body.prepend(banner);
  const controls = [...document.querySelectorAll('[data-view="quote"], a[href*="view%3Dquote"], #startSubscriptionBtn, #manageBillingBtn, #submitRepairBtn, #view-quote button[type="submit"], #ownerRequestForm button[type="submit"]')];
  const originallyDisabled = new Map(controls.map(el => [el, el.disabled]));
  function lock() { controls.forEach(el => { el.setAttribute('aria-disabled', 'true'); if (el.tagName === 'BUTTON') el.disabled = true; }); }
  lock();
  controls.forEach(el => el.addEventListener('click', event => { if (el.getAttribute('aria-disabled') === 'true') { event.preventDefault(); event.stopImmediatePropagation(); } }, true));
  try {
    const response = await fetch((window.APP_CONFIG?.API_BASE || '') + '/api/availability', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (data.billingMode === 'enabled') {
      banner.remove(); controls.forEach(el => { el.removeAttribute('aria-disabled'); if (el.tagName === 'BUTTON') el.disabled = originallyDisabled.get(el); });
      return;
    }
    banner.textContent = data.message;
    controls.forEach(el => { if (el.id !== 'manageBillingBtn') el.textContent = 'New quotes & subscriptions coming soon'; });
    const headline = document.getElementById('heroHeadline');
    if (headline) headline.textContent = 'Repair quotes are coming soon.';
  } catch {
    banner.textContent = 'New repair quotes and subscriptions are currently unavailable. Free accounts and existing history remain available.';
  }
})();
