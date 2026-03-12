const modal = document.getElementById('modal');
const openBtns = document.querySelectorAll('.open-modal');
const closeModal = document.getElementById('closeModal');
const closeSuccess = document.getElementById('closeSuccess');
const tabs = document.querySelectorAll('.tab');
const mechOnly = document.getElementById('mechOnly');
const form = document.getElementById('signupForm');
const success = document.getElementById('success');
const submitBtn = document.getElementById('submitBtn');
const signupCount = document.getElementById('signupCount');
const repairsCounter = document.getElementById('repairsCounter');
const prefillEmail = document.getElementById('prefillEmail');
const notifyBtn = document.getElementById('notifyBtn');
const sendOtpBtn = document.getElementById('sendOtpBtn');

function showToast(message, type = 'ok') {
  const existing = document.getElementById('smrToast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'smrToast';
  el.className = `smr-toast ${type === 'error' ? 'error' : 'ok'}`;
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

let currentTab = 'owner';
let liveCounter = 847;

const configuredApiBase = window.APP_CONFIG?.API_BASE || '';
const API_BASE = configuredApiBase.trim().replace(/\/$/, '');
const api = (path) => `${API_BASE}${path}`;

const variants = [
  { h: 'Mechanics & Shops Compete. You Save.', s: 'Post your repair once and compare 3 guaranteed quotes in 24 hours. Always free for car owners.' },
  { h: 'Get Better Price, Quality, and Experience.', s: 'We connect car owners with trusted mechanics and shop owners competing for your job.' }
];
const variant = variants[Math.random() > 0.5 ? 1 : 0];
document.getElementById('heroHeadline').textContent = variant.h;
document.getElementById('heroSubtext').textContent = variant.s;

function setTab(tab){
  currentTab = tab;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab===tab));
  mechOnly.classList.toggle('hidden', tab !== 'mechanic');
  submitBtn.textContent = tab === 'mechanic' ? 'Reserve My Founding Mechanic Spot' : 'Notify Me When We Launch';
}

openBtns.forEach(btn => btn.addEventListener('click', () => {
  setTab(btn.dataset.tab || 'owner');
  modal.classList.remove('hidden');
}));

notifyBtn.addEventListener('click', () => {
  setTab('owner');
  modal.classList.remove('hidden');
  if(prefillEmail.value) form.email.value = prefillEmail.value;
});

closeModal.addEventListener('click', ()=>modal.classList.add('hidden'));
closeSuccess.addEventListener('click', ()=>modal.classList.add('hidden'));
modal.querySelector('.overlay').addEventListener('click', ()=>modal.classList.add('hidden'));
tabs.forEach(t => t.addEventListener('click', ()=>setTab(t.dataset.tab)));

if (sendOtpBtn) {
  sendOtpBtn.style.display = 'none';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawPhone = (form.phone.value || '').replace(/\D/g,'');
  if (rawPhone.length !== 10) return alert('Phone must be 10 digits');

  const payload = {
    name: form.name.value,
    email: form.email.value,
    phone: rawPhone,
    zip: form.zip.value,
    repairAddress: form.repairAddress?.value || '',
    borough: form.borough.value,
    type: currentTab,
    experience: form.experience?.value,
    hasShop: form.hasShop?.value,
    turnstileToken: 'dev-bypass',
    utm: Object.fromEntries(new URLSearchParams(location.search).entries()),
    heroVariant: variant.h
  };

  const r = await fetch(api('/api/signup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) {
    showToast(data.error || 'Something went wrong.', 'error');
    return;
  }

  signupCount.textContent = data.counts.total;

  if (currentTab === 'owner') {
    const ownerSeed = {
      name: form.name.value,
      email: form.email.value,
      phone: rawPhone,
      zip: form.zip.value,
      borough: form.borough.value,
      repairAddress: form.repairAddress?.value || ''
    };
    localStorage.setItem('smr_owner_seed', JSON.stringify(ownerSeed));
    showToast('Signup complete. Redirecting to your dashboard...', 'ok');
    setTimeout(() => { window.location.href = '/owner.html'; }, 450);
    return;
  }

  form.classList.add('hidden');
  success.classList.remove('hidden');
  showToast('Signup complete. You’re on the list!', 'ok');
  form.reset();
});

async function loadCounts(){
  try {
    const r = await fetch(api('/api/stats'));
    if (!r.ok) throw new Error('stats failed');
    const data = await r.json();
    signupCount.textContent = data.total;
  } catch {
    signupCount.textContent = '0';
  }
}
loadCounts();

setInterval(()=>{liveCounter += Math.random() > 0.4 ? 1 : 0; repairsCounter.textContent = liveCounter;}, 3500);

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if(entry.isIntersecting) entry.target.classList.add('show');
  });
},{threshold:.1});
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
