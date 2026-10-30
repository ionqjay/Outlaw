// The server decides availability; failure never advertises new quote access.
(async () => {
  const existingNotice = document.getElementById('availabilityNotice');
  const banner = existingNotice || document.createElement('p');
  banner.id = 'availabilityNotice'; banner.setAttribute('role', 'status');
  if (!existingNotice) banner.style.cssText = 'padding:16px;margin:0;background:#fff3cd;color:#342800;text-align:center';
  if (!existingNotice) banner.textContent = 'Checking new repair quote availability. Free accounts and existing history remain available.';
  if (!existingNotice) document.body.prepend(banner);
  const controls = [...document.querySelectorAll('[data-view="quote"], a[href*="view%3Dquote"], #startSubscriptionBtn, #manageBillingBtn, #submitRepairBtn, #view-quote button[type="submit"], #ownerRequestForm button[type="submit"]')];
  const originallyDisabled = new Map(controls.map(el => [el, el.disabled]));
  function lock() { controls.forEach(el => { el.setAttribute('aria-disabled', 'true'); if (el.tagName === 'BUTTON') el.disabled = true; }); }
  lock();
  controls.forEach(el => el.addEventListener('click', event => { if (el.getAttribute('aria-disabled') === 'true') { event.preventDefault(); event.stopImmediatePropagation(); } }, true));
  let timer;
  try {
    const controller = new AbortController();
    // Bound both the request and response body read, including backend wake-up.
    timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch((window.APP_CONFIG?.API_BASE || '') + '/api/availability', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (data.billingMode === 'enabled') {
      banner.remove(); controls.forEach(el => { el.removeAttribute('aria-disabled'); if (el.tagName === 'BUTTON') el.disabled = originallyDisabled.get(el); });
      return;
    }
    const providerPage = /\/pricing(?:\.html)?\/?$/.test(window.location.pathname);
    banner.textContent = existingNotice ? 'New repair requests are not open yet. You can create an account or sign in to your existing history.' : providerPage
      ? 'Repair-shop subscriptions are coming soon. Checkout is currently closed; existing accounts and job history remain available.'
      : 'Repair requests and quotes are coming soon. Platform use is free for vehicle owners; repair work is priced separately. Existing accounts and job history remain available.';
    controls.forEach(el => {
      if (el.id === 'startSubscriptionBtn') el.textContent = 'Shop subscriptions coming soon';
      else if (el.id !== 'manageBillingBtn') el.textContent = 'Repair quotes coming soon';
    });
    const headline = document.getElementById('heroHeadline');
    if (headline) headline.textContent = 'Repair quotes are coming soon.';
  } catch {
    banner.textContent = 'We cannot confirm availability right now. Please try again later. New requests and checkout remain closed. Existing accounts and job history remain available.';
  } finally {
    clearTimeout(timer);
  }
})();
