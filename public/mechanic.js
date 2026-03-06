const API_BASE = (window.APP_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');
const api = (p) => `${API_BASE}${p}`;

function view(name) {
  ['home', 'dashboard', 'repairs'].forEach(v => {
    document.getElementById(`view-${v}`).style.display = v === name ? 'block' : 'none';
  });
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));

async function boot() {
  const session = await window.smrAuth.requireRole('mechanic');
  if (!session) return;

  document.getElementById('logoutBtn').addEventListener('click', () => window.smrAuth.logoutToLogin());

  async function loadRepairs() {
    const wrap = document.getElementById('repairFeed');
    wrap.textContent = 'Loading...';
    const r = await fetch(api('/api/repairs?status=open'));
    const data = await r.json();
    const repairs = data.repairs || [];

    wrap.innerHTML = repairs.length
      ? repairs.map(rep => `<div class='panel'><b>#${rep.id}</b> ${rep.title}<br/>${rep.city}, ${rep.state} • ${rep.urgency}<br/><input placeholder='Bid amount' id='amount-${rep.id}'/><input placeholder='ETA hours' id='eta-${rep.id}'/><textarea id='notes-${rep.id}' placeholder='Notes'></textarea><button class='btn btn-orange' data-bid='${rep.id}'>Submit Bid</button></div>`).join('')
      : '<p>No open repairs yet.</p>';

    document.querySelectorAll('[data-bid]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.bid;
      const payload = {
        requestId: Number(id),
        mechanicId: session.id,
        mechanicName: session.name || session.email,
        amount: Number(document.getElementById(`amount-${id}`).value),
        etaHours: Number(document.getElementById(`eta-${id}`).value),
        notes: document.getElementById(`notes-${id}`).value
      };
      const rr = await fetch(api('/api/bids'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (rr.ok) {
        loadRepairs();
        loadDashboard();
      }
    }));
  }

  async function loadDashboard() {
    const wrap = document.getElementById('mechBids');
    const r = await fetch(api(`/api/bids?mechanicId=${encodeURIComponent(session.id)}`));
    const data = await r.json();
    const bids = data.bids || [];
    wrap.innerHTML = bids.length
      ? bids.map(b => `<div class='panel'>Request #${b.request_id} • $${b.amount} • ${b.status}</div>`).join('')
      : '<p>No bids yet.</p>';
  }

  loadRepairs();
  loadDashboard();
}

boot();