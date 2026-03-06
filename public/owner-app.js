const API_BASE = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');
const api = (p) => `${API_BASE}${p}`;

function view(name) {
  ['home', 'dashboard', 'quote'].forEach(v => {
    document.getElementById(`view-${v}`).style.display = v === name ? 'block' : 'none';
  });
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));

async function boot() {
  const session = await window.smrAuth.requireRole('owner');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  async function loadDashboard() {
    const reqWrap = document.getElementById('ownerRequests');
    const bidWrap = document.getElementById('ownerBids');
    reqWrap.textContent = 'Loading...';

    const r = await fetch(api(`/api/repairs?ownerId=${encodeURIComponent(session.id)}`));
    const data = await r.json();
    const repairs = data.repairs || [];
    reqWrap.innerHTML = repairs.length
      ? repairs.map(x => `<div class='panel'><b>#${x.id}</b> ${x.title} — ${x.status}</div>`).join('')
      : '<p>No open requests yet.</p>';

    const bids = [];
    for (const rep of repairs) {
      const br = await fetch(api(`/api/bids?requestId=${rep.id}`));
      const bd = await br.json();
      (bd.bids || []).forEach(b => bids.push(b));
    }

    bidWrap.innerHTML = bids.length
      ? bids.map(b => `<div class='panel'>$${b.amount} • ${b.eta_hours}h • ${b.mechanic_name} <button class='btn btn-green' data-accept='${b.id}'>Accept</button></div>`).join('')
      : '<p>No bids yet.</p>';

    document.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
      await fetch(api(`/api/bids/${btn.dataset.accept}/accept`), { method: 'POST' });
      loadDashboard();
    }));
  }

  document.getElementById('submitRepairBtn').addEventListener('click', async () => {
    const payload = {
      ownerId: session.id,
      title: document.getElementById('title').value,
      issueCategory: document.getElementById('issueCategory').value,
      issueDetails: document.getElementById('issueDetails').value,
      vehicleYear: document.getElementById('vehicleYear').value,
      vehicleMake: document.getElementById('vehicleMake').value,
      vehicleModel: document.getElementById('vehicleModel').value,
      city: document.getElementById('city').value,
      state: document.getElementById('state').value,
      zip: document.getElementById('zip').value,
      urgency: document.getElementById('urgency').value
    };

    const status = document.getElementById('ownerStatus');
    status.textContent = 'Submitting...';
    const r = await fetch(api('/api/repairs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) return status.textContent = data.error || 'Failed.';

    status.textContent = 'Request submitted.';
    view('dashboard');
    loadDashboard();
  });

  loadDashboard();
}

boot();