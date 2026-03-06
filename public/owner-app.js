const configuredApiBase = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');

const API_BASES = [
  configuredApiBase,
  location.origin,
  'https://outlaw-ba9s.onrender.com',
  'https://shopmyrepair-prelaunch.onrender.com',
  'https://shopmyrepair.onrender.com'
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

let workingApiBase = configuredApiBase || location.origin;
let selectedRequestId = null;
let repairsCache = [];
let bidsByRequest = new Map();

function api(base, path) {
  return `${base}${path}`;
}

async function fetchJson(path, options = {}) {
  let lastErr = null;

  for (const base of API_BASES) {
    try {
      const res = await fetch(api(base, path), options);
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || 'Unexpected response' }; }

      if (!res.ok && (res.status === 404) && /route not found|not found/i.test(String(data?.error || data?.message || text))) {
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
  ['home', 'dashboard', 'quote', 'profile'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    el.style.display = v === name ? 'block' : 'none';
  });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

function setStatus(text, type = 'info') {
  const status = document.getElementById('ownerStatus');
  status.textContent = text;
  status.classList.remove('ok', 'err');
  if (type === 'ok') status.classList.add('ok');
  if (type === 'err') status.classList.add('err');
}

function labelForStatus(status) {
  const s = String(status || 'submitted').toLowerCase();
  if (s === 'open') return 'submitted';
  if (s === 'accepted') return 'accepted';
  if (s === 'in_progress') return 'in progress';
  if (s === 'completed') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return s;
}

function validateQuote() {
  const required = [
    ['title', 'Title'],
    ['issueCategory', 'Issue category'],
    ['issueDetails', 'Issue details'],
    ['vehicleYear', 'Vehicle year'],
    ['vehicleMake', 'Vehicle make'],
    ['vehicleModel', 'Vehicle model'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP']
  ];

  for (const [id, label] of required) {
    const value = String(document.getElementById(id).value || '').trim();
    if (!value) throw new Error(`${label} is required.`);
  }
}

function renderRequests() {
  const reqWrap = document.getElementById('ownerRequests');

  if (!repairsCache.length) {
    reqWrap.innerHTML = '<p>No open requests yet.</p>';
    return;
  }

  reqWrap.innerHTML = repairsCache.map(x => {
    const status = String(x.status || 'open').toLowerCase();
    const statusLabel = labelForStatus(status);
    const isSelected = Number(selectedRequestId) === Number(x.id);

    return `<div class='list-card'>
      <div class='request-head'>
        <strong>#${x.id} · ${x.title}</strong>
        <span class='pill ${status}'>${statusLabel}</span>
      </div>
      <div class='muted-xs'>${x.vehicle_year || ''} ${x.vehicle_make || ''} ${x.vehicle_model || ''} · ${x.city || ''}, ${x.state || ''}</div>
      <div class='muted-xs'>Next step: ${status === 'open' ? 'wait for bids' : status === 'accepted' ? 'coordinate service' : status === 'in_progress' ? 'service in progress' : status === 'completed' ? 'job completed' : 'review status'}.</div>
      <div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:8px'>
        <button class='btn btn-dark' data-view-request='${x.id}' style='padding:8px 12px'>${isSelected ? 'Viewing Bids' : 'View Bids'}</button>
        ${status === 'open' ? `<button class='btn btn-dark' data-cancel-request='${x.id}' style='padding:8px 12px;border-color:#7b3b3b;color:#ffb3b3'>Cancel Request</button>` : ''}
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('[data-view-request]').forEach(btn => btn.addEventListener('click', () => {
    selectedRequestId = Number(btn.dataset.viewRequest);
    renderRequests();
    renderBids();
  }));

  document.querySelectorAll('[data-cancel-request]').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.cancelRequest);
    const ok = confirm('Cancel this request? This will decline open bids.');
    if (!ok) return;
    try {
      await fetchJson(`/api/repairs/${id}/cancel`, { method: 'POST' });
      await loadDashboardData(window.__ownerSession);
      renderRequests();
      renderBids();
    } catch (err) {
      alert(err.message || 'Could not cancel request.');
    }
  }));
}

function renderBids() {
  const bidWrap = document.getElementById('ownerBids');

  if (!repairsCache.length) {
    bidWrap.innerHTML = '<p>—</p>';
    return;
  }

  const selected = repairsCache.find(r => Number(r.id) === Number(selectedRequestId)) || repairsCache[0];
  selectedRequestId = Number(selected.id);

  const bids = bidsByRequest.get(Number(selected.id)) || [];
  const accepted = bids.find(b => String(b.status || '').toLowerCase() === 'accepted');

  const header = `<div class='muted-xs' style='margin-bottom:8px'>Showing bids for <b>Request #${selected.id}</b> — ${selected.title}</div>`;

  if (!bids.length) {
    bidWrap.innerHTML = `${header}<p>No bids yet for this request.</p>`;
    return;
  }

  const cards = bids.map(b => {
    const status = String(b.status || 'open').toLowerCase();
    return `<div class='list-card'>
      <div class='bid-head'>
        <strong>${b.mechanic_name}</strong>
        <span class='pill ${status}'>${labelForStatus(status)}</span>
      </div>
      <div class='quote-grid'>
        <div class='muted-xs'>Offer: <b>$${b.amount}</b></div>
        <div class='muted-xs'>ETA: <b>${b.eta_hours}h</b></div>
      </div>
      <div class='muted-xs'>Notes: ${b.notes ? b.notes : 'No additional notes provided.'}</div>
      ${status === 'open' ? `<button class='btn btn-green' data-accept='${b.id}' style='margin-top:8px'>Accept Bid</button>` : ''}
    </div>`;
  }).join('');

  const acceptedInfo = accepted ? `<div class='list-card' style='border-color:#2a9f60'>
    <div class='request-head'>
      <strong>Accepted Company Info</strong>
      <span class='pill accepted'>accepted</span>
    </div>
    <div class='muted-xs'><b>${accepted.mechanic_name}</b></div>
    <div class='muted-xs'>Offer: $${accepted.amount} · ETA: ${accepted.eta_hours}h</div>
    <div class='muted-xs'>Notes: ${accepted.notes ? accepted.notes : 'No additional notes provided.'}</div>
  </div>` : '';

  bidWrap.innerHTML = `${header}${acceptedInfo}${cards}`;

  document.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJson(`/api/bids/${btn.dataset.accept}/accept`, { method: 'POST' });
      await loadDashboardData(window.__ownerSession);
      renderRequests();
      renderBids();
    } catch (err) {
      alert(err.message || 'Could not accept bid.');
    }
  }));
}

async function loadDashboardData(session) {
  window.__ownerSession = session;
  const data = await fetchJson(`/api/repairs?ownerId=${encodeURIComponent(session.id)}`);
  repairsCache = data.repairs || [];

  if (!repairsCache.length) {
    selectedRequestId = null;
    bidsByRequest = new Map();
    return;
  }

  if (!selectedRequestId || !repairsCache.find(r => Number(r.id) === Number(selectedRequestId))) {
    selectedRequestId = Number(repairsCache[0].id);
  }

  const entries = await Promise.all(repairsCache.map(async (rep) => {
    const bd = await fetchJson(`/api/bids?requestId=${rep.id}`);
    return [Number(rep.id), bd.bids || []];
  }));
  bidsByRequest = new Map(entries);
}

async function boot() {
  const session = await window.smrAuth.requireRole('owner');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  async function loadProfile() {
    const profile = await window.smrAuth.getOwnerProfile();
    if (!profile) return;
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profilePhone').value = profile.phone || '';
    document.getElementById('profileCity').value = profile.city || '';
    document.getElementById('profileState').value = profile.state || 'NY';
    document.getElementById('profileZip').value = profile.zip || '';

    if (!document.getElementById('city').value && profile.city) document.getElementById('city').value = profile.city;
    if (!document.getElementById('state').value && profile.state) document.getElementById('state').value = profile.state;
    if (!document.getElementById('zip').value && profile.zip) document.getElementById('zip').value = profile.zip;
  }

  async function refreshDashboard() {
    const reqWrap = document.getElementById('ownerRequests');
    const bidWrap = document.getElementById('ownerBids');
    reqWrap.textContent = 'Loading...';
    bidWrap.textContent = 'Loading...';

    try {
      await loadDashboardData(session);
      renderRequests();
      renderBids();
    } catch (err) {
      reqWrap.innerHTML = `<p style='color:#ff9a9a'>${err.message || 'Could not load dashboard.'}</p>`;
      bidWrap.innerHTML = '<p>—</p>';
    }
  }

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const profileStatus = document.getElementById('profileStatus');
    profileStatus.classList.remove('ok', 'err');
    profileStatus.textContent = 'Saving profile...';

    try {
      await window.smrAuth.saveOwnerProfile({
        name: document.getElementById('profileName').value,
        phone: document.getElementById('profilePhone').value,
        city: document.getElementById('profileCity').value,
        state: document.getElementById('profileState').value,
        zip: document.getElementById('profileZip').value
      });
      profileStatus.textContent = 'Profile updated successfully.';
      profileStatus.classList.add('ok');
      await loadProfile();
    } catch (err) {
      profileStatus.textContent = err.message || 'Could not update profile.';
      profileStatus.classList.add('err');
    }
  });

  document.getElementById('submitRepairBtn').addEventListener('click', async () => {
    try {
      validateQuote();
    } catch (err) {
      setStatus(err.message || 'Please check required fields.', 'err');
      return;
    }

    const payload = {
      ownerId: session.id,
      title: document.getElementById('title').value.trim(),
      issueCategory: document.getElementById('issueCategory').value,
      issueDetails: document.getElementById('issueDetails').value.trim(),
      vehicleYear: document.getElementById('vehicleYear').value.trim(),
      vehicleMake: document.getElementById('vehicleMake').value.trim(),
      vehicleModel: document.getElementById('vehicleModel').value.trim(),
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      zip: document.getElementById('zip').value.trim(),
      urgency: document.getElementById('urgency').value
    };

    const btn = document.getElementById('submitRepairBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    setStatus('Submitting your request...');

    try {
      await fetchJson('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setStatus('Request submitted successfully.', 'ok');
      ['title','issueDetails','vehicleYear','vehicleMake','vehicleModel','city','zip'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('issueCategory').value = '';
      document.getElementById('urgency').value = 'Standard';
      setView('dashboard');
      await refreshDashboard();
    } catch (err) {
      setStatus(`${err.message || 'Failed to submit request.'} (Tried: ${API_BASES.join(', ')})`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Repair Request';
    }
  });

  await loadProfile();
  refreshDashboard();
}

boot();
