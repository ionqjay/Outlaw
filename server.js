import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';
const DB_PATH = path.join(__dirname, 'signups.json');
const OWNER_REQUESTS_PATH = path.join(__dirname, 'owner_requests.json');
const REPAIR_REQUESTS_PATH = path.join(__dirname, 'repair_requests.json');
const BIDS_PATH = path.join(__dirname, 'bids.json');

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY || '';
const MAILCHIMP_AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || '';
const MAILCHIMP_SERVER_PREFIX = process.env.MAILCHIMP_SERVER_PREFIX || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://shopmyrepair.vercel.app,https://beta.shopmyrepair.com,https://shopmyrepair.com,http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin = '') {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.vercel.app')) return true; // allow Vercel preview deploys
    if (host === 'shopmyrepair.com' || host.endsWith('.shopmyrepair.com')) return true;
  } catch {}
  return false;
}

const otpStore = new Map(); // phone -> { code, exp }

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
function readDb() {
  return readJson(DB_PATH, []);
}
function writeDb(data) {
  writeJson(DB_PATH, data);
}

async function supabaseRequest(pathname, { method = 'GET', body } = {}) {
  if (!USE_SUPABASE) throw new Error('Supabase not configured');
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'count=exact'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase error ${res.status}: ${txt}`);
  }
  if (res.status === 204) return [];
  return res.json();
}

async function listSignups() {
  if (USE_SUPABASE) {
    return supabaseRequest('signups?select=*&order=created_at.desc');
  }
  return readDb();
}

async function createSignup(row) {
  if (USE_SUPABASE) {
    const out = await supabaseRequest('signups', { method: 'POST', body: [row] });
    return out[0];
  }
  const data = readDb();
  const local = {
    Id: (data[0]?.Id || 0) + 1,
    Name: row.name,
    Email: row.email,
    Phone: row.phone,
    ZIP: row.zip,
    RepairAddress: row.repair_address,
    Borough: row.borough,
    Type: row.type,
    Experience: row.experience,
    HasShop: row.has_shop,
    HeroVariant: row.hero_variant,
    UTM: row.utm,
    CreatedDate: row.created_at
  };
  data.unshift(local);
  writeDb(data);
  return local;
}

async function createOwnerRequest(row) {
  if (USE_SUPABASE) {
    const out = await supabaseRequest('owner_requests', { method: 'POST', body: [row] });
    return out[0];
  }
  const requests = readJson(OWNER_REQUESTS_PATH, []);
  const local = {
    Id: (requests[0]?.Id || 0) + 1,
    FullName: row.full_name,
    Email: row.email,
    Mobile: row.mobile,
    VehicleYear: row.vehicle_year,
    VehicleMake: row.vehicle_make,
    VehicleModel: row.vehicle_model,
    IssueCategory: row.issue_category,
    IssueDetails: row.issue_details,
    ServiceAddress: row.service_address,
    City: row.city,
    State: row.state,
    ZIP: row.zip,
    Urgency: row.urgency,
    CreatedDate: row.created_at
  };
  requests.unshift(local);
  writeJson(OWNER_REQUESTS_PATH, requests);
  return local;
}

async function createRepairRequest(row) {
  if (USE_SUPABASE) {
    const out = await supabaseRequest('repair_requests', { method: 'POST', body: [row] });
    return out[0];
  }
  const requests = readJson(REPAIR_REQUESTS_PATH, []);
  const local = {
    id: (requests[0]?.id || 0) + 1,
    owner_id: row.owner_id,
    title: row.title,
    issue_category: row.issue_category,
    issue_details: row.issue_details,
    vehicle_year: row.vehicle_year,
    vehicle_make: row.vehicle_make,
    vehicle_model: row.vehicle_model,
    city: row.city,
    state: row.state,
    zip: row.zip,
    urgency: row.urgency,
    status: row.status,
    created_at: row.created_at
  };
  requests.unshift(local);
  writeJson(REPAIR_REQUESTS_PATH, requests);
  return local;
}

async function listRepairRequests({ ownerId, status } = {}) {
  if (USE_SUPABASE) {
    const q = ['select=*', 'order=created_at.desc'];
    if (ownerId) q.push(`owner_id=eq.${encodeURIComponent(ownerId)}`);
    if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
    return supabaseRequest(`repair_requests?${q.join('&')}`);
  }
  let data = readJson(REPAIR_REQUESTS_PATH, []);
  if (ownerId) data = data.filter(x => String(x.owner_id) === String(ownerId));
  if (status) data = data.filter(x => String(x.status) === String(status));
  return data;
}

async function createBid(row) {
  if (USE_SUPABASE) {
    const out = await supabaseRequest('bids', { method: 'POST', body: [row] });
    return out[0];
  }
  const bids = readJson(BIDS_PATH, []);
  const local = {
    id: (bids[0]?.id || 0) + 1,
    request_id: row.request_id,
    mechanic_id: row.mechanic_id,
    mechanic_name: row.mechanic_name,
    amount: row.amount,
    eta_hours: row.eta_hours,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at
  };
  bids.unshift(local);
  writeJson(BIDS_PATH, bids);
  return local;
}

async function listBids({ requestId, mechanicId, status } = {}) {
  if (USE_SUPABASE) {
    const q = ['select=*', 'order=created_at.desc'];
    if (requestId) q.push(`request_id=eq.${encodeURIComponent(requestId)}`);
    if (mechanicId) q.push(`mechanic_id=eq.${encodeURIComponent(mechanicId)}`);
    if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
    return supabaseRequest(`bids?${q.join('&')}`);
  }
  let data = readJson(BIDS_PATH, []);
  if (requestId) data = data.filter(x => String(x.request_id) === String(requestId));
  if (mechanicId) data = data.filter(x => String(x.mechanic_id) === String(mechanicId));
  if (status) data = data.filter(x => String(x.status) === String(status));
  return data;
}

function counts(data) {
  const total = data.length;
  const owners = data.filter(x => (x.Type || x.type) === 'owner').length;
  const mechanics = data.filter(x => (x.Type || x.type) === 'mechanic').length;
  return { total, owners, mechanics };
}
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET || token === 'dev-bypass') return true;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip || '' });
    const r = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return !!r.data.success;
  } catch {
    return false;
  }
}

async function sendSms(to, text) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return false;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({ To: `+1${to}`, From: TWILIO_FROM_NUMBER, Body: text });
  await axios.post(url, body.toString(), {
    auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return true;
}

async function addToMailchimp(email, firstName, tags = []) {
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID || !MAILCHIMP_SERVER_PREFIX) return false;
  const url = `https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members`;
  await axios.post(url, {
    email_address: email,
    status: 'subscribed',
    merge_fields: { FNAME: firstName || '' },
    tags
  }, {
    auth: { username: 'any', password: MAILCHIMP_API_KEY }
  });
  return true;
}

app.use(cors({
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', async (req, res) => {
  try {
    const data = await listSignups();
    res.json(counts(data));
  } catch (e) {
    res.status(500).json({ error: 'Could not load stats' });
  }
});

app.post('/api/send-otp', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (phone.length !== 10) return res.status(400).json({ error: 'Invalid phone.' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(phone, { code, exp: Date.now() + 10 * 60 * 1000 });

  try {
    const sent = await sendSms(phone, `ShopMyRepair code: ${code} (valid 10 minutes)`);
    if (!sent) return res.json({ ok: true, devCode: code, note: 'Twilio not configured; using dev mode.' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'SMS failed.' });
  }
});

app.post('/api/signup', async (req, res) => {
  const { name, email, phone, zip, repairAddress, borough, type, experience, hasShop, otpCode, turnstileToken, utm, heroVariant } = req.body || {};
  if (!name || !email || !phone || !zip || !borough || !type) return res.status(400).json({ error: 'Missing required fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (!['owner', 'mechanic'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) return res.status(400).json({ error: 'Invalid phone.' });

  const otp = otpStore.get(cleanPhone);
  if (!otp || otp.code !== String(otpCode || '') || Date.now() > otp.exp) {
    return res.status(400).json({ error: 'Invalid or expired SMS code.' });
  }

  const human = await verifyTurnstile(turnstileToken, req.ip);
  if (!human) return res.status(400).json({ error: 'Captcha verification failed.' });

  await createSignup({
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    phone: cleanPhone,
    zip: String(zip).trim(),
    repair_address: String(repairAddress || '').trim(),
    borough: String(borough).trim(),
    type,
    experience: type === 'mechanic' ? (experience || '') : '',
    has_shop: type === 'mechanic' ? (hasShop || '') : '',
    hero_variant: heroVariant || '',
    utm: utm || {},
    created_at: new Date().toISOString()
  });
  otpStore.delete(cleanPhone);

  // Best effort automations
  try {
    await addToMailchimp(String(email).trim().toLowerCase(), String(name).trim(), [type, String(borough).trim()]);
  } catch {}
  try {
    await sendSms(cleanPhone, `You're in 🎉 ShopMyRepair launch updates are on. We'll text you when quotes open in your area.`);
  } catch {}

  const all = await listSignups();
  res.json({ ok: true, counts: counts(all) });
});

app.post('/api/owner-request', async (req, res) => {
  const {
    fullName,
    email,
    mobile,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    issueCategory,
    issueDetails,
    serviceAddress,
    city,
    state,
    zip,
    urgency
  } = req.body || {};

  if (!fullName || !email || !mobile || !vehicleYear || !vehicleMake || !vehicleModel || !issueCategory || !issueDetails || !serviceAddress || !city || !state || !zip) {
    return res.status(400).json({ error: 'Please complete all required owner request fields.' });
  }

  try {
    const created = await createOwnerRequest({
      full_name: String(fullName).trim(),
      email: String(email).trim().toLowerCase(),
      mobile: String(mobile).replace(/\D/g, ''),
      vehicle_year: String(vehicleYear).trim(),
      vehicle_make: String(vehicleMake).trim(),
      vehicle_model: String(vehicleModel).trim(),
      issue_category: String(issueCategory).trim(),
      issue_details: String(issueDetails).trim(),
      service_address: String(serviceAddress).trim(),
      city: String(city).trim(),
      state: String(state).trim(),
      zip: String(zip).trim(),
      urgency: String(urgency || 'Standard').trim(),
      created_at: new Date().toISOString()
    });

    res.json({ ok: true, requestId: created?.id || created?.Id || null });
  } catch {
    res.status(500).json({ error: 'Could not save request right now.' });
  }
});

// --- V1 marketplace APIs ---
app.post('/api/repairs', async (req, res) => {
  const {
    ownerId,
    title,
    issueCategory,
    issueDetails,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    city,
    state,
    zip,
    urgency
  } = req.body || {};

  if (!ownerId || !title || !issueCategory || !issueDetails || !vehicleYear || !vehicleMake || !vehicleModel || !city || !state || !zip) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const created = await createRepairRequest({
      owner_id: String(ownerId).trim(),
      title: String(title).trim(),
      issue_category: String(issueCategory).trim(),
      issue_details: String(issueDetails).trim(),
      vehicle_year: String(vehicleYear).trim(),
      vehicle_make: String(vehicleMake).trim(),
      vehicle_model: String(vehicleModel).trim(),
      city: String(city).trim(),
      state: String(state).trim(),
      zip: String(zip).trim(),
      urgency: String(urgency || 'Standard').trim(),
      status: 'open',
      created_at: new Date().toISOString()
    });
    res.json({ ok: true, repair: created });
  } catch (e) {
    res.status(500).json({ error: 'Could not create repair request.', detail: String(e?.message || e) });
  }
});

app.get('/api/repairs', async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await listRepairRequests({ ownerId, status });
    res.json({ ok: true, repairs: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load repairs.', detail: String(e?.message || e) });
  }
});

app.post('/api/repairs/:id/cancel', async (req, res) => {
  const repairId = Number(req.params.id);
  if (!repairId) return res.status(400).json({ error: 'Invalid repair id.' });

  try {
    if (USE_SUPABASE) {
      const found = await supabaseRequest(`repair_requests?select=*&id=eq.${repairId}&limit=1`);
      if (!found[0]) return res.status(404).json({ error: 'Repair request not found.' });
      if (String(found[0].status || '').toLowerCase() === 'accepted') {
        return res.status(400).json({ error: 'Accepted requests cannot be cancelled.' });
      }
      await supabaseRequest(`repair_requests?id=eq.${repairId}`, { method: 'PATCH', body: { status: 'cancelled' } });
      await supabaseRequest(`bids?request_id=eq.${repairId}&status=eq.open`, { method: 'PATCH', body: { status: 'declined' } });
      return res.json({ ok: true });
    }

    const requests = readJson(REPAIR_REQUESTS_PATH, []);
    const target = requests.find(r => Number(r.id) === repairId);
    if (!target) return res.status(404).json({ error: 'Repair request not found.' });
    if (String(target.status || '').toLowerCase() === 'accepted') {
      return res.status(400).json({ error: 'Accepted requests cannot be cancelled.' });
    }
    requests.forEach(r => {
      if (Number(r.id) === repairId) r.status = 'cancelled';
    });
    writeJson(REPAIR_REQUESTS_PATH, requests);

    const bids = readJson(BIDS_PATH, []);
    bids.forEach(b => {
      if (Number(b.request_id) === repairId && String(b.status || '').toLowerCase() === 'open') b.status = 'declined';
    });
    writeJson(BIDS_PATH, bids);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not cancel request.', detail: String(e?.message || e) });
  }
});

app.post('/api/bids', async (req, res) => {
  const { requestId, mechanicId, mechanicName, amount, etaHours, notes } = req.body || {};
  if (!requestId || !mechanicId || !mechanicName || !amount || !etaHours) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const cleanNotes = String(notes || '').trim();
  if (cleanNotes.replace(/\[META\][\s\S]*?\[\/META\]/g, '').trim().length < 15) {
    return res.status(400).json({ error: 'Please include at least 15 characters in estimate notes.' });
  }

  let providerType = 'mechanic';
  try {
    const m = cleanNotes.match(/\[META\]([\s\S]*?)\[\/META\]/);
    if (m) {
      const parsed = JSON.parse(m[1]);
      const t = String(parsed?.providerType || '').toLowerCase();
      if (t === 'shop' || t === 'mechanic') providerType = t;

      const minimumProfile = [parsed?.businessName, parsed?.businessEmail, parsed?.businessPhone];
      if (minimumProfile.some(v => !String(v || '').trim())) {
        return res.status(400).json({ error: 'Please complete minimum profile info (name, email, phone) before submitting.' });
      }
    }
  } catch {}

  try {
    const existing = await listBids({ requestId: Number(requestId), status: 'open' });
    const countByType = { shop: 0, mechanic: 0 };
    for (const b of existing) {
      const raw = String(b?.notes || '');
      const mm = raw.match(/\[META\]([\s\S]*?)\[\/META\]/);
      let t = null;
      if (mm) {
        try {
          const meta = JSON.parse(mm[1]);
          const parsedType = String(meta?.providerType || '').toLowerCase();
          if (parsedType === 'shop' || parsedType === 'mechanic') t = parsedType;
        } catch {}
      }
      if (t) countByType[t] += 1;
    }

    if (providerType === 'shop' && countByType.shop >= 3) {
      return res.status(400).json({ error: 'This request already has 3 shop estimates.' });
    }
    if (providerType === 'mechanic' && countByType.mechanic >= 2) {
      return res.status(400).json({ error: 'This request already has 2 individual mechanic estimates.' });
    }

    const created = await createBid({
      request_id: Number(requestId),
      mechanic_id: String(mechanicId).trim(),
      mechanic_name: String(mechanicName).trim(),
      amount: Number(amount),
      eta_hours: Number(etaHours),
      notes: cleanNotes,
      status: 'open',
      created_at: new Date().toISOString()
    });
    res.json({ ok: true, bid: created });
  } catch {
    res.status(500).json({ error: 'Could not create bid.' });
  }
});

app.get('/api/bids', async (req, res) => {
  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    const mechanicId = req.query.mechanicId ? String(req.query.mechanicId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await listBids({ requestId, mechanicId, status });
    res.json({ ok: true, bids: rows });
  } catch {
    res.status(500).json({ error: 'Could not load bids.' });
  }
});

app.post('/api/bids/:id/accept', async (req, res) => {
  const bidId = Number(req.params.id);
  if (!bidId) return res.status(400).json({ error: 'Invalid bid id.' });

  try {
    if (USE_SUPABASE) {
      const found = await supabaseRequest(`bids?select=*&id=eq.${bidId}&limit=1`);
      if (!found[0]) return res.status(404).json({ error: 'Bid not found.' });
      const bid = found[0];
      await supabaseRequest(`bids?id=eq.${bidId}`, { method: 'PATCH', body: { status: 'accepted' } });
      await supabaseRequest(`bids?request_id=eq.${bid.request_id}&id=neq.${bidId}`, { method: 'PATCH', body: { status: 'declined' } });
      await supabaseRequest(`repair_requests?id=eq.${bid.request_id}`, { method: 'PATCH', body: { status: 'accepted' } });
      return res.json({ ok: true });
    }

    const bids = readJson(BIDS_PATH, []);
    const target = bids.find(b => Number(b.id) === bidId);
    if (!target) return res.status(404).json({ error: 'Bid not found.' });
    bids.forEach(b => {
      if (Number(b.request_id) === Number(target.request_id)) b.status = Number(b.id) === bidId ? 'accepted' : 'declined';
    });
    writeJson(BIDS_PATH, bids);

    const requests = readJson(REPAIR_REQUESTS_PATH, []);
    requests.forEach(r => {
      if (Number(r.id) === Number(target.request_id)) r.status = 'accepted';
    });
    writeJson(REPAIR_REQUESTS_PATH, requests);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not accept bid.' });
  }
});
app.get('/admin', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).send('<h2>Unauthorized</h2><p>Use /admin?token=YOUR_TOKEN</p>');
  }
  const data = await listSignups();
  const c = counts(data);

  const byBorough = Object.entries(data.reduce((a, r) => {
    const k = r.Borough || r.borough || 'Unknown'; a[k] = (a[k] || 0) + 1; return a;
  }, {})).sort((a, b) => b[1] - a[1]);

  const boroughBars = byBorough.map(([k, v]) => `<div style='margin:6px 0'>${esc(k)}: <b>${v}</b> <span style='display:inline-block;height:8px;background:#e8441a;width:${Math.min(300, v * 12)}px;border-radius:999px'></span></div>`).join('');

  const rows = data.map(r => `<tr><td>${r.Id || r.id || ''}</td><td>${esc(r.Name || r.name || '')}</td><td>${esc(r.Email || r.email || '')}</td><td>${esc(r.Phone || r.phone || '')}</td><td>${esc(r.ZIP || r.zip || '')}</td><td>${esc(r.RepairAddress || r.repair_address || '')}</td><td>${esc(r.Borough || r.borough || '')}</td><td>${r.Type || r.type || ''}</td><td>${esc(r.Experience || r.experience || '')}</td><td>${esc(r.HasShop || r.has_shop || '')}</td><td>${r.CreatedDate || r.created_at || ''}</td></tr>`).join('');

  res.send(`<!doctype html><html><head><meta charset='utf-8'><title>Admin</title><style>
  body{font-family:Arial;background:#0c0c0e;color:#f0ede8;padding:20px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:8px;font-size:12px}
  th{background:#131316}.k{display:flex;gap:12px;margin-bottom:10px}.b{background:#131316;padding:8px 12px;border-radius:10px}
  .panel{background:#131316;padding:12px;border-radius:12px;margin:12px 0}
  </style></head><body><h1>ShopMyRepair Signups</h1><div class='k'>
  <div class='b'>Total <b>${c.total}</b></div><div class='b'>Owners <b>${c.owners}</b></div><div class='b'>Mechanics <b>${c.mechanics}</b></div></div>
  <div class='panel'><h3 style='margin-top:0'>Demand by Borough</h3>${boroughBars || 'No data yet'}</div>
  <table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>ZIP</th><th>Service Address</th><th>Borough</th><th>Type</th><th>Experience</th><th>HasShop</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
});

app.listen(PORT, () => console.log(`Live: http://localhost:${PORT}`));
