const configuredApiBase = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');

const API_BASES = [
  configuredApiBase,
  location.origin,
  'https://outlaw-ba9s.onrender.com'
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

      if (!res.ok && res.status === 404 && /route not found|not found/i.test(String(data?.error || data?.message || text))) {
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

async function boot() {
  const session = await window.smrAuth.requireRole('mechanic');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  async function loadProfile() {
    const profile = await window.smrAuth.getMechanicProfile();
    if (!profile) return;
    document.getElementById('profileBusinessName').value = profile.businessName || '';
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileEmail').value = profile.email || '';
    document.getElementById('profilePhone').value = profile.phone || '';
    document.getElementById('profileCity').value = profile.city || '';
    document.getElementById('profileState').value = profile.state || 'NY';
    document.getElementById('profileZip').value = profile.zip || '';
    document.getElementById('profileServices').value = profile.services || '';
  }

  async function loadRepairs() {
    const wrap = document.getElementById('repairFeed');
    wrap.textContent = 'Loading...';

    try {
      const data = await fetchJson('/api/repairs?status=open');
      const repairs = data.repairs || [];

      wrap.innerHTML = repairs.length
        ? repairs.map(rep => `
          <div class='list-card'>
            <div class='head'>
              <strong>#${rep.id} · ${rep.title}</strong>
              <span class='pill open'>open</span>
            </div>
            <div class='small'>${rep.issue_category || ''} · ${rep.city || ''}, ${rep.state || ''} · ${rep.urgency || 'Standard'}</div>
            <div class='small'>${rep.vehicle_year || ''} ${rep.vehicle_make || ''} ${rep.vehicle_model || ''}</div>
            <div class='row2' style='margin-top:8px'>
              <input placeholder='Bid amount (USD)' id='amount-${rep.id}' />
              <input placeholder='ETA (hours)' id='eta-${rep.id}' />
            </div>
            <textarea id='notes-${rep.id}' placeholder='Notes for owner (optional)' style='margin-top:8px'></textarea>
            <button class='btn btn-orange' data-bid='${rep.id}' style='margin-top:8px'>Submit Bid</button>
          </div>
        `).join('')
        : '<p>No open repairs yet.</p>';

      document.querySelectorAll('[data-bid]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.bid;
        const amount = Number(document.getElementById(`amount-${id}`).value);
        const etaHours = Number(document.getElementById(`eta-${id}`).value);

        if (!Number.isFinite(amount) || amount <= 0) {
          setStatus('Please enter a valid bid amount.', 'err');
          return;
        }
        if (!Number.isFinite(etaHours) || etaHours <= 0) {
          setStatus('Please enter a valid ETA in hours.', 'err');
          return;
        }

        const savedProfile = await window.smrAuth.getMechanicProfile();
        const payload = {
          requestId: Number(id),
          mechanicId: session.id,
          mechanicName: savedProfile?.businessName || savedProfile?.name || session.name || session.email,
          amount,
          etaHours,
          notes: document.getElementById(`notes-${id}`).value
        };

        btn.disabled = true;
        btn.textContent = 'Submitting...';
        setStatus('Submitting bid...');

        try {
          await fetchJson('/api/bids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          setStatus(`Bid submitted. (Connected to: ${workingApiBase})`, 'ok');
          await loadRepairs();
          await loadDashboard();
        } catch (err) {
          setStatus(err.message || 'Failed to submit bid.', 'err');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Submit Bid';
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
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        phone: document.getElementById('profilePhone').value,
        city: document.getElementById('profileCity').value,
        state: document.getElementById('profileState').value,
        zip: document.getElementById('profileZip').value,
        services: document.getElementById('profileServices').value
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
    const wrap = document.getElementById('mechBids');

    try {
      const data = await fetchJson(`/api/bids?mechanicId=${encodeURIComponent(session.id)}`);
      const bids = data.bids || [];

      wrap.innerHTML = bids.length
        ? bids.map(b => {
            const status = String(b.status || 'open').toLowerCase();
            return `<div class='list-card'>
              <div class='head'>
                <strong>Request #${b.request_id}</strong>
                <span class='pill ${status}'>${status}</span>
              </div>
              <div class='small'>Offer: <b>$${b.amount}</b> · ETA: <b>${b.eta_hours}h</b></div>
            </div>`;
          }).join('')
        : '<p>No bids yet.</p>';
    } catch (err) {
      wrap.innerHTML = `<p style='color:#ff9a9a'>${err.message || 'Could not load bids.'}</p>`;
    }
  }

  await loadProfile();
  loadRepairs();
  loadDashboard();
}

boot();
