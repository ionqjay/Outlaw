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
const REQUEST_INVITES_PATH = path.join(__dirname, 'request_invites.json');
const FEEDBACKS_PATH = path.join(__dirname, 'feedbacks.json');

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

function normalizeProviderType(v) {
  const s = String(v || '').toLowerCase();
  return s === 'shop' ? 'shop' : 'mechanic';
}

function readInvites() {
  return readJson(REQUEST_INVITES_PATH, []);
}

function writeInvites(rows) {
  writeJson(REQUEST_INVITES_PATH, rows);
}

async function createDispatchSnapshot(repair) {
  const allSignups = await listSignups();
  const mechanics = allSignups
    .filter(x => String(x.type || x.Type || '').toLowerCase() === 'mechanic')
    .map(x => {
      const email = String(x.email || x.Email || '').trim().toLowerCase();
      const hasShop = String(x.has_shop || x.HasShop || '').toLowerCase();
      const providerType = (hasShop === 'yes' || hasShop === 'true' || hasShop === 'shop') ? 'shop' : 'mechanic';
      return { email, providerType };
    })
    .filter(x => x.email);

  const shops = mechanics.filter(x => x.providerType === 'shop').slice(0, 3);
  const inds = mechanics.filter(x => x.providerType === 'mechanic').slice(0, 2);
  let invited = [...shops, ...inds];

  if (invited.length < 5) {
    const used = new Set(invited.map(x => `${x.email}:${x.providerType}`));
    for (const p of mechanics) {
      const key = `${p.email}:${p.providerType}`;
      if (used.has(key)) continue;
      invited.push(p);
      used.add(key);
      if (invited.length >= 5) break;
    }
  }

  const rows = readInvites();
  const now = new Date().toISOString();
  const additions = invited.map(p => ({
    repair_id: Number(repair.id || repair.Id),
    provider_email: p.email,
    provider_type: p.providerType,
    created_at: now
  }));
  writeInvites([...rows.filter(r => Number(r.repair_id) !== Number(repair.id || repair.Id)), ...additions]);
}

async function listRepairRequests({ ownerId, status, providerEmail } = {}) {
  if (USE_SUPABASE) {
    const q = ['select=*', 'order=created_at.desc'];
    if (ownerId) q.push(`owner_id=eq.${encodeURIComponent(ownerId)}`);
    if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
    let rows = await supabaseRequest(`repair_requests?${q.join('&')}`);
    if (providerEmail) {
      const invites = readInvites();
      const allowed = new Set(invites.filter(i => String(i.provider_email) === String(providerEmail).toLowerCase()).map(i => Number(i.repair_id)));
      if (allowed.size) rows = rows.filter(r => allowed.has(Number(r.id)));
    }
    return rows;
  }
  let data = readJson(REPAIR_REQUESTS_PATH, []);
  if (ownerId) data = data.filter(x => String(x.owner_id) === String(ownerId));
  if (status) data = data.filter(x => String(x.status) === String(status));
  if (providerEmail) {
    const invites = readInvites();
    const allowed = new Set(invites.filter(i => String(i.provider_email) === String(providerEmail).toLowerCase()).map(i => Number(i.repair_id)));
    if (allowed.size) data = data.filter(x => allowed.has(Number(x.id)));
  }
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

async function listFeedbacks({ requestId, mechanicId } = {}) {
  if (USE_SUPABASE) {
    try {
      const q = ['select=*', 'order=created_at.desc'];
      if (requestId) q.push(`request_id=eq.${encodeURIComponent(requestId)}`);
      if (mechanicId) q.push(`mechanic_id=eq.${encodeURIComponent(mechanicId)}`);
      return await supabaseRequest(`feedbacks?${q.join('&')}`);
    } catch {
      // fallback to file if table not present yet
    }
  }
  let data = readJson(FEEDBACKS_PATH, []);
  if (requestId) data = data.filter(x => String(x.request_id) === String(requestId));
  if (mechanicId) data = data.filter(x => String(x.mechanic_id) === String(mechanicId));
  return data;
}

async function upsertFeedback(row) {
  if (USE_SUPABASE) {
    try {
      const found = await supabaseRequest(`feedbacks?select=*&request_id=eq.${encodeURIComponent(row.request_id)}&limit=1`);
      if (found[0]) {
        await supabaseRequest(`feedbacks?request_id=eq.${encodeURIComponent(row.request_id)}`, { method: 'PATCH', body: {
          bid_id: row.bid_id,
          mechanic_id: row.mechanic_id,
          owner_id: row.owner_id,
          rating: row.rating,
          text: row.text,
          updated_at: new Date().toISOString()
        }});
        const out = await supabaseRequest(`feedbacks?select=*&request_id=eq.${encodeURIComponent(row.request_id)}&limit=1`);
        return out[0];
      }
      const out = await supabaseRequest('feedbacks', { method: 'POST', body: [{ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] });
      return out[0];
    } catch {
      // fallback to file
    }
  }

  const all = readJson(FEEDBACKS_PATH, []);
  const idx = all.findIndex(x => Number(x.request_id) === Number(row.request_id));
  const payload = {
    id: idx >= 0 ? all[idx].id : ((all[0]?.id || 0) + 1),
    request_id: Number(row.request_id),
    bid_id: Number(row.bid_id),
    mechanic_id: String(row.mechanic_id),
    owner_id: String(row.owner_id || ''),
    rating: Number(row.rating),
    text: String(row.text || ''),
    created_at: idx >= 0 ? all[idx].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (idx >= 0) all[idx] = payload;
  else all.unshift(payload);
  writeJson(FEEDBACKS_PATH, all);
  return payload;
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
  res.json({ ok: true, disabled: true, note: 'SMS verification is temporarily disabled.' });
});

app.post('/api/signup', async (req, res) => {
  const { name, email, phone, zip, repairAddress, borough, type, experience, hasShop, turnstileToken, utm, heroVariant } = req.body || {};
  if (!name || !email || !phone || !zip || !borough || !type) return res.status(400).json({ error: 'Missing required fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (!['owner', 'mechanic'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) return res.status(400).json({ error: 'Invalid phone.' });

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
  // SMS OTP disabled for now.

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
    try { await createDispatchSnapshot(created); } catch {}
    res.json({ ok: true, repair: created });
  } catch (e) {
    res.status(500).json({ error: 'Could not create repair request.', detail: String(e?.message || e) });
  }
});

app.get('/api/repairs', async (req, res) => {
  try {
    const ownerId = req.query.ownerId ? String(req.query.ownerId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const providerEmail = req.query.providerEmail ? String(req.query.providerEmail).toLowerCase() : undefined;
    const rows = await listRepairRequests({ ownerId, status, providerEmail });
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

app.post('/api/repairs/:id/complete', async (req, res) => {
  const repairId = Number(req.params.id);
  if (!repairId) return res.status(400).json({ error: 'Invalid repair id.' });
  try {
    if (USE_SUPABASE) {
      const found = await supabaseRequest(`repair_requests?select=*&id=eq.${repairId}&limit=1`);
      if (!found[0]) return res.status(404).json({ error: 'Repair request not found.' });
      const st = String(found[0].status || '').toLowerCase();
      if (!['accepted', 'in_progress', 'completed'].includes(st)) return res.status(400).json({ error: 'Only accepted/in-progress jobs can be completed.' });
      await supabaseRequest(`repair_requests?id=eq.${repairId}`, { method: 'PATCH', body: { status: 'completed' } });
      return res.json({ ok: true });
    }

    const requests = readJson(REPAIR_REQUESTS_PATH, []);
    const target = requests.find(r => Number(r.id) === repairId);
    if (!target) return res.status(404).json({ error: 'Repair request not found.' });
    const st = String(target.status || '').toLowerCase();
    if (!['accepted', 'in_progress', 'completed'].includes(st)) return res.status(400).json({ error: 'Only accepted/in-progress jobs can be completed.' });
    target.status = 'completed';
    writeJson(REPAIR_REQUESTS_PATH, requests);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not complete request.', detail: String(e?.message || e) });
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
  let providerEmail = '';
  try {
    const m = cleanNotes.match(/\[META\]([\s\S]*?)\[\/META\]/);
    if (m) {
      const parsed = JSON.parse(m[1]);
      const t = String(parsed?.providerType || '').toLowerCase();
      if (t === 'shop' || t === 'mechanic') providerType = t;
      providerEmail = String(parsed?.businessEmail || '').trim().toLowerCase();

      const minimumProfile = [parsed?.businessName, parsed?.businessEmail, parsed?.businessPhone];
      if (minimumProfile.some(v => !String(v || '').trim())) {
        return res.status(400).json({ error: 'Please complete minimum profile info (name, email, phone) before submitting.' });
      }
    }
  } catch {}

  try {
    const existingAllForRequest = await listBids({ requestId: Number(requestId) });
    if (existingAllForRequest.some(b => String(b.mechanic_id) === String(mechanicId) && String(b.status || '').toLowerCase() !== 'declined')) {
      return res.status(400).json({ error: 'You already submitted an estimate for this request.' });
    }

    const invites = readInvites().filter(i => Number(i.repair_id) === Number(requestId));
    if (invites.length && providerEmail) {
      const invited = invites.some(i => String(i.provider_email) === providerEmail && normalizeProviderType(i.provider_type) === providerType);
      if (!invited) {
        return res.status(400).json({ error: 'This request was not dispatched to your profile type.' });
      }
    }

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

app.get('/api/feedbacks', async (req, res) => {
  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    const mechanicId = req.query.mechanicId ? String(req.query.mechanicId) : undefined;
    const rows = await listFeedbacks({ requestId, mechanicId });
    res.json({ ok: true, feedbacks: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load feedbacks.', detail: String(e?.message || e) });
  }
});

app.post('/api/feedbacks', async (req, res) => {
  const { requestId, bidId, mechanicId, ownerId, rating, text } = req.body || {};
  if (!requestId || !bidId || !mechanicId || !rating) return res.status(400).json({ error: 'Missing required fields.' });
  const score = Number(rating);
  if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

  try {
    const repair = (await listRepairRequests({})).find(r => Number(r.id) === Number(requestId));
    const st = String(repair?.status || '').toLowerCase();
    if (st !== 'completed') return res.status(400).json({ error: 'Reviews can only be submitted for completed jobs.' });

    const saved = await upsertFeedback({
      request_id: Number(requestId),
      bid_id: Number(bidId),
      mechanic_id: String(mechanicId),
      owner_id: String(ownerId || ''),
      rating: score,
      text: String(text || '').trim()
    });
    res.json({ ok: true, feedback: saved });
  } catch (e) {
    res.status(500).json({ error: 'Could not save feedback.', detail: String(e?.message || e) });
  }
});

app.get('/provider/:id', async (req, res) => {
  const mechanicId = String(req.params.id || '').trim();
  if (!mechanicId) return res.status(400).send('Invalid provider id');

  try {
    const bids = await listBids({ mechanicId });
    const feedbacks = await listFeedbacks({ mechanicId });
    const avg = feedbacks.length ? Math.round((feedbacks.reduce((s, f) => s + Number(f.rating || 0), 0) / feedbacks.length) * 10) / 10 : null;
    const latest = bids.slice(0, 8).map(b => `<li>Request #${b.request_id} · $${b.amount} · ${String(b.status || '').toLowerCase()}</li>`).join('');
    const fb = feedbacks.slice(0, 8).map(f => `<li>${Number(f.rating || 0)}/5${f.text ? ` — ${esc(f.text)}` : ''}</li>`).join('');

    res.send(`<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Provider Profile</title><style>
      body{font-family:Inter,Arial,sans-serif;background:#0e1016;color:#eef2ff;padding:22px}
      .wrap{max-width:820px;margin:0 auto}.card{background:#151b2a;border:1px solid #2d3550;border-radius:14px;padding:14px;margin-top:10px}
      .k{color:#a9b4d2;font-size:12px}.v{font-size:28px;font-weight:800}
      li{margin:6px 0}
    </style></head><body><div class='wrap'>
      <h1>Provider Profile</h1><div class='k'>ID: ${esc(mechanicId)}</div>
      <div class='card'><div class='k'>Average Rating</div><div class='v'>${avg ?? 'N/A'}</div><div class='k'>${feedbacks.length} review(s)</div></div>
      <div class='card'><h3>Recent Estimate Activity</h3><ul>${latest || '<li>No activity yet.</li>'}</ul></div>
      <div class='card'><h3>Recent Reviews</h3><ul>${fb || '<li>No reviews yet.</li>'}</ul></div>
    </div></body></html>`);
  } catch (e) {
    res.status(500).send(`Could not load provider profile: ${esc(String(e?.message || e))}`);
  }
});
app.get('/api/admin/ops', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const repairs = await listRepairRequests({});
    const bids = await listBids({});
    const invites = readInvites();
    const openRepairs = repairs.filter(r => String(r.status || '').toLowerCase() === 'open').length;
    const acceptedRepairs = repairs.filter(r => String(r.status || '').toLowerCase() === 'accepted').length;
    const avgBidsPerOpen = openRepairs ? (bids.filter(b => String(b.status || '').toLowerCase() === 'open').length / openRepairs) : 0;
    res.json({
      ok: true,
      kpis: {
        totalRepairs: repairs.length,
        openRepairs,
        acceptedRepairs,
        totalBids: bids.length,
        openBids: bids.filter(b => String(b.status || '').toLowerCase() === 'open').length,
        avgBidsPerOpen: Math.round(avgBidsPerOpen * 10) / 10,
        totalInvites: invites.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load ops data', detail: String(e?.message || e) });
  }
});

app.get('/admin/ops', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).send('<h2>Unauthorized</h2><p>Use /admin/ops?token=YOUR_TOKEN</p>');
  }
  res.send(`<!doctype html><html><head><meta charset='utf-8'><title>Ops Dashboard</title><meta name='viewport' content='width=device-width,initial-scale=1'><style>
  :root{--bg:#0b0d12;--card:#131722;--stroke:#293043;--text:#f2f4fb;--muted:#aeb7cc}
  *{box-sizing:border-box} body{font-family:Inter,Arial,sans-serif;background:radial-gradient(900px 300px at 0 -120px,rgba(95,143,255,.14),transparent 60%),var(--bg);color:var(--text);margin:0;padding:22px}
  .wrap{max-width:1200px;margin:0 auto} .top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}
  .k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px} .card{background:var(--card);border:1px solid var(--stroke);border-radius:14px;padding:12px}
  .lbl{font-size:12px;color:var(--muted)} .val{font-size:30px;font-weight:800;margin-top:4px}
  .hint{color:var(--muted);font-size:12px;margin-top:6px} a{color:#9fc1ff;text-decoration:none}
  @media(max-width:980px){.k{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style></head><body><div class='wrap'><div class='top'><div><h1>ShopMyRepair Ops Dashboard</h1><div class='hint'>Live marketplace health and delivery metrics</div></div><div><a href='/admin?token=${encodeURIComponent(String(req.query.token||''))}'>← Back to Signups Admin</a></div></div>
  <div id='k' class='k'><div class='card'>Loading...</div></div>
  <script>
    fetch('/api/admin/ops?token=${encodeURIComponent(String(req.query.token||''))}').then(r=>r.json()).then(d=>{
      const k=d.kpis||{};
      const entries=[
        ['Total Repairs',k.totalRepairs,'All requests created'],
        ['Open Repairs',k.openRepairs,'Need more estimate coverage'],
        ['Accepted Repairs',k.acceptedRepairs,'Converted jobs'],
        ['Total Estimates',k.totalBids,'All estimates submitted'],
        ['Open Estimates',k.openBids,'Awaiting owner action'],
        ['Avg Estimates / Open Repair',k.avgBidsPerOpen,'Supply depth indicator'],
        ['Dispatch Invites',k.totalInvites,'Providers invited to jobs']
      ];
      document.getElementById('k').innerHTML=entries.map(([l,v,h])=>'<div class="card"><div class="lbl">'+l+'</div><div class="val">'+(v??0)+'</div><div class="hint">'+h+'</div></div>').join('');
    }).catch(()=>{ document.getElementById('k').innerHTML='<div class="card">Could not load ops data.</div>'; });
  </script></div></body></html>`);
});

app.get('/admin', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).send('<h2>Unauthorized</h2><p>Use /admin?token=YOUR_TOKEN</p>');
  }
  let data = [];
  let loadError = '';
  try {
    data = await listSignups();
  } catch (e) {
    loadError = String(e?.message || e);
  }
  const c = counts(data);

  const byBorough = Object.entries(data.reduce((a, r) => {
    const k = r.Borough || r.borough || 'Unknown'; a[k] = (a[k] || 0) + 1; return a;
  }, {})).sort((a, b) => b[1] - a[1]);

  const byZip = Object.entries(data.reduce((a, r) => {
    const k = String(r.ZIP || r.zip || 'Unknown').trim() || 'Unknown'; a[k] = (a[k] || 0) + 1; return a;
  }, {})).sort((a, b) => b[1] - a[1]);

  const since = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const last7 = data.filter(r => {
    const dt = new Date(r.CreatedDate || r.created_at || 0).getTime();
    return Number.isFinite(dt) && dt >= since;
  }).length;

  const shopCount = data.filter(r => {
    const hasShop = String(r.HasShop || r.has_shop || '').toLowerCase();
    return hasShop === 'yes' || hasShop === 'true' || hasShop === 'shop';
  }).length;
  const indyMech = Math.max(0, c.mechanics - shopCount);
  const ownerPct = c.total ? Math.round((c.owners / c.total) * 100) : 0;
  const mechPct = c.total ? Math.round((c.mechanics / c.total) * 100) : 0;

  const boroughBars = byBorough.slice(0, 8).map(([k, v]) => `<div style='margin:8px 0'>${esc(k)} <b style='float:right'>${v}</b><div style='margin-top:5px;height:8px;background:#1a1d27;border-radius:999px;overflow:hidden'><span style='display:block;height:100%;background:linear-gradient(90deg,#ff7b54,#e8441a);width:${Math.min(100, c.total ? (v / c.total) * 100 : 0)}%'></span></div></div>`).join('');

  const recentRows = data.slice(0, 50).map(r => `<tr><td>${r.Id || r.id || ''}</td><td>${esc(r.Name || r.name || '')}</td><td>${esc(r.Type || r.type || '')}</td><td>${esc(r.Borough || r.borough || '')}</td><td>${esc(r.ZIP || r.zip || '')}</td><td>${esc(r.Email || r.email || '')}</td><td>${r.CreatedDate || r.created_at || ''}</td></tr>`).join('');

  res.send(`<!doctype html><html><head><meta charset='utf-8'><title>ShopMyRepair Admin</title><meta name='viewport' content='width=device-width,initial-scale=1'><style>
  :root{--bg:#0b0d12;--card:#131722;--stroke:#293043;--text:#f2f4fb;--muted:#aeb7cc;--orange:#e8441a}
  *{box-sizing:border-box} body{font-family:Inter,Arial,sans-serif;background:radial-gradient(900px 300px at 0 -120px,rgba(232,68,26,.16),transparent 60%),var(--bg);color:var(--text);margin:0;padding:22px}
  h1,h2,h3{margin:0} .wrap{max-width:1200px;margin:0 auto} .top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  a{color:#ffb194;text-decoration:none} .grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px} .card{background:var(--card);border:1px solid var(--stroke);border-radius:14px;padding:12px}
  .k{font-size:12px;color:var(--muted)} .v{font-size:28px;font-weight:800;margin-top:4px} .span2{grid-column:span 2} .span3{grid-column:span 3} .span6{grid-column:span 6}
  .pill{display:inline-block;border:1px solid #38415a;background:#151c2d;color:#dbe5ff;border-radius:999px;padding:4px 9px;font-size:11px}
  table{width:100%;border-collapse:collapse} th,td{padding:8px;border-bottom:1px solid #252c3e;font-size:12px;text-align:left} th{color:#c7d0e5;background:#111625;position:sticky;top:0}
  .tbl{max-height:420px;overflow:auto;border:1px solid var(--stroke);border-radius:12px}
  .warn{border:1px solid #7b3b3b;background:#2a1414;color:#ffcbcb;border-radius:12px;padding:10px;margin-top:10px}
  @media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.span2,.span3,.span6{grid-column:span 2}}
  </style></head><body><div class='wrap'>
  <div class='top'><div><h1>ShopMyRepair Admin</h1><div style='color:var(--muted);margin-top:4px'>Business overview + lead quality + demand hotspots</div></div><div><a href='/admin/ops?token=${encodeURIComponent(String(req.query.token||''))}'>Open Ops Dashboard →</a></div></div>

  <div class='grid'>
    <div class='card'><div class='k'>Total Signups</div><div class='v'>${c.total}</div></div>
    <div class='card'><div class='k'>Owners</div><div class='v'>${c.owners}</div><div class='k'>${ownerPct}% of total</div></div>
    <div class='card'><div class='k'>Mechanics (All)</div><div class='v'>${c.mechanics}</div><div class='k'>${mechPct}% of total</div></div>
    <div class='card'><div class='k'>Mechanic Shops</div><div class='v'>${shopCount}</div></div>
    <div class='card'><div class='k'>Individual Mechanics</div><div class='v'>${indyMech}</div></div>
    <div class='card'><div class='k'>New Last 7 Days</div><div class='v'>${last7}</div></div>

    <div class='card span3'><h3>Demand by Borough</h3><div style='margin-top:8px'>${boroughBars || '<div class="k">No borough data yet</div>'}</div></div>
    <div class='card span3'><h3>Quick Signals</h3><div style='margin-top:8px' class='k'>Top ZIP: <b>${esc(byZip[0]?.[0] || 'N/A')}</b> (${byZip[0]?.[1] || 0})</div><div class='k' style='margin-top:6px'>Top Borough: <b>${esc(byBorough[0]?.[0] || 'N/A')}</b> (${byBorough[0]?.[1] || 0})</div><div class='k' style='margin-top:10px'>Use this to focus ad spend + mechanic recruitment in top demand zones.</div><div style='margin-top:10px'><span class='pill'>Leads</span> <span class='pill'>Supply Mix</span> <span class='pill'>Geo Demand</span></div></div>

    ${loadError ? `<div class='span6 warn'><h3 style='margin:0 0 6px 0'>Data source error</h3><div>${esc(loadError)}</div><div style='margin-top:6px'>Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on deploy, or unset both for JSON fallback.</div></div>` : ''}

    <div class='card span6'><h3>Recent Signups (latest 50)</h3><div class='tbl' style='margin-top:8px'><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Borough</th><th>ZIP</th><th>Email</th><th>Created</th></tr></thead><tbody>${recentRows || '<tr><td colspan="7">No signups yet.</td></tr>'}</tbody></table></div></div>
  </div>
  </div></body></html>`);
});

app.listen(PORT, () => console.log(`Live: http://localhost:${PORT}`));
