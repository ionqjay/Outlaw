const configuredApiBase = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');

const API_BASES = [
  configuredApiBase,
  location.origin,
  'https://outlaw-ba9s.onrender.com'
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

let workingApiBase = configuredApiBase || location.origin;
let billingState = { canSubmitEstimates: false, status: 'none' };

function api(base, path) {
  return `${base}${path}`;
}

async function fetchJson(path, options = {}) {
  let lastErr = null;

  for (const base of API_BASES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(api(base, path), { ...options, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || 'Unexpected response' }; }

      if (!res.ok && res.status === 404 && /route not found|not found|not_found|page could not be found/i.test(String(data?.error || data?.message || text))) {
        lastErr = new Error(`API route missing on ${base}`);
        continue;
      }

      workingApiBase = base;
      if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
      return data;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Unable to reach backend API.');
}

function setView(name) {
  ['home', 'dashboard', 'repairs', 'profile'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    el.style.display = v === name ? 'block' : 'none';
  });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function setStatus(text, type = 'info') {
  const status = document.getElementById('mechStatus');
  status.textContent = text;
  status.classList.remove('ok', 'err');
  if (type === 'ok') status.classList.add('ok');
  if (type === 'err') status.classList.add('err');
}

function setInlineAlert(message = '') {
  const box = document.getElementById('mechInlineAlert');
  if (!box) return;
  const msg = String(message || '').trim();
  if (!msg) {
    box.textContent = '';
    box.classList.remove('show');
    return;
  }
  box.textContent = msg;
  box.classList.add('show');
}

function parseOwnerMeta(issueDetailsRaw) {
  const txt = String(issueDetailsRaw || '');
  const m = txt.match(/\[OWNER_META\](.*?)\[\/OWNER_META\]/);
  if (!m) return { ownerEmail: '', ownerPhone: '', cleanDetails: txt };
  try {
    const meta = JSON.parse(m[1]);
    const cleanDetails = txt.replace(m[0], '').trim();
    return { ownerEmail: meta.ownerEmail || '', ownerPhone: meta.ownerPhone || '', cleanDetails };
  } catch {
    return { ownerEmail: '', ownerPhone: '', cleanDetails: txt };
  }
}

function getProviderType(role) {
  return String(role || '').toLowerCase() === 'shop' ? 'shop' : 'mechanic';
}

function getProviderTypeLabel(role) {
  return getProviderType(role) === 'shop' ? 'Mechanic Shop' : 'Individual Mechanic';
}

function formatInviteCountdown(expiresAt) {
  const ts = new Date(expiresAt || 0).getTime();
  if (!Number.isFinite(ts)) return 'No timer available';
  const ms = ts - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

async function boot() {
  const session = await window.smrAuth.requireRole(['mechanic', 'shop']);
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());
  document.getElementById('startSubscriptionBtn')?.addEventListener('click', startSubscription);
  document.getElementById('manageBillingBtn')?.addEventListener('click', openBillingPortal);

  const billingParam = new URLSearchParams(window.location.search).get('billing');
  if (billingParam === 'success') setStatus('Subscription checkout completed. Refreshing billing status...', 'ok');
  if (billingParam === 'cancel') setStatus('Checkout canceled. You can start subscription anytime.', 'err');

  const providerType = getProviderType(session.role);
  const providerTypeLabel = getProviderTypeLabel(session.role);
  const isShop = providerType === 'shop';
  const dashboardTitle = document.getElementById('providerDashboardTitle');
  const dashboardSubtitle = document.getElementById('providerDashboardSubtitle');
  const profileTitle = document.getElementById('providerProfileTitle');
  const profileSubtitle = document.getElementById('providerProfileSubtitle');
  if (dashboardTitle) dashboardTitle.textContent = `${providerTypeLabel} Dashboard`;
  if (dashboardSubtitle) dashboardSubtitle.textContent = isShop
    ? 'Find qualified repair requests, send competitive shop estimates, and win more local jobs.'
    : 'Find qualified repair requests, send competitive mechanic estimates, and win more local jobs.';
  if (profileTitle) profileTitle.textContent = `${providerTypeLabel} Profile`;
  if (profileSubtitle) profileSubtitle.textContent = isShop
    ? 'Set your shop profile so owners clearly see business identity and trust your estimates.'
    : 'Set your mechanic profile so owners clearly see this is an individual mechanic estimate.';

  const businessNameInput = document.getElementById('profileBusinessName');
  if (businessNameInput) {
    businessNameInput.placeholder = isShop ? 'Shop name' : 'Public display name';
  }
  const individualOnlyFields = document.getElementById('individualOnlyFields');
  if (individualOnlyFields) individualOnlyFields.style.display = isShop ? 'none' : 'block';

  async function refreshBillingStatus() {
    const el = document.getElementById('billingStatus');
    if (el) el.textContent = 'Checking subscription status...';
    try {
      const data = await fetchJson(`/api/billing/status?userId=${encodeURIComponent(session.id)}`);
      billingState = {
        canSubmitEstimates: !!data.canSubmitEstimates,
        status: String(data.status || 'none')
      };
      if (el) {
        if (billingState.canSubmitEstimates) {
          el.textContent = `Subscription active (${billingState.status}). You can submit estimates.`;
          el.classList.remove('err');
          el.classList.add('ok');
        } else {
          el.textContent = 'No active subscription yet. Start the $99/month package to unlock estimate submissions.';
          el.classList.remove('ok');
          el.classList.add('err');
        }
      }
    } catch (err) {
      if (el) {
        el.textContent = err.message || 'Could not load billing status.';
        el.classList.remove('ok');
        el.classList.add('err');
      }
    }
  }

  async function startSubscription() {
    const btn = document.getElementById('startSubscriptionBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting...'; }
    try {
      const data = await fetchJson('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.id, email: session.email, role: session.role })
      });
      if (!data?.url) throw new Error('Checkout URL missing.');
      window.location.href = data.url;
    } catch (err) {
      setStatus(err.message || 'Could not start Stripe checkout.', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Start $99 Subscription'; }
    }
  }

  async function openBillingPortal() {
    const btn = document.getElementById('manageBillingBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening...'; }
    try {
      const data = await fetchJson('/api/billing/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.id })
      });
      if (!data?.url) throw new Error('Portal URL missing.');
      window.location.href = data.url;
    } catch (err) {
      setStatus(err.message || 'Could not open billing portal.', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Manage Billing'; }
    }
  }

  async function loadProfile() {
    const profile = await window.smrAuth.getMechanicProfile();
    if (!profile) return;
    document.getElementById('profileBusinessName').value = profile.businessName || '';
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileEmail').value = profile.email || '';
    document.getElementById('profilePhone').value = profile.phone || '';
    document.getElementById('profileCity').value = profile.city || '';
    document.getElementById('profileState').value = profile.state || 'NY';
    document.getElementById('profileBusinessAddress').value = profile.businessAddress || '';
    document.getElementById('profileZip').value = profile.zip || '';
    document.getElementById('profileServices').value = profile.services || '';
    const radiusEl = document.getElementById('profileServiceRadius');
    const certEl = document.getElementById('profileCertifications');
    if (radiusEl) radiusEl.value = profile.serviceRadiusMiles || '';
    if (certEl) certEl.value = profile.certifications || '';
  }

  async function loadRepairs() {
    const wrap = document.getElementById('repairFeed');
    setInlineAlert('');
    wrap.innerHTML = "<div class='skeleton'></div><div class='skeleton'></div>";

    try {
      const providerEmail = encodeURIComponent(String((await window.smrAuth.getMechanicProfile())?.email || session.email || '').trim().toLowerCase());
      const data = await fetchJson(`/api/repairs?status=open&providerEmail=${providerEmail}`);
      const repairs = data.repairs || [];

      wrap.innerHTML = repairs.length
        ? repairs.map(rep => {
            const ownerMeta = parseOwnerMeta(rep.issue_details);
            return `
          <div class='estimate-card'>
            <div class='estimate-top'>
              <strong>#${rep.id} · ${rep.title}</strong>
              <span class='pill open'>open</span>
            </div>
            <div class='small'>${rep.issue_category || ''} · ${rep.city || ''}, ${rep.state || ''} · ${rep.urgency || 'Standard'}</div>
            <div class='small'>${rep.vehicle_year || ''} ${rep.vehicle_make || ''} ${rep.vehicle_model || ''}</div>
            <div class='small'><b>Repair needed:</b> ${ownerMeta.cleanDetails || 'No description provided.'}</div>
            <div class='small'><b>Estimate window:</b> ${formatInviteCountdown(rep.invite_expires_at)}</div>
            <div class='estimate-kpis'>
              <div class='kpi-pill'><div class='lbl'>Your estimate (USD)</div><input placeholder='e.g. 325' id='amount-${rep.id}' /></div>
              <div class='kpi-pill'><div class='lbl'>ETA (hours)</div><input placeholder='24' id='eta-${rep.id}' value='24' /></div>
            </div>
            <textarea id='notes-${rep.id}' placeholder='Notes for owner (minimum 15 characters)' style='margin-top:8px'></textarea>
            <button class='btn btn-orange' data-bid='${rep.id}' style='margin-top:10px'>Submit Estimate</button>
          </div>
        `;
          }).join('')
        : "<div class='list-card'><strong>No open repairs right now.</strong><div class='small'>Check back shortly — new owner demand comes in throughout the day.</div></div>";

      document.querySelectorAll('[data-bid]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.bid;
        const fail = (msg, goProfile = false) => {
          setStatus(msg, 'err');
          setInlineAlert(msg);
          if (goProfile) setView('profile');
        };

        if (!billingState.canSubmitEstimates) {
          fail('Active $99/month subscription required before submitting estimates.', true);
          return;
        }

        const amount = Number(document.getElementById(`amount-${id}`)?.value);
        const etaRaw = Number(document.getElementById(`eta-${id}`)?.value);
        const etaHours = Number.isFinite(etaRaw) && etaRaw > 0 ? etaRaw : 24;

        if (!Number.isFinite(amount) || amount <= 0) {
          fail('Please enter a valid repair estimate.');
          return;
        }

        const savedProfile = await window.smrAuth.getMechanicProfile();
        const rawNotes = String(document.getElementById(`notes-${id}`)?.value || '').trim();
        if (rawNotes.length < 15) {
          fail('Please include at least 15 characters in notes so owners get a quality estimate.');
          return;
        }

        const providerType = getProviderType(session.role);
        const providerTypeLabel = getProviderTypeLabel(session.role);

        const requiredProfile = [
          savedProfile?.email,
          savedProfile?.phone,
          savedProfile?.services,
          providerType === 'shop' ? (savedProfile?.businessName || savedProfile?.name) : savedProfile?.name
        ];
        const hasMinimumProfile = requiredProfile.every(v => String(v || '').trim());
        if (!hasMinimumProfile) {
          fail('Complete profile first (name, email, phone, services) before submitting estimates.', true);
          return;
        }
        const displayName = providerType === 'shop'
          ? (savedProfile?.businessName || savedProfile?.name || session.name || session.email)
          : (savedProfile?.name || savedProfile?.businessName || session.name || session.email);

        const meta = {
          providerType,
          providerTypeLabel,
          businessName: displayName,
          businessAddress: savedProfile?.businessAddress || '',
          businessZip: savedProfile?.zip || '',
          businessEmail: savedProfile?.email || session.email || '',
          businessPhone: savedProfile?.phone || '',
          serviceRadiusMiles: savedProfile?.serviceRadiusMiles || '',
          certifications: savedProfile?.certifications || ''
        };

        const payload = {
          requestId: Number(id),
          mechanicId: session.id,
          mechanicName: meta.businessName,
          amount,
          etaHours,
          notes: `[META]${JSON.stringify(meta)}[/META] ${rawNotes}`
        };

        btn.disabled = true;
        btn.textContent = 'Submitting...';
        setStatus('Submitting repair estimate...');

        try {
          await fetchJson('/api/bids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          setInlineAlert('');
          setStatus(`Repair estimate submitted as ${getProviderTypeLabel(session.role)}.`, 'ok');
          await loadRepairs();
          await loadDashboard();
        } catch (err) {
          const msg = err.message || 'Failed to submit bid.';
          setStatus(msg, 'err');
          setInlineAlert(msg);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Submit Repair Estimate';
        }
      }));
    } catch (err) {
      wrap.innerHTML = `<p style='color:#ff9a9a'>${err.message || 'Could not load repairs.'}</p>`;
      setStatus('Could not load open repairs.', 'err');
    }
  }

  document.getElementById('saveMechanicProfileBtn').addEventListener('click', async () => {
    const status = document.getElementById('mechanicProfileStatus');
    status.classList.remove('ok', 'err');
    status.textContent = 'Saving profile...';

    try {
      await window.smrAuth.saveMechanicProfile({
        businessName: document.getElementById('profileBusinessName').value,
        businessAddress: document.getElementById('profileBusinessAddress').value,
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        phone: document.getElementById('profilePhone').value,
        city: document.getElementById('profileCity').value,
        state: document.getElementById('profileState').value,
        zip: document.getElementById('profileZip').value,
        services: document.getElementById('profileServices').value,
        serviceRadiusMiles: document.getElementById('profileServiceRadius')?.value || '',
        certifications: document.getElementById('profileCertifications')?.value || ''
      });
      status.textContent = 'Profile updated successfully.';
      status.classList.add('ok');
      await loadProfile();
    } catch (err) {
      status.textContent = err.message || 'Could not save profile.';
      status.classList.add('err');
    }
  });

  async function loadDashboard() {
    const wonWrap = document.getElementById('mechBidsWon');
    const activeWrap = document.getElementById('mechBidsActive');
    const otherWrap = document.getElementById('mechBidsOther');
    const skeleton = "<div class='skeleton'></div><div class='skeleton'></div>";
    wonWrap.innerHTML = skeleton;
    activeWrap.innerHTML = skeleton;
    otherWrap.innerHTML = skeleton;

    try {
      const [bidsData, repairsData] = await Promise.all([
        fetchJson(`/api/bids?mechanicId=${encodeURIComponent(session.id)}`),
        fetchJson('/api/repairs')
      ]);

      const bids = bidsData.bids || [];
      const repairs = repairsData.repairs || [];
      const repairsById = new Map(repairs.map(r => [Number(r.id), r]));

      const renderBidCard = (b) => {
        const status = String(b.status || 'open').toLowerCase();
        const rep = repairsById.get(Number(b.request_id));
        const repStatus = String(rep?.status || 'open').toLowerCase();
        const ownerMeta = parseOwnerMeta(rep?.issue_details || '');

        return `<div class='estimate-card'>
          <div class='estimate-top'>
            <strong>${rep?.title ? rep.title : `Request #${b.request_id}`}</strong>
            <span class='pill ${status}'>${status}</span>
          </div>
          <div class='estimate-kpis'>
            <div class='kpi-pill'><div class='lbl'>Your estimate</div><div class='val'>$${b.amount}</div></div>
            <div class='kpi-pill'><div class='lbl'>Request status</div><div class='val' style='font-size:16px;text-transform:capitalize'>${repStatus.replace('_',' ')}</div></div>
          </div>
          <div class='small'>${rep?.city || ''}${rep?.city ? ', ' : ''}${rep?.state || ''} · ${rep?.urgency || 'Standard'}</div>
          <div class='small'><b>Repair needed:</b> ${ownerMeta.cleanDetails || 'Request details unavailable.'}</div>
          ${status === 'accepted' ? `<span class='contact-pill'>📞 ${ownerMeta.ownerPhone || 'No phone'}</span> <span class='contact-pill'>✉️ ${ownerMeta.ownerEmail || 'No email'}</span>` : ''}
        </div>`;
      };

      const won = bids.filter(b => String(b.status || '').toLowerCase() === 'accepted');
      const active = bids.filter(b => String(b.status || '').toLowerCase() === 'open');
      const other = bids.filter(b => !['accepted', 'open'].includes(String(b.status || '').toLowerCase()));

      wonWrap.innerHTML = won.length ? won.map(renderBidCard).join('') : "<div class='list-card'><strong>No won jobs yet.</strong><div class='small'>Win your first one by responding fast and adding clear notes.</div><button class='btn btn-orange' data-view='repairs' style='margin-top:8px'>Find Open Repairs</button></div>";
      activeWrap.innerHTML = active.length ? active.map(renderBidCard).join('') : "<div class='list-card'><strong>No active estimates.</strong><div class='small'>Browse open requests and submit competitive estimates.</div><button class='btn btn-orange' data-view='repairs' style='margin-top:8px'>Find Open Repairs</button></div>";
      otherWrap.innerHTML = other.length ? other.map(renderBidCard).join('') : '<p>No other repair estimates yet.</p>';
      document.querySelectorAll('#view-dashboard [data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

      await loadHomeMetrics({ bids, repairs, won, active });
    } catch (err) {
      const msg = `<p style='color:#ff9a9a'>${err.message || 'Could not load bids.'}</p>`;
      wonWrap.innerHTML = msg;
      activeWrap.innerHTML = msg;
      otherWrap.innerHTML = msg;
    }
  }

  function renderMechanicChecklist({ profile, bids = [], won = [] } = {}) {
    const el = document.getElementById('mechanicChecklist');
    if (!el) return;

    const providerType = getProviderType(session.role);
    const profileDone = providerType === 'shop'
      ? !!(String(profile?.businessName || '').trim() && String(profile?.email || '').trim() && String(profile?.phone || '').trim() && String(profile?.services || '').trim())
      : !!(String(profile?.name || '').trim() && String(profile?.email || '').trim() && String(profile?.phone || '').trim() && String(profile?.services || '').trim());
    const submittedEstimate = bids.length > 0;
    const wonFirstJob = won.length > 0;
    const doneCount = [profileDone, submittedEstimate, wonFirstJob].filter(Boolean).length;

    el.innerHTML = `
      <div class='small'>Progress: <b>${doneCount}/3 complete</b></div>
      <div class='small'>${profileDone ? '✅' : '⬜'} Complete your profile</div>
      <div class='small'>${submittedEstimate ? '✅' : '⬜'} Submit your first estimate</div>
      <div class='small'>${wonFirstJob ? '✅' : '⬜'} Win your first job</div>
    `;
  }

  async function loadHomeMetrics({ bids = [], repairs = [], won = [], active = [] } = {}) {
    const profile = await window.smrAuth.getMechanicProfile();
    const providerType = getProviderType(session.role);
    const profileFields = providerType === 'shop'
      ? [profile?.businessName, profile?.businessAddress, profile?.phone, profile?.services, profile?.city, profile?.zip]
      : [profile?.name, profile?.phone, profile?.services, profile?.city, profile?.zip, profile?.serviceRadiusMiles, profile?.certifications];
    const completed = profileFields.filter(v => String(v || '').trim()).length;
    const strength = Math.round((completed / profileFields.length) * 100);

    renderMechanicChecklist({ profile, bids, won });

    const acceptedRate = bids.length ? Math.round((won.length / bids.length) * 100) : 0;
    const avgEstimate = bids.length ? Math.round(bids.reduce((s, b) => s + Number(b.amount || 0), 0) / bids.length) : 0;

    const openRepairs = repairs.filter(r => String(r.status || '').toLowerCase() === 'open').length;
    document.getElementById('homeOpenCount').textContent = String(openRepairs);
    document.getElementById('homeActiveCount').textContent = String(active.length);
    document.getElementById('homeWonCount').textContent = String(won.length);
    document.getElementById('homeSubmittedCount').textContent = String(bids.length);
    document.getElementById('homeMissedCount').textContent = String(Math.max(0, openRepairs - active.length));
    document.getElementById('homeProfileStrength').textContent = `${strength}%`;
    document.getElementById('homeAcceptedRate').textContent = `${acceptedRate}%`;
    document.getElementById('homeAvgEstimate').textContent = `$${avgEstimate}`;

    const tip = strength < 70
      ? 'Tip: Complete your profile (address, phone, services) to improve owner trust.'
      : acceptedRate < 20
        ? 'Tip: Improve estimate notes to highlight value and turnaround.'
        : 'Tip: Keep response times fast to maintain strong win rates.';
    document.getElementById('homeTip').textContent = tip;

    const recent = bids.slice(0, 4).map(b => {
      const st = String(b.status || 'open').toLowerCase();
      if (st === 'accepted') return `✅ Estimate accepted for request #${b.request_id}`;
      if (st === 'open') return `🕒 Estimate pending for request #${b.request_id}`;
      return `ℹ️ Estimate ${st} for request #${b.request_id}`;
    });
    document.getElementById('homeActivity').innerHTML = recent.length ? recent.map(x => `<div class='small'>${x}</div>`).join('') : 'No recent activity yet.';
  }

  await loadProfile();
  await refreshBillingStatus();
  loadRepairs();
  loadDashboard();

  setInterval(() => {
    const repairsView = document.getElementById('view-repairs');
    if (repairsView && repairsView.style.display !== 'none') loadRepairs();
  }, 60000);
}

boot();
