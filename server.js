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
