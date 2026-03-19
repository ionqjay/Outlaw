import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import cors from 'cors';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function getAdminTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerToken = String(req.headers['x-admin-token'] || '').trim();
  if (headerToken) return headerToken;
  return String(req.query.token || '').trim();
}

function isAdminConfigValid() {
  return !!ADMIN_TOKEN && ADMIN_TOKEN !== 'change-me';
}

function isAuthorizedAdminRequest(req) {
  if (!isAdminConfigValid()) return false;
  return getAdminTokenFromRequest(req) === ADMIN_TOKEN;
}

function guardAdminApi(req, res) {
  if (!isAdminConfigValid()) {
    return res.status(503).json({ error: 'Admin API disabled: set a strong ADMIN_TOKEN environment variable.' });
  }
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return null;
}
const DB_PATH = path.join(__dirname, 'signups.json');
const OWNER_REQUESTS_PATH = path.join(__dirname, 'owner_requests.json');
const REPAIR_REQUESTS_PATH = path.join(__dirname, 'repair_requests.json');
const BIDS_PATH = path.join(__dirname, 'bids.json');
const REQUEST_INVITES_PATH = path.join(__dirname, 'request_invites.json');
const FEEDBACKS_PATH = path.join(__dirname, 'feedbacks.json');
const BILLING_ACCOUNTS_PATH = path.join(__dirname, 'billing_accounts.json');
const BANNED_ACCOUNTS_PATH = path.join(__dirname, 'banned_accounts.json');

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

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_SHOP_MONTHLY = process.env.STRIPE_PRICE_SHOP_MONTHLY || '';
const STRIPE_PRICE_MECHANIC_MONTHLY = process.env.STRIPE_PRICE_MECHANIC_MONTHLY || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const STANDARD_INVITE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h
const URGENT_INVITE_WINDOW_MS = 45 * 60 * 1000; // 45m
const MAX_REQUEST_AGE_MS = 24 * 60 * 60 * 1000; // 24h
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

function readBillingAccounts() {
  return readJson(BILLING_ACCOUNTS_PATH, []);
}

function writeBillingAccounts(rows) {
  writeJson(BILLING_ACCOUNTS_PATH, rows);
}

function getBillingByUserId(userId) {
  if (!userId) return null;
  const rows = readBillingAccounts();
  return rows.find(r => String(r.user_id) === String(userId)) || null;
}

function upsertBillingByUserId(userId, patch = {}) {
  const rows = readBillingAccounts();
  const idx = rows.findIndex(r => String(r.user_id) === String(userId));
  const base = idx >= 0 ? rows[idx] : { user_id: String(userId), created_at: new Date().toISOString() };
  const next = {
    ...base,
    ...patch,
    user_id: String(userId),
    updated_at: new Date().toISOString()
  };
  if (idx >= 0) rows[idx] = next;
  else rows.unshift(next);
  writeBillingAccounts(rows);
  return next;
}

function isSubscriptionActive(status) {
  return ['active', 'trialing', 'past_due'].includes(String(status || '').toLowerCase());
}

function canSubmitEstimatesFromBilling(billing) {
  if (!billing) return false;
  const override = String(billing.manual_access_override || '').toLowerCase();
  if (override === 'disabled') return false;
  if (override === 'active') return true;
  return isSubscriptionActive(billing.subscription_status);
}

function readBannedAccounts() {
  return readJson(BANNED_ACCOUNTS_PATH, []);
}

function writeBannedAccounts(rows) {
  writeJson(BANNED_ACCOUNTS_PATH, rows);
}

function isBannedEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return readBannedAccounts().some(x => String(x.email || '').toLowerCase() === e && x.active !== false);
}

function setBannedEmail(email, active, reason = '', category = '') {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const rows = readBannedAccounts();
  const idx = rows.findIndex(x => String(x.email || '').toLowerCase() === e);
  const payload = idx >= 0 ? rows[idx] : { email: e, created_at: new Date().toISOString() };
  const next = {
    ...payload,
    email: e,
    active: !!active,
    reason: String(reason || payload.reason || ''),
    category: String(category || payload.category || ''),
    updated_at: new Date().toISOString()
  };
  if (idx >= 0) rows[idx] = next;
  else rows.unshift(next);
  writeBannedAccounts(rows);
  return next;
}

function resolvePriceForRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'shop') return STRIPE_PRICE_SHOP_MONTHLY || STRIPE_PRICE_MECHANIC_MONTHLY;
  return STRIPE_PRICE_MECHANIC_MONTHLY || STRIPE_PRICE_SHOP_MONTHLY;
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

async function listAuthUsers() {
  if (!USE_SUPABASE) return [];
  try {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.users) ? data.users : [];
  } catch {
    return [];
  }
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

function normalizeServiceKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function providerSupportsRepair(provider, repair) {
  const providerServices = String(provider?.services || '').trim().toLowerCase();
  if (!providerServices) return true; // fallback for older profiles with no specialties yet
  const set = new Set(providerServices.split(',').map(normalizeServiceKey).filter(Boolean));
  if (!set.size) return true;
  const category = normalizeServiceKey(repair?.issue_category || repair?.IssueCategory || '');
  if (!category) return true;
  return set.has(category) || set.has('other');
}

function providerEligibleForInvites(provider) {
  return !!provider?.can_submit_estimates;
}

function toPreviewRepair(r) {
  return {
    ...r,
    title: String(r?.title || 'Open Repair Request'),
    issue_details: 'Repair details are unlocked after invitation/subscription.',
    city: String(r?.city || ''),
    state: String(r?.state || ''),
    zip: String(r?.zip || '').slice(0, 3) + 'xx',
    vehicle_model: 'Hidden model',
    __preview_locked: true
  };
}

function getInviteWindowMs(urgency = '') {
  const s = String(urgency || '').toLowerCase();
  return s.includes('urgent') ? URGENT_INVITE_WINDOW_MS : STANDARD_INVITE_WINDOW_MS;
}

function requestIsExpiredForNewInvites(repair) {
  const created = new Date(repair?.created_at || repair?.CreatedDate || 0).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created > MAX_REQUEST_AGE_MS;
}

function readInvites() {
  return readJson(REQUEST_INVITES_PATH, []);
}

function writeInvites(rows) {
  writeJson(REQUEST_INVITES_PATH, rows);
}

async function listProviderPool() {
  const providers = [];

  const authUsers = await listAuthUsers();
  for (const u of authUsers) {
    const meta = u?.user_metadata || {};
    const role = String(meta?.role || '').toLowerCase();
    if (!['mechanic', 'shop'].includes(role)) continue;
    const email = String(u?.email || '').trim().toLowerCase();
    if (!email) continue;
    const billing = getBillingByUserId(String(u?.id || ''));
    providers.push({
      email,
      userId: String(u?.id || ''),
      providerType: role === 'shop' ? 'shop' : 'mechanic',
      services: String(meta?.services || '').trim().toLowerCase(),
      can_submit_estimates: canSubmitEstimatesFromBilling(billing)
    });
  }

  if (!providers.length) {
    const allSignups = await listSignups();
    for (const x of allSignups) {
      if (String(x.type || x.Type || '').toLowerCase() !== 'mechanic') continue;
      const email = String(x.email || x.Email || '').trim().toLowerCase();
      if (!email) continue;
      const hasShop = String(x.has_shop || x.HasShop || '').toLowerCase();
      const providerType = (hasShop === 'yes' || hasShop === 'true' || hasShop === 'shop') ? 'shop' : 'mechanic';
      providers.push({ email, providerType, services: '', can_submit_estimates: false });
    }
  }

  const seen = new Set();
  return providers.filter(p => {
    const key = `${p.email}:${p.providerType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function createDispatchSnapshot(repair) {
  const mechanics = (await listProviderPool())
    .filter(x => providerEligibleForInvites(x))
    .filter(x => providerSupportsRepair(x, repair));

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
  const now = Date.now();
  const windowMs = getInviteWindowMs(repair?.urgency);
  const additions = invited.map(p => ({
    repair_id: Number(repair.id || repair.Id),
    provider_email: p.email,
    provider_type: p.providerType,
    status: 'pending',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + windowMs).toISOString(),
    submitted_at: null
  }));
  writeInvites([...rows.filter(r => Number(r.repair_id) !== Number(repair.id || repair.Id)), ...additions]);
}

async function processInviteExpirations(repairs = []) {
  if (!Array.isArray(repairs) || !repairs.length) return;
  const rows = readInvites();
  const pool = await listProviderPool();
  const now = Date.now();
  let changed = false;

  for (const repair of repairs) {
    const repairId = Number(repair.id || repair.Id);
    if (!repairId) continue;
    if (String(repair.status || '').toLowerCase() !== 'open') continue;

    const rInvites = rows.filter(r => Number(r.repair_id) === repairId);
    for (const inv of rInvites) {
      if (String(inv.status || 'pending') !== 'pending') continue;
      const exp = new Date(inv.expires_at || 0).getTime();
      if (!Number.isFinite(exp) || exp > now) continue;

      inv.status = 'expired';
      inv.expired_at = new Date(now).toISOString();
      changed = true;

      if (requestIsExpiredForNewInvites(repair)) continue;

      const type = normalizeProviderType(inv.provider_type);
      const used = new Set(rInvites.map(x => `${String(x.provider_email || '').toLowerCase()}:${normalizeProviderType(x.provider_type)}`));
      const next = pool.find(p => p.providerType === type && providerEligibleForInvites(p) && providerSupportsRepair(p, repair) && !used.has(`${p.email}:${p.providerType}`));
      if (!next) continue;

      const windowMs = getInviteWindowMs(repair?.urgency);
      rows.push({
        repair_id: repairId,
        provider_email: next.email,
        provider_type: next.providerType,
        status: 'pending',
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + windowMs).toISOString(),
        submitted_at: null,
        replaced_from: String(inv.provider_email || '').toLowerCase()
      });
      changed = true;
    }
  }

  if (changed) writeInvites(rows);
}

async function ensureProviderInvitesForOpenRequests(providerEmail, repairs = [], providerTypeHint = 'mechanic', providerServicesHint = '') {
  const email = String(providerEmail || '').trim().toLowerCase();
  if (!email) return;

  const pool = await listProviderPool();
  const provider = pool.find(p => String(p.email || '').toLowerCase() === email)
    || { email, providerType: normalizeProviderType(providerTypeHint), services: String(providerServicesHint || '').trim().toLowerCase(), can_submit_estimates: false };

  if (!providerEligibleForInvites(provider)) return;

  const rows = readInvites();
  const now = Date.now();
  let changed = false;

  for (const repair of repairs) {
    const repairId = Number(repair?.id || repair?.Id);
    if (!repairId) continue;
    if (String(repair?.status || '').toLowerCase() !== 'open') continue;
    if (requestIsExpiredForNewInvites(repair)) continue;
    if (!providerSupportsRepair(provider, repair)) continue;

    const alreadyInvited = rows.some(i => (
      Number(i.repair_id) === repairId
      && String(i.provider_email || '').toLowerCase() === email
      && normalizeProviderType(i.provider_type) === provider.providerType
    ));
    if (alreadyInvited) continue;

    const windowMs = getInviteWindowMs(repair?.urgency);
    rows.push({
      repair_id: repairId,
      provider_email: email,
      provider_type: provider.providerType,
      status: 'pending',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + windowMs).toISOString(),
      submitted_at: null,
      auto_backfill: true
    });
    changed = true;
  }

  if (changed) writeInvites(rows);
}

async function listRepairRequests({ ownerId, status, providerEmail, providerType, providerServices, previewLeads } = {}) {
  if (USE_SUPABASE) {
    const q = ['select=*', 'order=created_at.desc'];
    if (ownerId) q.push(`owner_id=eq.${encodeURIComponent(ownerId)}`);
    if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
    let rows = await supabaseRequest(`repair_requests?${q.join('&')}`);
    try { await processInviteExpirations(rows); } catch {}
    if (providerEmail) {
      try { await ensureProviderInvitesForOpenRequests(providerEmail, rows, providerType, providerServices); } catch {}
      const pool = await listProviderPool();
      const provider = pool.find(p => String(p.email || '').toLowerCase() === String(providerEmail).toLowerCase());
      const canSeeInvitedFull = providerEligibleForInvites(provider);
      const now = Date.now();
      const invites = readInvites();
      const activeInvites = invites
        .filter(i => String(i.provider_email) === String(providerEmail).toLowerCase())
        .filter(i => String(i.status || 'pending') === 'pending')
        .filter(i => {
          const exp = new Date(i.expires_at || 0).getTime();
          return Number.isFinite(exp) ? exp > now : true;
        });
      const byRepair = new Map(activeInvites.map(i => [Number(i.repair_id), i]));
      const invitedRows = canSeeInvitedFull
        ? rows
          .filter(r => byRepair.has(Number(r.id)))
          .map(r => ({ ...r, invite_expires_at: byRepair.get(Number(r.id))?.expires_at || null }))
        : [];

      if (previewLeads) {
        const invitedIds = new Set(invitedRows.map(x => Number(x.id)));
        const previewRows = rows
          .filter(r => String(r.status || '').toLowerCase() === 'open')
          .filter(r => !invitedIds.has(Number(r.id)))
          .slice(0, 12)
          .map(toPreviewRepair);
        rows = [...invitedRows, ...previewRows];
      } else {
        rows = invitedRows;
      }
    }
    return rows;
  }
  let data = readJson(REPAIR_REQUESTS_PATH, []);
  if (ownerId) data = data.filter(x => String(x.owner_id) === String(ownerId));
  if (status) data = data.filter(x => String(x.status) === String(status));
  try { await processInviteExpirations(data); } catch {}
  if (providerEmail) {
    try { await ensureProviderInvitesForOpenRequests(providerEmail, data, providerType, providerServices); } catch {}
    const pool = await listProviderPool();
    const provider = pool.find(p => String(p.email || '').toLowerCase() === String(providerEmail).toLowerCase());
    const canSeeInvitedFull = providerEligibleForInvites(provider);
    const now = Date.now();
    const invites = readInvites();
    const activeInvites = invites
      .filter(i => String(i.provider_email) === String(providerEmail).toLowerCase())
      .filter(i => String(i.status || 'pending') === 'pending')
      .filter(i => {
        const exp = new Date(i.expires_at || 0).getTime();
        return Number.isFinite(exp) ? exp > now : true;
      });
    const byRepair = new Map(activeInvites.map(i => [Number(i.repair_id), i]));
    const invitedRows = canSeeInvitedFull
      ? data
        .filter(x => byRepair.has(Number(x.id)))
        .map(x => ({ ...x, invite_expires_at: byRepair.get(Number(x.id))?.expires_at || null }))
      : [];

    if (previewLeads) {
      const invitedIds = new Set(invitedRows.map(x => Number(x.id)));
      const previewRows = data
        .filter(x => String(x.status || '').toLowerCase() === 'open')
        .filter(x => !invitedIds.has(Number(x.id)))
        .slice(0, 12)
        .map(toPreviewRepair);
      data = [...invitedRows, ...previewRows];
    } else {
      data = invitedRows;
    }
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

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(400).send('Stripe webhook not configured.');

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const sessionObj = event.data.object;
      const userId = sessionObj?.metadata?.userId;
      if (userId) {
        upsertBillingByUserId(userId, {
          email: sessionObj?.customer_details?.email || '',
          role: sessionObj?.metadata?.role || 'mechanic',
          stripe_customer_id: sessionObj?.customer || '',
          stripe_subscription_id: sessionObj?.subscription || '',
          subscription_status: 'active'
        });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const rows = readBillingAccounts();
      const idx = rows.findIndex(r => String(r.stripe_subscription_id || '') === String(sub.id || ''));
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          subscription_status: String(sub.status || ''),
          current_period_end: sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString()
        };
        writeBillingAccounts(rows);
      }
    }

    res.json({ received: true });
  } catch {
    res.status(500).send('Webhook processing failed');
  }
});

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
  const normalizedEmail = String(email).trim().toLowerCase();
  if (isBannedEmail(normalizedEmail)) return res.status(403).json({ error: 'This account is restricted. Contact support.' });

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
  if (isBannedEmail(String(email).trim().toLowerCase())) {
    return res.status(403).json({ error: 'This account is restricted. Contact support.' });
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
    const providerType = req.query.providerType ? String(req.query.providerType).toLowerCase() : undefined;
    const providerServices = req.query.providerServices ? String(req.query.providerServices) : undefined;
    const previewLeads = String(req.query.previewLeads || '').toLowerCase() === 'true';
    const rows = await listRepairRequests({ ownerId, status, providerEmail, providerType, providerServices, previewLeads });
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

  const billing = getBillingByUserId(mechanicId);
  if (!billing || !canSubmitEstimatesFromBilling(billing)) {
    return res.status(402).json({ error: 'Active $99/month subscription required to submit estimates.' });
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

  if (providerEmail && isBannedEmail(providerEmail)) {
    return res.status(403).json({ error: 'This account is restricted. Contact support.' });
  }

  try {
    const repairs = await listRepairRequests({});
    const targetRepair = repairs.find(r => Number(r.id) === Number(requestId));
    if (!targetRepair) return res.status(404).json({ error: 'Repair request not found.' });
    if (requestIsExpiredForNewInvites(targetRepair)) {
      return res.status(400).json({ error: 'This repair request is closed for new estimates.' });
    }

    const existingAllForRequest = await listBids({ requestId: Number(requestId) });
    if (existingAllForRequest.some(b => String(b.mechanic_id) === String(mechanicId) && String(b.status || '').toLowerCase() !== 'declined')) {
      return res.status(400).json({ error: 'You already submitted an estimate for this request.' });
    }

    const inviteRows = readInvites();
    const invites = inviteRows.filter(i => Number(i.repair_id) === Number(requestId));
    let matchedInvite = null;
    if (invites.length && providerEmail) {
      matchedInvite = invites.find(i => String(i.provider_email) === providerEmail && normalizeProviderType(i.provider_type) === providerType);
      if (!matchedInvite) {
        return res.status(400).json({ error: 'This request was not dispatched to your profile type.' });
      }
      const exp = new Date(matchedInvite.expires_at || 0).getTime();
      const isExpired = Number.isFinite(exp) ? exp <= Date.now() : false;
      if (String(matchedInvite.status || 'pending') !== 'pending' || isExpired) {
        return res.status(400).json({ error: 'Your estimate window expired for this request.' });
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

    if (providerEmail) {
      const rows = readInvites();
      const idx = rows.findIndex(i => Number(i.repair_id) === Number(requestId) && String(i.provider_email) === providerEmail && normalizeProviderType(i.provider_type) === providerType && String(i.status || 'pending') === 'pending');
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          status: 'submitted',
          submitted_at: new Date().toISOString()
        };
        writeInvites(rows);
      }
    }

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

app.get('/api/billing/status', async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const billing = getBillingByUserId(userId);
  if (!billing) {
    return res.json({
      ok: true,
      hasSubscription: false,
      status: 'none',
      canSubmitEstimates: false,
      amountLabel: '$99/month',
      refundPolicy: 'If you receive zero eligible opportunities to submit an estimate in a billing month, your $99 is refunded. Winning jobs is based on quote quality, speed, and reputation.'
    });
  }

  const status = String(billing.subscription_status || 'none');
  return res.json({
    ok: true,
    hasSubscription: true,
    status,
    manualAccessOverride: billing.manual_access_override || null,
    canSubmitEstimates: canSubmitEstimatesFromBilling(billing),
    currentPeriodEnd: billing.current_period_end || null,
    amountLabel: '$99/month',
    refundPolicy: 'If you receive zero eligible opportunities to submit an estimate in a billing month, your $99 is refunded. Winning jobs is based on quote quality, speed, and reputation.'
  });
});

app.post('/api/billing/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured on the server.' });

  const { userId, email, role } = req.body || {};
  if (!userId || !email) return res.status(400).json({ error: 'userId and email are required.' });

  const price = resolvePriceForRole(role);
  if (!price) return res.status(500).json({ error: 'No Stripe price is configured for this package.' });

  try {
    const existing = getBillingByUserId(userId);
    let customerId = existing?.stripe_customer_id || '';

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: String(email).trim().toLowerCase(),
        metadata: { userId: String(userId), role: String(role || 'mechanic') }
      });
      customerId = customer.id;
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${APP_URL}/mechanic.html?billing=success`,
      cancel_url: `${APP_URL}/mechanic.html?billing=cancel`,
      allow_promotion_codes: true,
      metadata: {
        userId: String(userId),
        role: String(role || 'mechanic')
      }
    });

    upsertBillingByUserId(userId, {
      email: String(email).trim().toLowerCase(),
      role: String(role || 'mechanic'),
      stripe_customer_id: customerId,
      stripe_checkout_session_id: checkout.id
    });

    res.json({ ok: true, url: checkout.url });
  } catch (e) {
    res.status(500).json({ error: 'Could not start checkout.', detail: String(e?.message || e) });
  }
});

app.post('/api/billing/create-portal-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured on the server.' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const billing = getBillingByUserId(userId);
  if (!billing?.stripe_customer_id) return res.status(400).json({ error: 'No Stripe customer found for this account yet.' });

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${APP_URL}/mechanic.html`
    });
    res.json({ ok: true, url: portal.url });
  } catch (e) {
    res.status(500).json({ error: 'Could not open billing portal.', detail: String(e?.message || e) });
  }
});

app.get('/api/admin/billing', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const rows = readBillingAccounts().sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    const summary = {
      total: rows.length,
      active: rows.filter(r => isSubscriptionActive(r.subscription_status)).length,
      cancelled: rows.filter(r => String(r.subscription_status || '').toLowerCase() === 'canceled').length,
      pastDue: rows.filter(r => String(r.subscription_status || '').toLowerCase() === 'past_due').length
    };
    res.json({ ok: true, summary, stripeConfigured: !!stripe, billing: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load billing accounts.', detail: String(e?.message || e) });
  }
});

app.post('/api/admin/billing/:userId/cancel', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });

  const billing = getBillingByUserId(userId);
  if (!billing) return res.status(404).json({ error: 'Billing account not found for this user.' });

  if (!stripe) {
    const updated = upsertBillingByUserId(userId, {
      subscription_status: 'canceled',
      cancel_at_period_end: true
    });
    return res.json({ ok: true, mockMode: true, billing: updated });
  }

  if (!billing?.stripe_subscription_id) return res.status(404).json({ error: 'Stripe subscription id not found for this user.' });

  try {
    const sub = await stripe.subscriptions.update(billing.stripe_subscription_id, { cancel_at_period_end: true });
    const updated = upsertBillingByUserId(userId, {
      subscription_status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null
    });
    res.json({ ok: true, billing: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not schedule cancellation.', detail: String(e?.message || e) });
  }
});

app.post('/api/admin/billing/:userId/reactivate', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });

  const billing = getBillingByUserId(userId);
  if (!billing) return res.status(404).json({ error: 'Billing account not found for this user.' });

  if (!stripe) {
    const updated = upsertBillingByUserId(userId, {
      subscription_status: 'active',
      cancel_at_period_end: false
    });
    return res.json({ ok: true, mockMode: true, billing: updated });
  }

  if (!billing?.stripe_subscription_id) return res.status(404).json({ error: 'Stripe subscription id not found for this user.' });

  try {
    const sub = await stripe.subscriptions.update(billing.stripe_subscription_id, { cancel_at_period_end: false });
    const updated = upsertBillingByUserId(userId, {
      subscription_status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null
    });
    res.json({ ok: true, billing: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not reactivate subscription.', detail: String(e?.message || e) });
  }
});

app.post('/api/admin/billing/:userId/manual-access', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  const mode = String(req.body?.mode || '').toLowerCase(); // active|disabled|clear
  const reason = String(req.body?.reason || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  if (!['active', 'disabled', 'clear'].includes(mode)) return res.status(400).json({ error: 'mode must be active, disabled, or clear.' });

  const existing = getBillingByUserId(userId) || { user_id: userId };
  const updated = upsertBillingByUserId(userId, {
    email: existing.email || '',
    role: existing.role || '',
    manual_access_override: mode === 'clear' ? null : mode,
    manual_access_reason: reason || existing.manual_access_reason || ''
  });

  res.json({ ok: true, billing: updated });
});

app.get('/api/admin/accounts', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const [signups, authUsers] = await Promise.all([listSignups(), listAuthUsers()]);
    const billing = readBillingAccounts();
    const bans = readBannedAccounts();

    const banMap = new Map(bans.map(b => [String(b.email || '').toLowerCase(), b]));
    const accountMap = new Map();

    const upsertAccount = (email, patch = {}) => {
      const e = String(email || '').trim().toLowerCase();
      if (!e) return;
      const prev = accountMap.get(e) || {
        id: null,
        name: '',
        email: e,
        category: 'owner',
        borough: '',
        zip: '',
        created_at: ''
      };
      accountMap.set(e, { ...prev, ...patch, email: e });
    };

    for (const s of signups) {
      const typeRaw = String(s.type || s.Type || '').toLowerCase();
      const hasShop = String(s.has_shop || s.HasShop || '').toLowerCase();
      const email = String(s.email || s.Email || '').trim().toLowerCase();
      const category = typeRaw === 'owner'
        ? 'owner'
        : (hasShop === 'yes' || hasShop === 'true' || hasShop === 'shop') ? 'mechanic_shop' : 'individual_mechanic';
      upsertAccount(email, {
        id: s.id || s.Id || null,
        name: s.name || s.Name || '',
        category,
        borough: s.borough || s.Borough || '',
        zip: s.zip || s.ZIP || '',
        created_at: s.created_at || s.CreatedDate || ''
      });
    }

    for (const u of authUsers) {
      const meta = u?.user_metadata || {};
      const email = String(u?.email || '').trim().toLowerCase();
      const role = String(meta.role || '').toLowerCase();
      let category = 'owner';
      if (role === 'shop') category = 'mechanic_shop';
      else if (role === 'mechanic') category = 'individual_mechanic';
      upsertAccount(email, {
        id: u?.id || null,
        name: String(meta.name || '').trim(),
        category,
        created_at: u?.created_at || ''
      });
    }

    for (const b of billing) {
      const email = String(b.email || '').trim().toLowerCase();
      const role = String(b.role || '').toLowerCase();
      if (!email) continue;
      const category = role === 'shop' ? 'mechanic_shop' : role === 'mechanic' ? 'individual_mechanic' : 'owner';
      upsertAccount(email, {
        category
      });
    }

    const accounts = Array.from(accountMap.values()).map(a => {
      const ban = banMap.get(String(a.email || '').toLowerCase());
      return {
        ...a,
        banned: !!(ban && ban.active !== false),
        ban_reason: ban?.reason || ''
      };
    }).sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime() || 0;
      const tb = new Date(b.created_at || 0).getTime() || 0;
      return tb - ta;
    });

    res.json({ ok: true, accounts });
  } catch (e) {
    res.status(500).json({ error: 'Could not load accounts', detail: String(e?.message || e) });
  }
});

app.post('/api/admin/accounts/:email/ban', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const email = String(req.params.email || '').trim().toLowerCase();
  const reason = String(req.body?.reason || 'Admin action').trim();
  const category = String(req.body?.category || '').trim();
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const updated = setBannedEmail(email, true, reason, category);
  res.json({ ok: true, ban: updated });
});

app.post('/api/admin/accounts/:email/unban', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const email = String(req.params.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const updated = setBannedEmail(email, false);
  res.json({ ok: true, ban: updated });
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
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
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
  if (!isAdminConfigValid()) {
    return res.status(503).send('<h2>Admin disabled</h2><p>Set a strong ADMIN_TOKEN environment variable.</p>');
  }
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).send('<h2>Unauthorized</h2><p>Use /admin/ops?token=YOUR_TOKEN or send x-admin-token header.</p>');
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
  if (!isAdminConfigValid()) {
    return res.status(503).send('<h2>Admin disabled</h2><p>Set a strong ADMIN_TOKEN environment variable.</p>');
  }
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).send('<h2>Unauthorized</h2><p>Use /admin?token=YOUR_TOKEN or send x-admin-token header.</p>');
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
  :root{--bg:#090c12;--card:#121a29;--card2:#0f1623;--stroke:#2a3752;--text:#eef3ff;--muted:#aab6d3;--orange:#ff7a45;--green:#22c55e;--red:#ef4444;--blue:#60a5fa}
  *{box-sizing:border-box} body{font-family:Inter,Segoe UI,Arial,sans-serif;background:radial-gradient(1200px 420px at 0 -20%,rgba(255,122,69,.14),transparent 62%),radial-gradient(1000px 400px at 100% -10%,rgba(96,165,250,.12),transparent 60%),var(--bg);color:var(--text);margin:0;padding:22px}
  h1,h2,h3{margin:0}.wrap{max-width:1280px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}.btnLink{border:1px solid var(--stroke);background:var(--card2);color:#dce7ff;padding:8px 12px;border-radius:10px;text-decoration:none;font-size:13px}
  .btnLink:hover{border-color:#3b4a70}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--stroke);border-radius:14px;padding:12px}
  .k{font-size:12px;color:var(--muted)}.v{font-size:30px;font-weight:800;margin-top:4px}.span2{grid-column:span 2}.span3{grid-column:span 3}.span6{grid-column:span 6}
  .pill{display:inline-block;border:1px solid #3b4a70;background:#101c30;color:#d3e4ff;border-radius:999px;padding:4px 9px;font-size:11px}
  .subline{margin-top:5px;color:var(--muted);font-size:12px}
  .toolbar{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px}
  .search{max-width:360px;width:100%;padding:9px 11px;border-radius:10px;border:1px solid #354563;background:#0a1220;color:#fff}
  .tbl{max-height:460px;overflow:auto;border:1px solid var(--stroke);border-radius:12px;margin-top:8px}
  table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #23314c;font-size:12px;text-align:left;vertical-align:middle}th{color:#c8d7fb;background:#0f1728;position:sticky;top:0;z-index:1}
  .actions-cell{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .badge{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #3a4a70;font-size:11px;text-transform:capitalize}
  .st-active,.st-trialing{border-color:#14532d;background:#052e1d;color:#bbf7d0}.st-past_due{border-color:#854d0e;background:#2b1603;color:#fde68a}.st-canceled,.st-none{border-color:#7f1d1d;background:#2a1111;color:#fecaca}.st-blocked{border-color:#9a3412;background:#2b1205;color:#fed7aa}
  .btn{border:1px solid #3a4a70;background:#102038;color:#e7efff;border-radius:9px;padding:6px 9px;font-size:11px;cursor:pointer}
  .btn:hover{filter:brightness(1.1)}.btn.cancel{border-color:#7f1d1d;background:#2a1010}.btn.activate{border-color:#14532d;background:#052117}.btn:disabled{opacity:.55;cursor:not-allowed;filter:none}
  .warn{border:1px solid #7f1d1d;background:#2a1414;color:#ffcbcb;border-radius:12px;padding:10px;margin-top:10px}
  .notice{border:1px solid #4b5563;background:#111827;color:#c7d2fe;border-radius:10px;padding:8px 10px;font-size:12px;margin-top:8px}
  #toast{position:fixed;right:16px;bottom:16px;background:#0b1528;border:1px solid #334155;color:#dbeafe;padding:10px 12px;border-radius:10px;display:none;z-index:40}
  @media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.span2,.span3,.span6{grid-column:span 2}}
  @media(max-width:760px){
    body{padding:12px}
    .top{align-items:flex-start}
    .actions{width:100%}
    .btnLink{flex:1;text-align:center}
    .toolbar{position:sticky;top:0;background:linear-gradient(180deg,#0f1623,#0f1623f2);padding:8px;border:1px solid #2a3752;border-radius:10px;z-index:2}
    .search{max-width:100%}
    .tbl{max-height:58vh}
    th,td{padding:8px 6px;font-size:11px}
    .btn{padding:6px 8px;font-size:10px}
    .actions-cell{min-width:180px}
  }
  </style></head><body><div class='wrap'>
  <div class='top'><div><h1>ShopMyRepair Admin</h1><div class='subline'>Business overview, subscriptions, and controls</div></div><div class='actions'><a class='btnLink' href='/pricing.html' target='_blank'>Pricing page ↗</a><a class='btnLink' href='/admin/ops?token=${encodeURIComponent(String(req.query.token||''))}'>Ops dashboard</a></div></div>

  <div class='grid'>
    <div class='card'><div class='k'>Total Signups</div><div class='v'>${c.total}</div></div>
    <div class='card'><div class='k'>Owners</div><div class='v'>${c.owners}</div><div class='k'>${ownerPct}%</div></div>
    <div class='card'><div class='k'>Mechanics (All)</div><div class='v'>${c.mechanics}</div><div class='k'>${mechPct}%</div></div>
    <div class='card'><div class='k'>Mechanic Shops</div><div class='v'>${shopCount}</div></div>
    <div class='card'><div class='k'>Individual Mechanics</div><div class='v'>${indyMech}</div></div>
    <div class='card'><div class='k'>New Last 7 Days</div><div class='v'>${last7}</div></div>

    <div class='card span3'><h3>Demand by Borough</h3><div style='margin-top:8px'>${boroughBars || '<div class="k">No borough data yet</div>'}</div></div>
    <div class='card span3'><h3>Quick Signals</h3><div class='k' style='margin-top:8px'>Top ZIP: <b>${esc(byZip[0]?.[0] || 'N/A')}</b> (${byZip[0]?.[1] || 0})</div><div class='k' style='margin-top:6px'>Top Borough: <b>${esc(byBorough[0]?.[0] || 'N/A')}</b> (${byBorough[0]?.[1] || 0})</div><div class='k' style='margin-top:10px'>Use these to focus recruitment and demand campaigns.</div><div style='margin-top:10px'><span class='pill'>Leads</span> <span class='pill'>Supply Mix</span> <span class='pill'>Geo Demand</span></div></div>

    ${loadError ? `<div class='span6 warn'><h3 style='margin:0 0 6px 0'>Data source error</h3><div>${esc(loadError)}</div><div style='margin-top:6px'>Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on deploy, or unset both for JSON fallback.</div></div>` : ''}

    <div class='card span6'><h3>Recent Signups (latest 50)</h3><div class='tbl'><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Borough</th><th>ZIP</th><th>Email</th><th>Created</th></tr></thead><tbody>${recentRows || '<tr><td colspan="7">No signups yet.</td></tr>'}</tbody></table></div></div>

    <div class='card span6'>
      <h3>Account Management (Ban Controls)</h3>
      <div class='k' style='margin-top:8px'>Filter by category and one-click ban/unban owners, individual mechanics, and mechanic shops.</div>
      <div class='toolbar'>
        <input id='accountSearch' class='search' placeholder='Search account email, name, category...' />
        <select id='accountCategory' class='search' style='max-width:220px'>
          <option value='all'>All categories</option>
          <option value='owner'>Owner</option>
          <option value='individual_mechanic'>Individual Mechanic</option>
          <option value='mechanic_shop'>Mechanic Shop</option>
        </select>
        <button class='btn' onclick='loadAccounts()'>Refresh</button>
      </div>
      <div class='tbl'>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Category</th><th>Borough</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead>
          <tbody id='accountRows'><tr><td colspan='7'>Loading accounts...</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class='card span6'>
      <h3>Subscription Management</h3>
      <div id='billingSummary' class='k' style='margin-top:8px'>Loading billing accounts...</div>
      <div id='billingMode' class='notice'>Checking Stripe mode...</div>
      <div class='toolbar'>
        <input id='billingSearch' class='search' placeholder='Search by email, user ID, role, status...' />
        <button class='btn' onclick='loadBilling()'>Refresh</button>
      </div>
      <div class='tbl'>
        <table>
          <thead><tr><th>User ID</th><th>Email</th><th>Role</th><th>Status</th><th>Access</th><th>Manual Override</th><th>Period End</th><th>Cancel at End</th><th>Actions</th></tr></thead>
          <tbody id='billingRows'><tr><td colspan='9'>Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
  <div id='toast'></div>
  <script>
    const adminToken = '${encodeURIComponent(String(req.query.token||''))}';
    let billingCache = [];
    let accountCache = [];

    function statusClass(status) {
      const s = String(status || 'none').toLowerCase();
      if (s === 'active' || s === 'trialing') return 'st-active';
      if (s === 'past_due') return 'st-past_due';
      if (s === 'canceled') return 'st-canceled';
      return 'st-none';
    }

    function labelStatus(status) {
      const s = String(status || 'none').toLowerCase();
      if (s === 'past_due') return 'past due';
      return s.replace('_', ' ');
    }

    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__toastT);
      window.__toastT = setTimeout(() => { el.style.display = 'none'; }, 2200);
    }

    function normalizeCategory(cat) {
      const c = String(cat || '').toLowerCase();
      if (c === 'mechanic_shop') return 'Mechanic Shop';
      if (c === 'individual_mechanic') return 'Individual Mechanic';
      return 'Owner';
    }

    function renderAccountRows(rows) {
      const rowsEl = document.getElementById('accountRows');
      if (!rows.length) {
        rowsEl.innerHTML = '<tr><td colspan="7">No matching accounts.</td></tr>';
        return;
      }
      rowsEl.innerHTML = rows.map(x => {
        const email = String(x.email || '');
        const category = String(x.category || '');
        const action = x.banned
          ? '<button class="btn activate" data-act="unban" data-email="' + encodeURIComponent(email) + '">Unban</button>'
          : '<button class="btn cancel" data-act="ban" data-email="' + encodeURIComponent(email) + '" data-category="' + encodeURIComponent(category) + '">Ban</button>';
        return '<tr>' +
          '<td>' + (x.name || '-') + '</td>' +
          '<td>' + email + '</td>' +
          '<td>' + normalizeCategory(category) + '</td>' +
          '<td>' + (x.borough || '-') + '</td>' +
          '<td><span class="badge ' + (x.banned ? 'st-canceled' : 'st-active') + '">' + (x.banned ? 'banned' : 'active') + '</span></td>' +
          '<td>' + (x.banned ? (x.ban_reason || '-') : '-') + '</td>' +
          '<td class="actions-cell">' + action + '</td>' +
        '</tr>';
      }).join('');
    }

    function applyAccountFilters() {
      const q = String(document.getElementById('accountSearch').value || '').trim().toLowerCase();
      const cat = String(document.getElementById('accountCategory').value || 'all');
      let rows = accountCache.slice();
      if (cat !== 'all') rows = rows.filter(x => String(x.category || '') === cat);
      if (q) rows = rows.filter(x => [x.name, x.email, x.category, x.borough].map(v => String(v || '').toLowerCase()).join(' ').includes(q));
      renderAccountRows(rows);
    }

    async function loadAccounts() {
      try {
        const r = await fetch('/api/admin/accounts?token=' + adminToken);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load accounts');
        accountCache = d.accounts || [];
        applyAccountFilters();
      } catch (e) {
        document.getElementById('accountRows').innerHTML = '<tr><td colspan="7">' + (e.message || 'Could not load accounts') + '</td></tr>';
      }
    }

    async function banAccount(email, category) {
      if (!confirm('Ban ' + email + '? They will lose access immediately.')) return;
      const reason = prompt('Reason for ban (optional):', 'Admin action') || 'Admin action';
      try {
        const r = await fetch('/api/admin/accounts/' + encodeURIComponent(email) + '/ban?token=' + adminToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, category })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not ban account');
        toast('Account banned.');
        await loadAccounts();
      } catch (e) { toast(e.message || 'Failed to ban account'); }
    }

    async function unbanAccount(email) {
      if (!confirm('Unban ' + email + '? This restores account access.')) return;
      try {
        const r = await fetch('/api/admin/accounts/' + encodeURIComponent(email) + '/unban?token=' + adminToken, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not unban account');
        toast('Account unbanned.');
        await loadAccounts();
      } catch (e) { toast(e.message || 'Failed to unban account'); }
    }

    function renderBillingRows(rows) {
      const rowsEl = document.getElementById('billingRows');
      if (!rows.length) {
        rowsEl.innerHTML = '<tr><td colspan="9">No matching billing accounts.</td></tr>';
        return;
      }
      rowsEl.innerHTML = rows.map(x => {
        const uid = String(x.user_id || '');
        const status = String(x.subscription_status || 'none');
        const canCancel = status === 'active' || status === 'trialing' || status === 'past_due';
        const canActivate = status !== 'active' || !!x.cancel_at_period_end;
        const manual = String(x.manual_access_override || 'none');
        const access = manual === 'disabled' ? 'blocked' : ((manual === 'active' || ['active','trialing','past_due'].includes(status)) ? 'enabled' : 'restricted');
        const accessClass = access === 'enabled' ? 'st-active' : (access === 'blocked' ? 'st-blocked' : 'st-none');
        const actionBtns =
          '<button class="btn cancel" ' + (canCancel ? '' : 'disabled') + ' data-bill-act="cancel" data-user-id="' + encodeURIComponent(uid) + '">Cancel End</button> ' +
          '<button class="btn activate" ' + (canActivate ? '' : 'disabled') + ' data-bill-act="reactivate" data-user-id="' + encodeURIComponent(uid) + '">Keep Active</button> ' +
          '<button class="btn activate" data-bill-act="force-active" data-user-id="' + encodeURIComponent(uid) + '">Force Active</button> ' +
          '<button class="btn cancel" data-bill-act="force-disable" data-user-id="' + encodeURIComponent(uid) + '">Disable Access</button> ' +
          '<button class="btn" data-bill-act="clear-manual" data-user-id="' + encodeURIComponent(uid) + '">Auto Mode</button>';
        return '<tr>' +
          '<td>' + uid + '</td>' +
          '<td>' + (x.email || '-') + '</td>' +
          '<td>' + (x.role || '-') + '</td>' +
          '<td><span class="badge ' + statusClass(status) + '">' + labelStatus(status) + '</span></td>' +
          '<td><span class="badge ' + accessClass + '">' + labelStatus(access) + '</span></td>' +
          '<td>' + labelStatus(manual) + '</td>' +
          '<td>' + (x.current_period_end || '-') + '</td>' +
          '<td>' + (x.cancel_at_period_end ? 'yes' : 'no') + '</td>' +
          '<td class="actions-cell">' + actionBtns + '</td>' +
        '</tr>';
      }).join('');
    }

    function applySearch() {
      const q = String(document.getElementById('billingSearch').value || '').trim().toLowerCase();
      if (!q) return renderBillingRows(billingCache);
      const filtered = billingCache.filter(x => {
        const row = [x.user_id, x.email, x.role, x.subscription_status].map(v => String(v || '').toLowerCase()).join(' ');
        return row.includes(q);
      });
      renderBillingRows(filtered);
    }

    async function loadBilling() {
      const summaryEl = document.getElementById('billingSummary');
      const modeEl = document.getElementById('billingMode');
      try {
        const r = await fetch('/api/admin/billing?token=' + adminToken);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load billing');

        const s = d.summary || {};
        summaryEl.innerHTML = 'Total: <b>' + (s.total||0) + '</b> · Active: <b>' + (s.active||0) + '</b> · Past Due: <b>' + (s.pastDue||0) + '</b> · Cancelled: <b>' + (s.cancelled||0) + '</b>';
        modeEl.textContent = d.stripeConfigured
          ? 'Stripe Live Mode: button actions call real Stripe subscriptions.'
          : 'Stripe Setup Mode: button actions update local subscription status so you can test UI before keys are added.';

        billingCache = d.billing || [];
        applySearch();
      } catch (e) {
        summaryEl.textContent = e.message || 'Could not load billing accounts.';
        document.getElementById('billingRows').innerHTML = '<tr><td colspan="9">Could not load billing accounts.</td></tr>';
      }
    }

    async function cancelSub(userId) {
      if (!confirm('Cancel subscription at period end for user ' + userId + '?')) return;
      try {
        const r = await fetch('/api/admin/billing/' + encodeURIComponent(userId) + '/cancel?token=' + adminToken, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not cancel subscription');
        toast(d.mockMode ? 'Updated in setup mode (no Stripe keys yet).' : 'Subscription set to cancel.');
        await loadBilling();
      } catch (e) { toast(e.message || 'Failed to cancel'); }
    }

    async function reactivateSub(userId) {
      if (!confirm('Keep subscription active for user ' + userId + '?')) return;
      try {
        const r = await fetch('/api/admin/billing/' + encodeURIComponent(userId) + '/reactivate?token=' + adminToken, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not reactivate subscription');
        toast(d.mockMode ? 'Updated in setup mode (no Stripe keys yet).' : 'Subscription kept active.');
        await loadBilling();
      } catch (e) { toast(e.message || 'Failed to reactivate'); }
    }

    async function setManualAccess(userId, mode) {
      const msg = mode === 'active' ? 'Force ACTIVE access for user ' + userId + '?' : (mode === 'disabled' ? 'Disable access for user ' + userId + '?' : 'Clear manual override for user ' + userId + '?');
      if (!confirm(msg)) return;
      const reason = prompt('Manual override note (optional):', 'Admin manual override') || 'Admin manual override';
      try {
        const r = await fetch('/api/admin/billing/' + encodeURIComponent(userId) + '/manual-access?token=' + adminToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, reason })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not set manual access');
        toast(mode === 'clear' ? 'Manual override cleared.' : 'Manual override updated.');
        await loadBilling();
      } catch (e) { toast(e.message || 'Failed to set manual access'); }
    }

    document.getElementById('billingSearch').addEventListener('input', applySearch);
    document.getElementById('accountSearch').addEventListener('input', applyAccountFilters);
    document.getElementById('accountCategory').addEventListener('change', applyAccountFilters);
    document.getElementById('accountRows').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const email = decodeURIComponent(String(btn.getAttribute('data-email') || ''));
      const category = decodeURIComponent(String(btn.getAttribute('data-category') || ''));
      if (!email) return;
      if (act === 'ban') banAccount(email, category);
      if (act === 'unban') unbanAccount(email);
    });
    document.getElementById('billingRows').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-bill-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-bill-act');
      const userId = decodeURIComponent(String(btn.getAttribute('data-user-id') || ''));
      if (!userId) return;
      if (act === 'cancel') cancelSub(userId);
      if (act === 'reactivate') reactivateSub(userId);
      if (act === 'force-active') setManualAccess(userId, 'active');
      if (act === 'force-disable') setManualAccess(userId, 'disabled');
      if (act === 'clear-manual') setManualAccess(userId, 'clear');
    });
    loadAccounts();
    loadBilling();
  </script>
  </div></body></html>`);
});

app.listen(PORT, () => {
  if (!isAdminConfigValid()) {
    console.warn('⚠️ Admin routes disabled: set ADMIN_TOKEN to a strong non-default value.');
  }
  console.log(`Live: http://localhost:${PORT}`);
});

