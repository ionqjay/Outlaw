const seed = JSON.parse(localStorage.getItem('smr_owner_seed') || '{}');
const configuredApiBase = window.APP_CONFIG?.API_BASE || '';
const API_BASE = configuredApiBase.trim().replace(/\/$/, '');
const api = (path) => `${API_BASE}${path}`;

const ids = [
  'fullName','email','mobile','vehicleYear','vehicleMake','vehicleModel',
  'issueCategory','issueDetails','serviceAddress','city','state','zip','urgency'
];

for (const id of ids) {
  const el = document.getElementById(id);
  if (!el) continue;
  const keyMap = {
    fullName: 'name',
    mobile: 'phone',
    serviceAddress: 'repairAddress'
  };
  const seedKey = keyMap[id] || id;
  if (seed[seedKey] && !el.value) el.value = seed[seedKey];
}

if (seed.borough && !document.getElementById('city').value) {
  document.getElementById('city').value = seed.borough;
}

document.getElementById('signOutBtn').addEventListener('click', () => {
  localStorage.removeItem('smr_owner_seed');
  window.location.href = '/';
});

document.getElementById('submitOwnerRequest').addEventListener('click', async () => {
  const payload = {
    fullName: document.getElementById('fullName').value,
    email: document.getElementById('email').value,
    mobile: document.getElementById('mobile').value,
    vehicleYear: document.getElementById('vehicleYear').value,
    vehicleMake: document.getElementById('vehicleMake').value,
    vehicleModel: document.getElementById('vehicleModel').value,
    issueCategory: document.getElementById('issueCategory').value,
    issueDetails: document.getElementById('issueDetails').value,
    serviceAddress: document.getElementById('serviceAddress').value,
    city: document.getElementById('city').value,
    state: document.getElementById('state').value,
    zip: document.getElementById('zip').value,
    urgency: document.getElementById('urgency').value
  };

  const status = document.getElementById('ownerStatus');
  status.textContent = 'Submitting...';

  const r = await fetch(api('/api/owner-request'), {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await r.json();

  if (!r.ok) {
    status.textContent = data.error || 'Could not submit request.';
    return;
  }

  status.textContent = `Request #${data.requestId} submitted. Mechanics are being notified.`;
});