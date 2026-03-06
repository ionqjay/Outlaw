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
    document.getElementById('profileBusinessAddress').value = profile.businessAddress || '';
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
        ? repairs.map(rep => {
            const ownerMeta = parseOwnerMeta(rep.issue_details);
            return `
          <div class='list-card'>
            <div class='head'>
              <strong>#${rep.id} · ${rep.title}</strong>
              <span class='pill open'>open</span>
            </div>
            <div class='small'>${rep.issue_category || ''} · ${rep.city || ''}, ${rep.state || ''} · ${rep.urgency || 'Standard'}</div>
            <div class='small'>${rep.vehicle_year || ''} ${rep.vehicle_make || ''} ${rep.vehicle_model || ''}</div>
            <div class='small'><b>Repair needed:</b> ${ownerMeta.cleanDetails || 'No description provided.'}</div>
            <div class='row2' style='margin-top:8px'>
              <input placeholder='Repair estimate (USD)' id='amount-${rep.id}' />
            </div>
            <textarea id='notes-${rep.id}' placeholder='Notes for owner (optional)' style='margin-top:8px'></textarea>
            <button class='btn btn-orange' data-bid='${rep.id}' style='margin-top:8px'>Submit Bid</button>
          </div>
        `;
          }).join('')
        : '<p>No open repairs yet.</p>';

      document.querySelectorAll('[data-bid]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.bid;
        const amount = Number(document.getElementById(`amount-${id}`).value);

        if (!Number.isFinite(amount) || amount <= 0) {
          setStatus('Please enter a valid repair estimate.', 'err');
          return;
        }

        const savedProfile = await window.smrAuth.getMechanicProfile();
        const rawNotes = String(document.getElementById(`notes-${id}`).value || '').trim();
        const meta = {
          businessName: savedProfile?.businessName || savedProfile?.name || session.name || session.email,
          businessAddress: savedProfile?.businessAddress || '',
          businessZip: savedProfile?.zip || '',
          businessEmail: savedProfile?.email || session.email || '',
          businessPhone: savedProfile?.phone || ''
        };

        const payload = {
          requestId: Number(id),
          mechanicId: session.id,
          mechanicName: meta.businessName,
          amount,
          etaHours: 24,
          notes: `[META]${JSON.stringify(meta)}[/META] ${rawNotes}`
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

          setStatus('Bid submitted successfully.', 'ok');
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
        businessAddress: document.getElementById('profileBusinessAddress').value,
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
    const wonWrap = document.getElementById('mechBidsWon');
    const activeWrap = document.getElementById('mechBidsActive');
    const otherWrap = document.getElementById('mechBidsOther');

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

        return `<div class='list-card'>
          <div class='head'>
            <strong>${rep?.title ? rep.title : `Request #${b.request_id}`}</strong>
            <span class='pill ${status}'>${status}</span>
          </div>
          <div class='small'>Repair estimate: <b>$${b.amount}</b></div>
          <div class='small'>Repair status: <b>${repStatus}</b></div>
          <div class='small'>${rep?.city || ''}${rep?.city ? ', ' : ''}${rep?.state || ''} · ${rep?.urgency || 'Standard'}</div>
          <div class='small'><b>Repair needed:</b> ${ownerMeta.cleanDetails || 'Request details unavailable.'}</div>
          ${status === 'accepted' ? `<div class='small'><b>Owner contact:</b> ${ownerMeta.ownerPhone || 'No phone'} · ${ownerMeta.ownerEmail || 'No email'}</div>` : ''}
        </div>`;
      };

      const won = bids.filter(b => String(b.status || '').toLowerCase() === 'accepted');
      const active = bids.filter(b => String(b.status || '').toLowerCase() === 'open');
      const other = bids.filter(b => !['accepted', 'open'].includes(String(b.status || '').toLowerCase()));

      wonWrap.innerHTML = won.length ? won.map(renderBidCard).join('') : '<p>No won bids yet.</p>';
      activeWrap.innerHTML = active.length ? active.map(renderBidCard).join('') : '<p>No active bids right now.</p>';
      otherWrap.innerHTML = other.length ? other.map(renderBidCard).join('') : '<p>No other bids yet.</p>';
    } catch (err) {
      const msg = `<p style='color:#ff9a9a'>${err.message || 'Could not load bids.'}</p>`;
      wonWrap.innerHTML = msg;
      activeWrap.innerHTML = msg;
      otherWrap.innerHTML = msg;
    }
  }

  await loadProfile();
  loadRepairs();
  loadDashboard();
}

boot();
