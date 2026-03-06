const configuredApiBase = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');

const API_BASES = [
  configuredApiBase,
  location.origin,
  'https://outlaw-ba9s.onrender.com',
  'https://shopmyrepair-prelaunch.onrender.com',
  'https://shopmyrepair.onrender.com'
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

let workingApiBase = configuredApiBase || location.origin;

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

      // try next candidate on route miss / obvious host mismatch
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
  ['home', 'dashboard', 'quote'].forEach(v => {
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

async function boot() {
  const session = await window.smrAuth.requireRole('owner');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  async function loadDashboard() {
    const reqWrap = document.getElementById('ownerRequests');
    const bidWrap = document.getElementById('ownerBids');
    reqWrap.textContent = 'Loading...';
    bidWrap.textContent = 'Loading...';

    try {
      const data = await fetchJson(`/api/repairs?ownerId=${encodeURIComponent(session.id)}`);
      const repairs = data.repairs || [];

      reqWrap.innerHTML = repairs.length
        ? repairs.map(x => {
            const status = String(x.status || 'open').toLowerCase();
            const statusLabel = labelForStatus(status);
            return `<div class='list-card'>
              <div class='request-head'>
                <strong>#${x.id} · ${x.title}</strong>
                <span class='pill ${status}'>${statusLabel}</span>
              </div>
              <div class='muted-xs'>${x.vehicle_year || ''} ${x.vehicle_make || ''} ${x.vehicle_model || ''} · ${x.city || ''}, ${x.state || ''}</div>
              <div class='muted-xs'>Next step: ${status === 'open' ? 'wait for bids' : status === 'accepted' ? 'coordinate service' : status === 'in_progress' ? 'service in progress' : status === 'completed' ? 'job completed' : 'review status'}.</div>
            </div>`;
          }).join('')
        : '<p>No open requests yet.</p>';

      const bids = [];
      for (const rep of repairs) {
        const bd = await fetchJson(`/api/bids?requestId=${rep.id}`);
        (bd.bids || []).forEach(b => bids.push(b));
      }

      bidWrap.innerHTML = bids.length
        ? bids.map(b => {
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
              <div class='muted-xs'>Trust signal: active profile on ShopMyRepair marketplace.</div>
              ${status === 'open' ? `<button class='btn btn-green' data-accept='${b.id}' style='margin-top:8px'>Accept Bid</button>` : ''}
            </div>`;
          }).join('')
        : '<p>No bids yet.</p>';

      document.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          await fetchJson(`/api/bids/${btn.dataset.accept}/accept`, { method: 'POST' });
          await loadDashboard();
        } catch (err) {
          alert(err.message || 'Could not accept bid.');
        }
      }));
    } catch (err) {
      reqWrap.innerHTML = `<p style='color:#ff9a9a'>${err.message || 'Could not load dashboard.'}</p>`;
      bidWrap.innerHTML = '<p>—</p>';
    }
  }

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

      setStatus(`Request submitted successfully. (Connected to: ${workingApiBase})`, 'ok');
      ['title','issueDetails','vehicleYear','vehicleMake','vehicleModel','city','zip'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('issueCategory').value = '';
      document.getElementById('urgency').value = 'Standard';
      setView('dashboard');
      await loadDashboard();
    } catch (err) {
      setStatus(`${err.message || 'Failed to submit request.'} (Tried: ${API_BASES.join(', ')})`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Repair Request';
    }
  });

  loadDashboard();
}

boot();
