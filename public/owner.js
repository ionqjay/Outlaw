const seed = JSON.parse(localStorage.getItem('smr_owner_seed') || '{}');

const configuredApiBase = window.APP_CONFIG?.API_BASE || '';
const API_BASE = configuredApiBase.trim().replace(/\/$/, '');
const api = (path) => `${API_BASE}${path}`;

const fields = {
  fullName: document.getElementById('fullName'),
  email: document.getElementById('email'),
  mobile: document.getElementById('mobile'),
  vehicleYear: document.getElementById('vehicleYear'),
  vehicleMake: document.getElementById('vehicleMake'),
  vehicleModel: document.getElementById('vehicleModel'),
  issueCategory: document.getElementById('issueCategory'),
  issueDetails: document.getElementById('issueDetails'),
  serviceAddress: document.getElementById('serviceAddress'),
  city: document.getElementById('city'),
  state: document.getElementById('state'),
  zip: document.getElementById('zip'),
  urgency: document.getElementById('urgency')
};

const statusEl = document.getElementById('ownerStatus');
const submitBtn = document.getElementById('submitOwnerRequest');

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.classList.remove('success', 'error');
  if (type === 'success') statusEl.classList.add('success');
  if (type === 'error') statusEl.classList.add('error');
}

function seedField(id, seedKey) {
  const el = fields[id];
  if (!el) return;
  if (seed[seedKey] && !el.value) el.value = seed[seedKey];
}

seedField('fullName', 'name');
seedField('email', 'email');
seedField('mobile', 'phone');
seedField('serviceAddress', 'repairAddress');
seedField('zip', 'zip');
if (seed.borough && !fields.city.value) fields.city.value = seed.borough;

function validate() {
  const required = [
    ['fullName', 'Full name'],
    ['email', 'Email'],
    ['mobile', 'Mobile number'],
    ['vehicleYear', 'Vehicle year'],
    ['vehicleMake', 'Vehicle make'],
    ['vehicleModel', 'Vehicle model'],
    ['issueCategory', 'Issue category'],
    ['issueDetails', 'Issue details'],
    ['serviceAddress', 'Service address'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP code']
  ];

  for (const [key, label] of required) {
    if (!String(fields[key].value || '').trim()) {
      throw new Error(`${label} is required.`);
    }
  }

  const email = String(fields.email.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }

  const mobile = String(fields.mobile.value || '').replace(/\D/g, '');
  if (mobile.length !== 10) {
    throw new Error('Please enter a valid 10-digit mobile number.');
  }

  const zip = String(fields.zip.value || '').trim();
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    throw new Error('Please enter a valid ZIP code.');
  }
}

function getPayload() {
  return {
    fullName: fields.fullName.value.trim(),
    email: fields.email.value.trim(),
    mobile: fields.mobile.value,
    vehicleYear: fields.vehicleYear.value.trim(),
    vehicleMake: fields.vehicleMake.value.trim(),
    vehicleModel: fields.vehicleModel.value.trim(),
    issueCategory: fields.issueCategory.value,
    issueDetails: fields.issueDetails.value.trim(),
    serviceAddress: fields.serviceAddress.value.trim(),
    city: fields.city.value.trim(),
    state: fields.state.value.trim(),
    zip: fields.zip.value.trim(),
    urgency: fields.urgency.value
  };
}

document.getElementById('signOutBtn').addEventListener('click', () => {
  localStorage.removeItem('smr_owner_seed');
  window.location.href = '/';
});

submitBtn.addEventListener('click', async () => {
  try {
    validate();
  } catch (err) {
    setStatus(err.message || 'Please check your form.', 'error');
    return;
  }

  const payload = getPayload();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  setStatus('Submitting your request...');

  try {
    const r = await fetch(api('/api/owner-request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || 'Unexpected server response.' };
    }

    if (!r.ok) {
      throw new Error(data.error || 'Could not submit request right now.');
    }

    setStatus(`Success. Request #${data.requestId || 'pending'} submitted. Mechanics will begin sending quotes shortly.`, 'success');
  } catch (err) {
    setStatus(err.message || 'Request failed. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Request for Quotes';
  }
});
