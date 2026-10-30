import express from 'express';
import { singleFlightProbe } from './lib/health-probe.js';
import { requestFailureSummary } from './lib/error-log.js';
import { adminStore, prepareAdminAccess } from './lib/admin-access.js';
import { repairTransition } from './lib/repair-workflow.js';
import { photoMetadata, photoObjects, registerPhotos } from './lib/photos.js';
import { messageStore, registerMessages } from './lib/messages.js';
import { trustedProxyPolicy, createRateLimiter, boundedText, repairValidationError } from './lib/request-security.js';
import { createBillingReconciler, reconciliationConfig } from './lib/billing-reconciliation.js';
import { attestShopPlan } from './lib/stripe-entitlement.js';
import { billingMode, missingReleaseConfig, BILLING_UNAVAILABLE } from './lib/billing-mode.js';
import { approvedShop, subscribedShop as entitledShop } from './lib/shop-eligibility.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import cors from 'cors';
import Stripe from 'stripe';
import { operationsStore, registerOperations } from './lib/operations.js';
import { withinServiceArea, providerDistanceMiles, validZip, trustedRole, subscriptionPeriodEnd } from './lib/matching.js';

import { rankInviteCandidates, initialInviteCandidates, createDispatchQueue } from './lib/invite-ranking.js';
const runDispatchExclusive = createDispatchQueue();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', trustedProxyPolicy(process.env.TRUSTED_PROXY_CIDRS || ''));

// Express 4 does not forward rejected async handlers automatically.
function route(method, path, ...handlers) {
  // Release gate includes admin fallbacks: disabled must never simulate billing changes.
  const billingWrite = method !== 'get' && (path.startsWith('/api/billing/') || path.startsWith('/api/admin/billing/') || path === '/api/admin/refund/:id/process');
  const newWork = method === 'post' && ['/api/repairs', '/api/owner-request', '/api/bids'].includes(path);
  if (billingWrite || newWork || path === '/api/billing/invoices' || path === '/api/stripe/webhook') handlers.unshift((req,res,next) => {
    if (!BILLING_ENABLED) return res.status(503).json({ error: BILLING_UNAVAILABLE, billingMode: 'disabled' });
    next();
  });
  const adminRequired=path.startsWith('/api/admin/');
  const overrideRoute=path==='/api/bids'||path==='/api/feedbacks'||path==='/api/bids/:id/accept'||path==='/api/repairs/:id/cancel'||path==='/api/repairs/:id/complete';
  if(adminRequired||overrideRoute)handlers.unshift(async(req,res,next)=>{
    if(await prepareAdminAccess(req,res,{required:adminRequired,store:admins,getUser:async r=>{const u=await getAuthenticatedUser(r);return u&&!await isBannedEmail(u.email)?u:null;}}))next();
  });
  app[method](path, ...handlers.map(handler => (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
  }));
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Express routes are case-insensitive; privacy headers must be too.
  if (/^\/(?:api(?:\/|$)|admin)/i.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});
// Rejected/limited responses need the same privacy headers as successful ones.
app.use(createRateLimiter());
const PORT = process.env.PORT || 3000;
function isAuthorizedAdminRequest(req) { return !!req.adminUser; }
function guardAdminApi(req,res) {
  if(!req.adminUser)return res.status(403).json({error:'Administrator authorization required.'});
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
if (process.env.NODE_ENV === 'production' && !USE_SUPABASE) {
  throw new Error('Production requires Supabase; local file storage is development-only.');
}

const BILLING_ENABLED = billingMode(process.env) === 'enabled';
const subscribedShop = (...args) => BILLING_ENABLED && entitledShop(...args);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_SHOP_MONTHLY = process.env.STRIPE_PRICE_SHOP_MONTHLY || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const stripe = BILLING_ENABLED && STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function missingProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return [];
  return missingReleaseConfig(process.env);
}

function billingConfigReady() {
  return !!(stripe && STRIPE_WEBHOOK_SECRET && STRIPE_PRICE_SHOP_MONTHLY);
}

const privatePhotoObjects = photoObjects({ database: USE_SUPABASE, url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.REPAIR_PHOTO_BUCKET || '', directory: path.join(__dirname, '.local-data', 'private-photos') });
const admins = adminStore({database:USE_SUPABASE,request:supabaseRequest,directory:path.join(__dirname,'.local-data')});
const ops = operationsStore({ database: USE_SUPABASE, request: supabaseRequest, directory: path.join(__dirname, '.local-data') });
async function notifyUser(userId, eventKey, title, body, href) {
  if (!userId) return;
  try {
    return await ops.save('notifications', { user_id: String(userId), event_key: eventKey, title, body, href }, 'event_key', true);
  } catch (error) {
    console.error('Notification delivery failed:', String(eventKey || ''), error.name);
    return null;
  }
}
async function recordInvites(invites) {
  if (!invites.length) return;
  const pool = await listProviderPool();
  for (const invite of invites) {
    await ops.save('opportunity_events', { repair_id: invite.repair_id, provider_email: invite.provider_email, created_at: invite.created_at }, 'repair_id,provider_email', true);
    const provider = pool.find(p => p.email === invite.provider_email);
    if (provider?.userId) await notifyUser(provider.userId, `invite:${invite.repair_id}:${provider.userId}`, 'A local repair matches your services', 'Review the request and send an estimate before its invitation window closes.', '/mechanic.html');
  }
}

async function reconcileBidNotifications({ apply = false } = {}) {
  const [bids, repairs, notifications] = await Promise.all([
    listBids({}),
    listRepairRequests({}),
    ops.list('notifications').catch(() => [])
  ]);
  const existing = new Set(notifications.map(n => String(n.event_key || '')));
  const missing = [];
  for (const bid of bids) {
    const key = `bid:${bid.id}`;
    if (existing.has(key)) continue;
    const repair = repairs.find(r => Number(r.id) === Number(bid.request_id));
    if (!repair?.owner_id) continue;
    missing.push({
      userId: repair.owner_id,
      eventKey: key,
      title: 'A new repair estimate arrived',
      body: 'Open your dashboard to compare price, availability, and provider details.',
      href: '/owner-app.html'
    });
  }
  if (apply) {
    for (const item of missing) {
      await notifyUser(item.userId, item.eventKey, item.title, item.body, item.href);
    }
  }
  return { missingBidNotifications: missing.length, applied: apply ? missing.length : 0 };
}

const STANDARD_INVITE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h
const URGENT_INVITE_WINDOW_MS = 45 * 60 * 1000; // 45m
const MAX_REQUEST_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const ESCALATION_WAVE_2_MS = 90 * 60 * 1000; // 90m
const ESCALATION_WAVE_3_MS = 180 * 60 * 1000; // 180m
const ESCALATION_MIN_BIDS = 2;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://shopmyrepair.vercel.app,https://beta.shopmyrepair.com,https://shopmyrepair.com,https://shopmyrepair.onrender.com,http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin = '') {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    // Preview origins must be explicitly listed in CORS_ORIGINS.
    if (host === 'outlaw-ba9s.onrender.com') return true;
    if (['shopmyrepair.com', 'www.shopmyrepair.com', 'beta.shopmyrepair.com'].includes(host)) return true;
  } catch {}
  return false;
}

const otpStore = new Map(); // phone -> { code, exp }

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeJson(filePath, data) {
  const temporary=filePath+'.'+process.pid+'.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
  fs.renameSync(temporary,filePath);
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

async function listBillingAccounts() {
  if (USE_SUPABASE) {
    try {
      return await supabaseRequest('billing_accounts?select=*&order=updated_at.desc');
    } catch (error) { throw error; }
  }
  return readBillingAccounts();
}

async function getBillingByUserIdAsync(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  if (USE_SUPABASE) {
    try {
      const rows = await supabaseRequest(`billing_accounts?select=*&user_id=eq.${encodeURIComponent(id)}&limit=1`);
      return rows[0] || null;
    } catch (error) { throw error; }
  }
  return getBillingByUserId(id);
}

async function getBillingBySubscriptionId(subscriptionId) {
  const id = String(subscriptionId || '').trim();
  if (!id) return null;
  if (USE_SUPABASE) {
    try {
      const rows = await supabaseRequest(`billing_accounts?select=*&stripe_subscription_id=eq.${encodeURIComponent(id)}&limit=1`);
      return rows[0] || null;
    } catch (error) { throw error; }
  }
  return readBillingAccounts().find(r => String(r.stripe_subscription_id || '') === id) || null;
}

async function upsertBillingByUserIdAsync(userId, patch = {}) {
  const id = String(userId || '').trim();
  if (!id) return null;
  if (USE_SUPABASE) {
    const out = await supabaseRequest('billing_accounts?on_conflict=user_id', {
      method: 'POST', body: { ...patch, user_id: id, updated_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=representation'
    });
    return out[0] || null;
  }
  return upsertBillingByUserId(id, patch);
}

async function updateBillingBySubscriptionId(subscriptionId, patch = {}) {
  const billing = await getBillingBySubscriptionId(subscriptionId);
  if (!billing?.user_id) return null;
  return upsertBillingByUserIdAsync(billing.user_id, patch);
}

async function syncBillingFromStripe(billing) {
  if (!stripe || !billing?.user_id) return billing || null;

  let subscriptionId = String(billing.stripe_subscription_id || '').trim();
  let patch = {};

  const checkoutSessionId = String(billing.stripe_checkout_session_id || '').trim();
  if (!subscriptionId && checkoutSessionId) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (checkout?.customer && !billing.stripe_customer_id) patch.stripe_customer_id = checkout.customer;
      if (checkout?.subscription) {
        subscriptionId = String(checkout.subscription);
        patch.stripe_subscription_id = subscriptionId;
      }
      if (checkout?.payment_status === 'paid' && !subscriptionId) {
        patch.subscription_status = 'active';
      }
    } catch {}
  }

  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      patch = {
        ...patch,
        stripe_subscription_id: sub.id,
        stripe_customer_id: sub.customer || patch.stripe_customer_id || billing.stripe_customer_id || '',
        ...attestShopPlan(sub, STRIPE_PRICE_SHOP_MONTHLY),
        subscription_status: String(sub.status || ''),
        current_period_end: subscriptionPeriodEnd(sub),
        cancel_at_period_end: !!sub.cancel_at_period_end
      };
    } catch {}
  }

  if (!Object.keys(patch).length) return billing;
  return upsertBillingByUserIdAsync(billing.user_id, patch);
}

function isSubscriptionActive(status) {
  return ['active', 'trialing'].includes(String(status || '').toLowerCase());
}

function canSubmitEstimatesFromBilling(billing) {
  if (!billing) return false;
  const override = String(billing.manual_access_override || '').toLowerCase();
  if (override === 'disabled') return false;
  if (override === 'active') return true;
  return isSubscriptionActive(billing.subscription_status);
}

async function readBannedAccounts() {
  return USE_SUPABASE ? supabaseRequest('banned_accounts?select=*') : readJson(BANNED_ACCOUNTS_PATH, []);
}

function writeBannedAccounts(rows) {
  writeJson(BANNED_ACCOUNTS_PATH, rows);
}

async function isBannedEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return (await readBannedAccounts()).some(x => String(x.email || '').toLowerCase() === e && x.active !== false);
}

async function setBannedEmail(email, active, reason = '', category = '') {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const rows = await readBannedAccounts();
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
  if (USE_SUPABASE) {
    await supabaseRequest('banned_accounts?on_conflict=email', { method: 'POST', body: next, prefer: 'resolution=merge-duplicates,return=representation' });
  } else writeBannedAccounts(rows);
  return next;
}

function resolvePriceForRole(role) { return role === 'shop' ? STRIPE_PRICE_SHOP_MONTHLY : ''; }
async function requireShopAccess(user, res, paid = true) {
  if (paid && !BILLING_ENABLED) { res.status(503).json({ error: BILLING_UNAVAILABLE }); return null; }
  const verification = (await ops.list('provider_verifications', { user_id: user.id }))[0];
  const billing = paid ? await getBillingByUserIdAsync(user.id) : null;
  const allowed = paid ? subscribedShop(verification, billing, user.id) : approvedShop(verification, user.id);
  if (!allowed) { res.status(403).json({ error: paid ? 'An approved registered shop with an active subscription is required.' : 'Registered shop approval is required before subscribing.' }); return null; }
  return verification;
}

function stripePriceConfigError(price) {
  const value = String(price || '').trim();
  if (!value) return 'No Stripe price is configured for this package.';
  if (value.startsWith('prod_')) return 'Stripe price misconfigured: use the recurring price ID that starts with price_, not the product ID that starts with prod_.';
  if (!value.startsWith('price_')) return 'Stripe price misconfigured: expected a Stripe price ID that starts with price_.';
  return '';
}

async function supabaseRequest(pathname, { method = 'GET', body, prefer, signal } = {}) {
  if (!USE_SUPABASE) throw new Error('Supabase not configured');
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer || (method === 'POST' ? 'return=representation' : 'count=exact')
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase error ${res.status}: ${txt}`);
  }
  if (res.status === 204) return [];
  const responseText = await res.text();
  return responseText.trim() ? JSON.parse(responseText) : [];
}

async function listAuthUsers() {
  if (!USE_SUPABASE) return [];
  const users = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('Could not load authentication users.');
    const data = await res.json();
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
}

async function getAuthUserById(userId) {
  const id = String(userId || '').trim();
  if (!id || !USE_SUPABASE) return null;
  const users = await listAuthUsers();
  return users.find(u => String(u?.id || '') === id) || null;
}

async function getAuthUserFromAccessToken(token) {
  const bearer = String(token || '').trim();
  if (!bearer || !USE_SUPABASE) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${bearer}`
      }
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getAuthenticatedUser(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const user = await getAuthUserFromAccessToken(token);
  if (user?.id) return user;

  const allowDevAuth = String(process.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true' && process.env.NODE_ENV !== 'production';
  if (allowDevAuth) {
    const devUserId = String(req.headers['x-dev-user-id'] || '').trim();
    const devEmail = String(req.headers['x-dev-user-email'] || '').trim().toLowerCase();
    const devRole = String(req.headers['x-dev-user-role'] || 'owner').trim().toLowerCase();
    if (devUserId) return { id: devUserId, email: devEmail, user_metadata: { role: devRole, services: '' }, app_metadata: {} };
  }

  return null;
}

async function requireAuthenticatedUser(req, res, allowedRoles = []) {
  const user = await getAuthenticatedUser(req);
  if (!user?.id) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (await isBannedEmail(user.email)) {
    res.status(403).json({ error: 'This account is restricted. Contact support.' });
    return null;
  }
  const role = trustedRole(user);
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (allowed.length && !allowed.includes(role)) {
    res.status(403).json({ error: 'You are not authorized for this action.' });
    return null;
  }
  return user;
}

function roleForUser(user) {
  return trustedRole(user);
}

function getUserServices(user) {
  return String(user?.user_metadata?.services || '').trim();
}

function stripTaggedJson(text = '', tagName = '') {
  const tag = String(tagName || '').trim();
  if (!tag) return String(text || '').trim();
  return String(text || '').replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'g'), '').trim();
}

function parseTaggedJson(text = '', tagName = '') {
  const tag = String(tagName || '').trim();
  if (!tag) return {};
  const match = String(text || '').match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function stripPrivateRepairTags(text = '') {
  return stripTaggedJson(stripTaggedJson(text, 'OWNER_META'), 'CLIENT_META');
}

function sanitizeRepairForUser(repair, user, { includeOwnerContact = false } = {}) {
  const role = roleForUser(user);
  const isOwner = String(repair?.owner_id || '') === String(user?.id || '');
  const out = {
    id: repair?.id,
    owner_id: isOwner ? repair?.owner_id : undefined,
    title: repair?.title,
    issue_category: repair?.issue_category,
    issue_details: stripPrivateRepairTags(repair?.issue_details || ''),
    vehicle_year: repair?.vehicle_year,
    vehicle_make: repair?.vehicle_make,
    vehicle_model: repair?.vehicle_model,
    city: repair?.city,
    state: repair?.state,
    zip: role === 'owner' && isOwner ? repair?.zip : String(repair?.zip || '').replace(/^(\d{3}).*/, '$1xx'),
    urgency: repair?.urgency,
    status: repair?.status,
    completion_requested_at: repair?.completion_requested_at || null,
    workflow_revision: Number(repair?.workflow_revision || 0),
    created_at: repair?.created_at,
    invite_expires_at: repair?.invite_expires_at || null,
    dispatch_summary: isOwner ? repair?.dispatch_summary : undefined,
    __preview_locked: !!repair?.__preview_locked
  };
  if (isOwner || includeOwnerContact) {
    out.zip = repair?.zip;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function sanitizeBidForUser(bid, user, { includeProviderContact = false } = {}) {
  const meta = parseTaggedJson(bid?.notes || '', 'META');
  const cleanNotes = stripTaggedJson(bid?.notes || '', 'META');
  const out = {
    id: bid?.id,
    request_id: bid?.request_id,
    mechanic_id: includeProviderContact || String(bid?.mechanic_id || '') === String(user?.id || '') ? bid?.mechanic_id : undefined,
    mechanic_name: bid?.mechanic_name,
    amount: bid?.amount,
    eta_hours: bid?.eta_hours,
    notes: cleanNotes,
    status: bid?.status,
    created_at: bid?.created_at,
    provider: {
      type: meta.providerType || '',
      typeLabel: meta.providerTypeLabel || '',
      businessName: meta.businessName || bid?.mechanic_name || '',
      businessAddress: includeProviderContact ? (meta.businessAddress || '') : '',
      businessZip: meta.businessZip || '',
      serviceRadiusMiles: meta.serviceRadiusMiles || '',
      certifications: meta.certifications || '',
      services: meta.services || ''
    }
  };
  if (includeProviderContact) {
    out.provider.businessEmail = meta.businessEmail || '';
    out.provider.businessPhone = meta.businessPhone || '';
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

async function getRepairById(repairId) {
  const id = Number(repairId);
  if (!id) return null;
  if (USE_SUPABASE) {
    const found = await supabaseRequest(`repair_requests?select=*&id=eq.${id}&limit=1`);
    return found[0] || null;
  }
  return readJson(REPAIR_REQUESTS_PATH, []).find(r => Number(r.id) === id) || null;
}

async function getBidById(bidId) {
  const id = Number(bidId);
  if (!id) return null;
  if (USE_SUPABASE) {
    const found = await supabaseRequest(`bids?select=*&id=eq.${id}&limit=1`);
    return found[0] || null;
  }
  return readJson(BIDS_PATH, []).find(b => Number(b.id) === id) || null;
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
    client_request_id: row.client_request_id || null,
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
  const raw = String(v || '').trim().toLowerCase();
  const key = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases = {
    ac_heating: 'ac',
    a_c_heating: 'ac',
    tire_replacement: 'tire_replacement',
    tires: 'tire_replacement',
    tire: 'tire_replacement',
    battery_starter_alternator: 'battery',
    battery: 'battery',
    starter: 'battery',
    alternator: 'battery',
    oil_change_maintenance: 'oil_change'
  };
  return aliases[key] || key;
}

function providerSupportsRepair(provider, repair) {
  if (!withinServiceArea(provider, repair)) return false;
  const providerServices = String(provider?.services || '').trim().toLowerCase();
  if (!providerServices) return false;
  const set = new Set(providerServices.split(',').map(normalizeServiceKey).filter(Boolean));
  if (!set.size) return true;
  const category = normalizeServiceKey(repair?.issue_category || repair?.IssueCategory || '');
  if (!category) return true;
  return set.has(category) || set.has('other');
}

function providerEligibleForInvites(provider) {
  if (!BILLING_ENABLED) return false;
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

async function listInvites({ repairId, providerEmail, providerType, status } = {}) {
  if (USE_SUPABASE) {
    try {
      const q = ['select=*', 'order=created_at.desc,id.desc'];
      if (repairId) q.push(`repair_id=eq.${encodeURIComponent(repairId)}`);
      if (providerEmail) q.push(`provider_email=eq.${encodeURIComponent(String(providerEmail).toLowerCase())}`);
      if (providerType) q.push(`provider_type=eq.${encodeURIComponent(normalizeProviderType(providerType))}`);
      if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
      const all = [];
      for (let offset = 0; ; ) {
        const batch = await supabaseRequest(`request_invites?${q.join('&')}&limit=1000&offset=${offset}`);
        if (!batch.length) return all;
        all.push(...batch);
        offset += batch.length;
      }
    } catch (error) { throw error; }
  }
  let rows = readInvites();
  if (repairId) rows = rows.filter(i => Number(i.repair_id) === Number(repairId));
  if (providerEmail) rows = rows.filter(i => String(i.provider_email || '').toLowerCase() === String(providerEmail).toLowerCase());
  if (providerType) rows = rows.filter(i => normalizeProviderType(i.provider_type) === normalizeProviderType(providerType));
  if (status) rows = rows.filter(i => String(i.status || '').toLowerCase() === String(status).toLowerCase());
  return rows;
}

async function replaceInvitesForRepair(repairId, additions = []) {
  if (USE_SUPABASE) {
    try {
      await supabaseRequest(`request_invites?repair_id=eq.${encodeURIComponent(repairId)}`, { method: 'DELETE' });
      if (!additions.length) return [];
      const inserted = await supabaseRequest('request_invites?on_conflict=repair_id,provider_email,provider_type', { method: 'POST', body: additions, prefer: 'resolution=ignore-duplicates,return=representation' });
      await recordInvites(inserted);
      return inserted;
    } catch (error) { throw error; }
  }
  const rows = readInvites();
  const next = [...rows.filter(r => Number(r.repair_id) !== Number(repairId)), ...additions];
  writeInvites(next);
  await recordInvites(additions);
  return additions;
}

async function appendInvites(additions = []) {
  if (!Array.isArray(additions) || !additions.length) return [];
  if (USE_SUPABASE) {
    try {
      const inserted = await supabaseRequest('request_invites?on_conflict=repair_id,provider_email,provider_type', { method: 'POST', body: additions, prefer: 'resolution=ignore-duplicates,return=representation' });
      await recordInvites(inserted);
      return inserted;
    } catch (error) { throw error; }
  }
  const rows = readInvites();
  const existing = new Set(rows.map(r => `${Number(r.repair_id)}:${String(r.provider_email || '').toLowerCase()}:${normalizeProviderType(r.provider_type)}`));
  const unique = [];
  for (const addition of additions) {
    const key = `${Number(addition.repair_id)}:${String(addition.provider_email || '').toLowerCase()}:${normalizeProviderType(addition.provider_type)}`;
    if (existing.has(key)) continue;
    existing.add(key);
    unique.push(addition);
  }
  if (!unique.length) return [];
  writeInvites([...rows, ...unique]);
  await recordInvites(unique);
  return unique;
}

async function updateInvite(invite, patch = {}) {
  if (!invite) return null;
  if (USE_SUPABASE && invite.id) {
    try {
      await supabaseRequest(`request_invites?id=eq.${encodeURIComponent(invite.id)}`, { method: 'PATCH', body: patch });
      const rows = await listInvites({ repairId: invite.repair_id });
      return rows.find(i => Number(i.id) === Number(invite.id)) || null;
    } catch (error) { throw error; }
  }
  const rows = readInvites();
  const idx = rows.findIndex(i => (
    Number(i.repair_id) === Number(invite.repair_id)
    && String(i.provider_email || '').toLowerCase() === String(invite.provider_email || '').toLowerCase()
    && normalizeProviderType(i.provider_type) === normalizeProviderType(invite.provider_type)
    && String(i.created_at || '') === String(invite.created_at || '')
  ));
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...patch };
    writeInvites(rows);
    return rows[idx];
  }
  return null;
}

async function removeInvitesForRepair(repairId) {
  if (USE_SUPABASE) {
    try {
      await supabaseRequest(`request_invites?repair_id=eq.${encodeURIComponent(repairId)}`, { method: 'DELETE' });
      return;
    } catch (error) { throw error; }
  }
  writeInvites(readInvites().filter(i => Number(i.repair_id) !== Number(repairId)));
}

async function listProviderPool() {
  const providers = [];
  const verifications = await ops.list('provider_verifications');
  const eligible = (id, billing) => subscribedShop(verifications.find(v => String(v.user_id) === String(id)), billing, id);

  const authUsers = await listAuthUsers();
  for (const u of authUsers) {
    const meta = u?.user_metadata || {};
    const role = trustedRole(u);
    if (!['mechanic', 'shop'].includes(role)) continue;
    const email = String(u?.email || '').trim().toLowerCase();
    if (!email || await isBannedEmail(email)) continue;
    const billing = await getBillingByUserIdAsync(String(u?.id || ''));
    providers.push({
      email,
      userId: String(u?.id || ''),
      providerType: role === 'shop' ? 'shop' : 'mechanic',
      services: String(meta?.services || '').trim().toLowerCase(),
      zip: String(meta?.zip || ''),
      serviceRadiusMiles: Number(meta?.serviceRadiusMiles || 25),
      can_submit_estimates: eligible(u.id, billing)
    });
  }

  const billingAccounts = await listBillingAccounts();
  for (const b of billingAccounts) {
    const role = String(b?.role || '').toLowerCase();
    if (!['mechanic', 'shop'].includes(role)) continue;
    const email = String(b?.email || '').trim().toLowerCase();
    if (!email || await isBannedEmail(email)) continue;
    providers.push({
      email,
      userId: String(b?.user_id || ''),
      providerType: role === 'shop' ? 'shop' : 'mechanic',
      services: String(b.services || ''),
      zip: String(b.zip || ''),
      serviceRadiusMiles: Number(b.serviceRadiusMiles || 25),
      can_submit_estimates: eligible(b.user_id, b)
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

function eligibleRankedProviders(pool, history, repair, now) {
  return rankInviteCandidates(pool
    .filter(p => p.providerType === 'shop')
    .filter(providerEligibleForInvites)
    .filter(provider => providerSupportsRepair(provider, repair))
    .map(provider => ({ ...provider, distanceMiles: providerDistanceMiles(provider, repair) })),
  history, repair, now);
}

async function createDispatchSnapshot(repair) {
  return runDispatchExclusive(() => createDispatchSnapshotUnlocked(repair));
}

async function createDispatchSnapshotUnlocked(repair) {
  if (!BILLING_ENABLED) return;
  if (repair.status !== 'open' || requestIsExpiredForNewInvites(repair)) return;
  const history = await listInvites();
  if (history.some(invite => Number(invite.repair_id) === Number(repair.id || repair.Id))) return;
  const pool = await listProviderPool();
  const invited = initialInviteCandidates(eligibleRankedProviders(pool, history, repair, Date.now()));

  const repairId = Number(repair.id || repair.Id);
  const now = Date.now();
  const windowMs = getInviteWindowMs(repair?.urgency);
  const additions = invited.map(p => ({
    repair_id: repairId,
    provider_email: p.email,
    provider_type: p.providerType,
    status: 'pending',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + windowMs).toISOString(),
    submitted_at: null
  }));
  await appendInvites(additions);
}

async function processInviteExpirations(repairs = []) {
  if (!Array.isArray(repairs) || !repairs.length) return;
  const rows = await listInvites();
  const pool = await listProviderPool();
  const now = Date.now();

  for (const repair of repairs) {
    const repairId = Number(repair.id || repair.Id);
    if (!repairId) continue;
    if (String(repair.status || '').toLowerCase() !== 'open') continue;

    const rInvites = rows.filter(r => Number(r.repair_id) === repairId);
    for (const inv of rInvites) {
      if (String(inv.status || 'pending') !== 'pending') continue;
      const exp = new Date(inv.expires_at || 0).getTime();
      if (!Number.isFinite(exp) || exp > now) continue;

      const expiredPatch = { status: 'expired', expired_at: new Date(now).toISOString() };
      Object.assign(inv, expiredPatch);
      await updateInvite(inv, expiredPatch);

      if (requestIsExpiredForNewInvites(repair)) continue;

      const type = normalizeProviderType(inv.provider_type);
      const used = new Set(rInvites.map(x => `${String(x.provider_email || '').toLowerCase()}:${normalizeProviderType(x.provider_type)}`));
      const next = eligibleRankedProviders(pool, rows, repair, now).find(p => p.providerType === type && providerEligibleForInvites(p) && providerSupportsRepair(p, repair) && !used.has(`${p.email}:${p.providerType}`));
      if (!next) continue;

      const windowMs = getInviteWindowMs(repair?.urgency);
      const addition = {
        repair_id: repairId,
        provider_email: next.email,
        provider_type: next.providerType,
        status: 'pending',
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + windowMs).toISOString(),
        submitted_at: null,
        replaced_from: String(inv.provider_email || '').toLowerCase()
      };
      const inserted = await appendInvites([addition]);
      rows.push(...inserted);
      rInvites.push(...inserted);
    }
  }
}

async function processInviteEscalations(repairs = []) {
  if (!Array.isArray(repairs) || !repairs.length) return;

  const rows = await listInvites();
  const pool = await listProviderPool();
  const now = Date.now();
  const additions = [];

  async function addWave(repair, wave, additionalCount) {
    const repairId = Number(repair?.id || repair?.Id);
    if (!repairId) return;

    const alreadyWave = rows.some(r => Number(r.repair_id) === repairId && Number(r.escalation_wave || 0) === wave);
    if (alreadyWave) return;

    const used = new Set(rows
      .filter(r => Number(r.repair_id) === repairId)
      .map(r => `${String(r.provider_email || '').toLowerCase()}:${normalizeProviderType(r.provider_type)}`));

    const eligible = eligibleRankedProviders(pool, rows, repair, now)
      .filter(p => !used.has(`${p.email}:${p.providerType}`));

    if (!eligible.length) return;

    const picks = eligible.slice(0, additionalCount);
    const windowMs = getInviteWindowMs(repair?.urgency);
    for (const p of picks) {
      const addition = {
        repair_id: repairId,
        provider_email: p.email,
        provider_type: p.providerType,
        status: 'pending',
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + windowMs).toISOString(),
        submitted_at: null,
        escalation_wave: wave
      };
      rows.push(addition);
      additions.push(addition);
    }
  }

  for (const repair of repairs) {
    const repairId = Number(repair?.id || repair?.Id);
    if (!repairId) continue;
    if (String(repair?.status || '').toLowerCase() !== 'open') continue;
    if (requestIsExpiredForNewInvites(repair)) continue;

    const created = new Date(repair?.created_at || repair?.CreatedDate || 0).getTime();
    if (!Number.isFinite(created)) continue;
    const ageMs = now - created;

    const bids = await listBids({ requestId: repairId });
    const openOrAccepted = (bids || []).filter(b => {
      const s = String(b?.status || 'open').toLowerCase();
      return s === 'open' || s === 'accepted';
    }).length;

    if (openOrAccepted >= ESCALATION_MIN_BIDS) continue;

    if (ageMs >= ESCALATION_WAVE_3_MS) {
      await addWave(repair, 3, 8);
    } else if (ageMs >= ESCALATION_WAVE_2_MS) {
      await addWave(repair, 2, 5);
    }
  }

  await appendInvites(additions);
}

async function refreshDispatch(repairs) {
  if (!BILLING_ENABLED) return;
  return runDispatchExclusive(async () => {
    // Recover repairs whose initial dispatch failed or had no eligible providers.
    // Every candidate is selected by the same queue, independent of who views it.
    const history = await listInvites();
    const dispatched = new Set(history.map(invite => Number(invite.repair_id)));
    for (const repair of repairs) {
      if (!dispatched.has(Number(repair.id || repair.Id))) await createDispatchSnapshotUnlocked(repair);
    }
    await processInviteExpirations(repairs);
    await processInviteEscalations(repairs);
  });
}

async function attachOwnerDispatchSummary(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const invites = await listInvites();
  const byRepair = new Map();
  for (const inv of invites) {
    const rid = Number(inv.repair_id);
    if (!rid) continue;
    const slot = byRepair.get(rid) || { totalInvites: 0, activeInvites: 0, submittedInvites: 0, expiredInvites: 0, lastInviteAt: null };
    slot.totalInvites += 1;
    const st = String(inv.status || 'pending').toLowerCase();
    if (st === 'pending') slot.activeInvites += 1;
    if (st === 'submitted') slot.submittedInvites += 1;
    if (st === 'expired') slot.expiredInvites += 1;
    const createdAt = inv.created_at || null;
    if (createdAt && (!slot.lastInviteAt || new Date(createdAt).getTime() > new Date(slot.lastInviteAt).getTime())) {
      slot.lastInviteAt = createdAt;
    }
    byRepair.set(rid, slot);
  }

  const withCounts = await Promise.all(rows.map(async (r) => {
    const rid = Number(r.id || r.Id);
    const dispatch = byRepair.get(rid) || { totalInvites: 0, activeInvites: 0, submittedInvites: 0, expiredInvites: 0, lastInviteAt: null };
    let totalBids = 0;
    try {
      const bids = await listBids({ requestId: rid });
      totalBids = Array.isArray(bids) ? bids.length : 0;
    } catch {}
    return { ...r, dispatch_summary: { ...dispatch, totalBids } };
  }));

  return withCounts;
}

async function listRepairRequests({ ownerId, status, providerEmail, providerType, providerServices, previewLeads } = {}) {
  if (USE_SUPABASE) {
    const q = ['select=*', 'order=created_at.desc'];
    if (ownerId) q.push(`owner_id=eq.${encodeURIComponent(ownerId)}`);
    if (status) q.push(`status=eq.${encodeURIComponent(status)}`);
    let rows = await supabaseRequest(`repair_requests?${q.join('&')}`);
    try { await refreshDispatch(rows); } catch (error) { console.error('Dispatch retry needed:', error.name); }
    if (providerEmail) {
      const pool = await listProviderPool();
      const provider = pool.find(p => String(p.email || '').toLowerCase() === String(providerEmail).toLowerCase());
      const canSeeInvitedFull = providerEligibleForInvites(provider);
      const now = Date.now();
      const invites = await listInvites({ providerEmail });
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
          .filter(r => byRepair.has(Number(r.id)) && providerSupportsRepair(provider, r))
          .map(r => ({ ...r, invite_expires_at: byRepair.get(Number(r.id))?.expires_at || null }))
        : [];

      if (previewLeads && !canSeeInvitedFull) {
        const invitedIds = new Set(invitedRows.map(x => Number(x.id)));
        const previewRows = rows
          .filter(r => String(r.status || '').toLowerCase() === 'open' && providerSupportsRepair(provider, r))
          .filter(r => !invitedIds.has(Number(r.id)))
          .slice(0, 12)
          .map(toPreviewRepair);
        rows = [...invitedRows, ...previewRows];
      } else {
        rows = invitedRows;
      }
    }
    if (ownerId && !providerEmail) rows = await attachOwnerDispatchSummary(rows);
    return rows;
  }
  let data = readJson(REPAIR_REQUESTS_PATH, []);
  if (ownerId) data = data.filter(x => String(x.owner_id) === String(ownerId));
  if (status) data = data.filter(x => String(x.status) === String(status));
  try { await refreshDispatch(data); } catch (error) { console.error('Dispatch retry needed:', error.name); }
  if (providerEmail) {
    const pool = await listProviderPool();
    const provider = pool.find(p => String(p.email || '').toLowerCase() === String(providerEmail).toLowerCase());
    const canSeeInvitedFull = providerEligibleForInvites(provider);
    const now = Date.now();
    const invites = await listInvites({ providerEmail });
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
        .filter(x => byRepair.has(Number(x.id)) && providerSupportsRepair(provider, x))
        .map(x => ({ ...x, invite_expires_at: byRepair.get(Number(x.id))?.expires_at || null }))
      : [];

    if (previewLeads && !canSeeInvitedFull) {
      const invitedIds = new Set(invitedRows.map(x => Number(x.id)));
      const previewRows = data
        .filter(x => String(x.status || '').toLowerCase() === 'open' && providerSupportsRepair(provider, x))
        .filter(x => !invitedIds.has(Number(x.id)))
        .slice(0, 12)
        .map(toPreviewRepair);
      data = [...invitedRows, ...previewRows];
    } else {
      data = invitedRows;
    }
  }
  if (ownerId && !providerEmail) data = await attachOwnerDispatchSummary(data);
  return data;
}

async function createBid(row) {
  if (USE_SUPABASE) {
    const out = await supabaseRequest('rpc/create_shop_bid', { method: 'POST', body: { p_bid: row } });
    return out[0];
  }
  // Synchronous read/check/write is atomic within the local development process.
  const bids = readJson(BIDS_PATH, []);
  if (bids.filter(b => Number(b.request_id) === Number(row.request_id)).length >= 3) throw new Error('Estimate limit reached');
  if (bids.some(b => Number(b.request_id) === Number(row.request_id) && b.mechanic_id === row.mechanic_id)) throw new Error('Estimate already submitted');
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
    } catch (error) { throw error; }
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
    } catch (error) { throw error; }
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
  const mechanics = data.filter(x => (x.Type || x.type) === 'mechanic').length;  return { total, owners, mechanics };
}
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true;  if (token === 'dev-bypass' && process.env.NODE_ENV !== 'production') return true;
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
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;  const body = new URLSearchParams({ To: `+1${to}`, From: TWILIO_FROM_NUMBER, Body: text });
  await axios.post(url, body.toString(), {
    auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });  return true;
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

route('post', '/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(400).send('Stripe webhook not configured.');
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const object = event.data.object;
    let subscriptionId;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const userId = object.metadata?.userId;
      subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (userId && subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertBillingByUserIdAsync(userId, {
          email: object.customer_details?.email || '', role: object.metadata?.role || 'mechanic',
          stripe_customer_id: object.customer, stripe_subscription_id: sub.id,
          ...attestShopPlan(sub, STRIPE_PRICE_SHOP_MONTHLY),
          subscription_status: sub.status, current_period_end: subscriptionPeriodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end
        });
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      subscriptionId = object.id;
    } else if (event.type.startsWith('invoice.')) {
      subscriptionId = object.subscription || object.parent?.subscription_details?.subscription;
    }
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await updateBillingBySubscriptionId(subscriptionId, {
        ...attestShopPlan(sub, STRIPE_PRICE_SHOP_MONTHLY),
          subscription_status: sub.status, current_period_end: subscriptionPeriodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end
      });
    }
    res.json({ received: true });
  } catch {
    res.status(500).send('Webhook processing failed');
  }
});

app.use(express.json({ limit: '100kb' }));

app.use(express.static(path.join(__dirname, 'public')));

route('get', '/api/stats', async (req, res) => {
  try {
    const data = await listSignups();
    res.json(counts(data));
  } catch (e) {
    res.status(500).json({ error: 'Could not load stats' });
  }
});

route('get', '/api/availability', (req, res) => res.json({ billingMode: BILLING_ENABLED ? 'enabled' : 'disabled', newQuotesAvailable: BILLING_ENABLED, message: BILLING_ENABLED ? null : BILLING_UNAVAILABLE }));

// One bounded dependency check per process, shared by concurrent health requests.
const checkDatabaseReadiness = singleFlightProbe(async signal => {
  const request = pathname => supabaseRequest(pathname, { signal });
  let databaseReady = !USE_SUPABASE && process.env.NODE_ENV !== 'production';
  if (USE_SUPABASE) {
    try {
      const group1 = await Promise.allSettled(['repair_requests', 'bids', 'request_invites', 'billing_accounts', 'banned_accounts', 'notifications', 'refund_requests'].map(table => request(`${table}?select=*&limit=0`)));
      if (group1.some(r => r.status === "rejected")) throw Error("Readiness unavailable");
      signal.throwIfAborted();
      const group2 = await Promise.allSettled([
        request('admin_memberships?select=user_id&limit=0'),
        request('admin_audit_events?select=id&limit=0'),
        request('repair_requests?select=completion_requested_at,workflow_revision&limit=0'),
        request('repair_transition_events?select=id&limit=0'),
        request('repair_photos?select=id,repair_id,state&limit=0'),
        request('repair_messages?select=id,bid_id,sender_id,body&limit=0'),
        request('provider_verifications?select=business_type,registration_reference,business_address,reviewed_at&limit=0'),
        request('billing_accounts?select=shop_plan_valid,shop_plan_price_id,shop_plan_checked_at,billing_reconcile_after&limit=0')
      ]);
      if (group2.some(r => r.status === "rejected")) throw Error("Readiness unavailable");
      signal.throwIfAborted();
      await privatePhotoObjects.ready({ signal });
      databaseReady = true;
    } catch { databaseReady = false; }
  }
  return databaseReady;
});
route('get', '/api/health', async (req, res) => {
  const databaseReady = await checkDatabaseReadiness();
  const missingConfig = missingProductionConfig();
  const ok = missingConfig.length === 0 && databaseReady;
  res.status(ok ? 200 : 503).json({ ok, databaseReady, billingMode: BILLING_ENABLED ? 'enabled' : 'disabled', stripeConfigured: !!stripe,
    stripeBillingReady: billingConfigReady(), supabaseConfigured: USE_SUPABASE,
    missingProductionConfig: missingConfig, uptimeSec: Math.round(process.uptime()), ts: new Date().toISOString() });
});

route('post', '/api/send-otp', async (req, res) => {
  res.json({ ok: true, disabled: true, note: 'SMS verification is temporarily disabled.' });
});

route('post', '/api/signup', async (req, res) => {
  const { name, email, phone, zip, repairAddress, borough, type, experience, hasShop, turnstileToken, utm, heroVariant } = req.body || {};
  if (!name || !email || !phone || !zip || !borough || !type) return res.status(400).json({ error: 'Missing required fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (![name,email,phone,zip,borough].every(v => boundedText(v,1,320))) return res.status(400).json({ error: 'Invalid signup text fields.' });
  if (!['owner', 'shop'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (await isBannedEmail(normalizedEmail)) return res.status(403).json({ error: 'This account is restricted. Contact support.' });

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
    experience: '',
    has_shop: type === 'shop' ? 'yes' : '',
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
    await sendSms(cleanPhone, `You're on the ShopMyRepair launch list. We'll text you when quotes open in your area.`);
  } catch {}

  const all = await listSignups();
  res.json({ ok: true, counts: counts(all) });
});

route('post', '/api/owner-request', async (req, res) => {
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
  const validationError = repairValidationError({ ...req.body, title: 'Owner repair request' });
  if (validationError || !boundedText(fullName,1,160) || !boundedText(serviceAddress,3,500) || !boundedText(email,3,254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !boundedText(mobile,10,32) || !/^[+()\d .-]+$/.test(mobile) || !/^1?\d{10}$/.test(mobile.replace(/\D/g,'')) || !validZip(zip)) return res.status(400).json({ error: validationError || 'Enter valid contact and address details.' });
  if (await isBannedEmail(String(email).trim().toLowerCase())) {
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
route('post', '/api/repairs', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['owner']);
  if (!user) return;

  const {
    title,
    issueCategory,
    issueDetails,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    city,
    state,
    zip,
    urgency,
    clientRequestId
  } = req.body || {};

  if (!title || !issueCategory || !issueDetails || !vehicleYear || !vehicleMake || !vehicleModel || !city || !state || !zip) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    if (!validZip(zip)) return res.status(400).json({ error: 'Enter a valid five-digit US ZIP code.' });
    const validationError = repairValidationError(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const cleanClientRequestId = String(clientRequestId || '').trim();
    if (cleanClientRequestId && !/^[a-zA-Z0-9_.:-]{8,120}$/.test(cleanClientRequestId)) {
      return res.status(400).json({ error: 'Invalid request token.' });
    }

    if (cleanClientRequestId) {
      const ownerRepairs = await listRepairRequests({ ownerId: String(user.id) });
      const existing = ownerRepairs.find(r => {
        const meta = parseTaggedJson(r?.issue_details || '', 'CLIENT_META');
        return String(meta.clientRequestId || '') === cleanClientRequestId;
      });
      if (existing) {
        return res.json({ ok: true, repair: sanitizeRepairForUser(existing, user), duplicate: true });
      }
    }

    const clientMeta = cleanClientRequestId
      ? `[CLIENT_META]${JSON.stringify({ clientRequestId: cleanClientRequestId })}[/CLIENT_META]`
      : '';
    const created = await createRepairRequest({
      owner_id: String(user.id).trim(),
      client_request_id: cleanClientRequestId || null,
      title: String(title).trim(),
      issue_category: String(issueCategory).trim(),
      issue_details: `${clientMeta}${String(issueDetails).trim()}`,
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
    res.json({ ok: true, repair: sanitizeRepairForUser(created, user) });
  } catch (e) {
    res.status(500).json({ error: 'Could not create repair request.' });
  }
});

// Historical participation is separate from entitlement to discover new leads.
route('get', '/api/provider/repair-history', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['mechanic', 'shop']);
  if (!user) return;
  const bids = await listBids({ mechanicId: String(user.id) });
  const repairIds = [...new Set(bids.map(b => Number(b.request_id)))];
  const repairs = [];
  for (const id of repairIds) {
    const repair = await getRepairById(id);
    if (repair) repairs.push(sanitizeRepairForUser(repair, user));
  }
  res.json({ ok: true, repairs });
});

route('get', '/api/repairs', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['owner', 'mechanic', 'shop']);
  if (!user) return;

  try {
    const role = roleForUser(user);
    if (role !== 'owner' && !(await requireShopAccess(user, res))) return;
    const status = req.query.status ? String(req.query.status) : undefined;
    const ownerId = role === 'owner' ? String(user.id) : undefined;
    const providerEmail = role === 'mechanic' || role === 'shop' ? String(user.email || '').toLowerCase() : undefined;
    const providerType = role === 'shop' ? 'shop' : role === 'mechanic' ? 'mechanic' : undefined;
    const providerServices = providerEmail ? (req.query.providerServices ? String(req.query.providerServices) : getUserServices(user)) : undefined;
    const previewLeads = false;
    const rows = await listRepairRequests({ ownerId, status, providerEmail, providerType, providerServices, previewLeads });
    res.json({ ok: true, repairs: rows.map(r => sanitizeRepairForUser(r, user)) });
  } catch (e) {
    res.status(500).json({ error: 'Could not load repairs.' });
  }
});

route('get','/api/repairs/:id/transitions',async(req,res)=>{
 const user=await requireAuthenticatedUser(req,res,['owner','mechanic','shop']);if(!user)return;
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid repair ID.'});
 const repair=await getRepairById(id);if(!repair)return res.status(404).json({error:'Repair not found.'});
 if(String(repair.owner_id)!==String(user.id)&&!(await listBids({requestId:id,mechanicId:String(user.id)})).length)return res.status(404).json({error:'Repair not found.'});
 const rows=USE_SUPABASE?await supabaseRequest('repair_transition_events?repair_id=eq.'+id+'&select=action,from_status,to_status,created_at&order=id.desc&limit=50'):[...(repair.transition_history||[])].reverse().slice(0,50);
 res.json({ok:true,events:rows.map(e=>({action:e.action,fromStatus:e.from_status,toStatus:e.to_status,createdAt:e.created_at}))});
});

for (const action of ['cancel','complete','start-work','request-completion','continue-work']) {
  route('post', '/api/repairs/:id/' + action, async (req,res) => {
    const id=Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id)||!Number.isSafeInteger(id)) return res.status(400).json({error:'Invalid repair ID.'});
    const expectedRevision=req.body?.expectedRevision;
    if(['start-work','request-completion','continue-work'].includes(action)&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))return res.status(400).json({error:'Current workflow revision required.'});
    const admin=['cancel','complete'].includes(action)&&isAuthorizedAdminRequest(req);
    const user=admin?req.adminUser:await requireAuthenticatedUser(req,res,['owner','mechanic','shop']);
    if(!user)return;
    try {
      if(USE_SUPABASE){
        const repair=await getRepairById(id);if(!repair)return res.status(404).json({error:'Repair not found.'});
        const bids=await listBids({requestId:id});
        repairTransition(repair,bids,{id:user.id,admin},action,undefined,expectedRevision); // Friendly errors; RPC repeats checks under lock.
        const result=await supabaseRequest('rpc/transition_repair',{method:'POST',body:{p_repair_id:id,p_actor_id:String(user.id),p_action:action,p_admin:admin,p_expected_revision:expectedRevision??null}});
        return res.json(result);
      }
      // No await inside local read/validate/write critical section.
      const repairs=readJson(REPAIR_REQUESTS_PATH,[]),index=repairs.findIndex(r=>Number(r.id)===id);
      if(index<0)return res.status(404).json({error:'Repair not found.'});
      const bids=readJson(BIDS_PATH,[]),result=repairTransition(repairs[index],bids,{id:user.id,admin},action,undefined,expectedRevision);
      if(result.changed){
        result.repair.transition_history=[...(repairs[index].transition_history||[]),result.event];
        repairs[index]=result.repair;writeJson(REPAIR_REQUESTS_PATH,repairs);
      }
      // Also repair an interrupted local cancellation on an idempotent retry.
      if(action==='cancel'){bids.forEach(b=>{if(Number(b.request_id)===id&&b.status==='open')b.status='declined';});writeJson(BIDS_PATH,bids);
      }
      return res.json({ok:true,changed:result.changed});
    }catch(error){return res.status(error.status||409).json({error:error.status?error.message:'Repair state changed or storage unavailable. Refresh before retrying.'});}
  });
}

route('post', '/api/bids', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['shop']);
  if (!user) return;
  const verifiedShop = await requireShopAccess(user, res);
  if (!verifiedShop) return;

  const { requestId, mechanicName, amount, etaHours, notes } = req.body || {};
  if (!requestId || !amount || !etaHours) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!Number.isFinite(Number(amount)) || Number(Number(amount).toFixed(2)) !== Number(amount) || Number(amount) <= 0 || Number(amount) > 100000 || !Number.isInteger(Number(etaHours)) || Number(etaHours) < 1 || Number(etaHours) > 8760) return res.status(400).json({ error: 'Enter a positive estimate amount and whole-number availability in hours.' });
  const mechanicId = String(user.id);
  const billing = await getBillingByUserIdAsync(mechanicId);
  if (!billing || !canSubmitEstimatesFromBilling(billing)) {
    return res.status(402).json({ error: 'Active $99/month subscription required to submit estimates.' });
  }

  if (!boundedText(notes, 15, 10000)) return res.status(400).json({ error: 'Invalid estimate notes.' });
  const noteText = String(notes || '').replace(/\[META\][\s\S]*?\[\/META\]/g, '').trim();
  if (noteText.length < 15 || noteText.length > 5000) return res.status(400).json({ error: 'Estimate notes must be 15–5000 characters.' });
  const providerType = 'shop';
  const providerEmail = String(user.email || '').trim().toLowerCase();
  const cleanNotes = '[META]' + JSON.stringify({ providerType, businessName: verifiedShop.business_name, businessEmail: providerEmail, businessPhone: String(user.user_metadata?.phone || '') }) + '[/META] ' + noteText;
  try {
    const repairs = await listRepairRequests({
      providerEmail: String(user.email || '').toLowerCase(),
      providerType: roleForUser(user) === 'shop' ? 'shop' : 'mechanic',
      providerServices: getUserServices(user),
      previewLeads: false
    });
    const targetRepair = repairs.find(r => Number(r.id) === Number(requestId));
    if (!targetRepair) return res.status(404).json({ error: 'Repair request not found.' });
    if (targetRepair.status !== 'open' || requestIsExpiredForNewInvites(targetRepair)) {
      return res.status(400).json({ error: 'This repair request is closed for new estimates.' });
    }

    const existingAllForRequest = await listBids({ requestId: Number(requestId) });
    if (existingAllForRequest.some(b => String(b.mechanic_id) === String(mechanicId) && String(b.status || '').toLowerCase() !== 'declined')) {
      return res.status(400).json({ error: 'You already submitted an estimate for this request.' });
    }

    const invites = await listInvites({ repairId: Number(requestId) });
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

    if (existingAllForRequest.length >= 3) return res.status(409).json({ error: 'This request already has 3 estimates.' });

    const created = await createBid({
      request_id: Number(requestId),
      mechanic_id: String(mechanicId).trim(),
      mechanic_name: verifiedShop.business_name,
      amount: Number(amount),
      eta_hours: Number(etaHours),
      notes: cleanNotes,
      provider_type: providerType,
      status: 'open',
      created_at: new Date().toISOString()
    });

    if (providerEmail) {
      const rows = await listInvites({ repairId: Number(requestId), providerEmail, providerType, status: 'pending' });
      const matched = rows[0] || null;
      if (matched) await updateInvite(matched, { status: 'submitted', submitted_at: new Date().toISOString() });
    }

    await notifyUser(targetRepair.owner_id, `bid:${created.id}`, 'A new repair estimate arrived', 'Open your dashboard to compare price, availability, and provider details.', '/owner-app.html');
    res.json({ ok: true, bid: sanitizeBidForUser(created, user, { includeProviderContact: true }) });
  } catch {
    res.status(500).json({ error: 'Could not create bid.' });
  }
});

route('get', '/api/bids', async (req, res) => {
  const adminOverride = isAuthorizedAdminRequest(req);
  const user = adminOverride ? null : await requireAuthenticatedUser(req, res, ['owner', 'mechanic', 'shop']);
  if (!adminOverride && !user) return;

  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    let rows = [];

    if (adminOverride) {
      rows = await listBids({ requestId, mechanicId: req.query.mechanicId ? String(req.query.mechanicId) : undefined, status });
      return res.json({ ok: true, bids: rows });
    }

    const role = roleForUser(user);
    if (role === 'owner') {
      if (!requestId) return res.status(400).json({ error: 'requestId is required for owner bid access.' });
      const repair = await getRepairById(requestId);
      if (!repair || String(repair.owner_id || '') !== String(user.id)) {
        return res.status(403).json({ error: 'You can only view bids for your own repair requests.' });
      }
      rows = await listBids({ requestId, status });
      const reviews = await ops.list('provider_verifications');
      const approved = new Set(reviews.filter(r => approvedShop(r, r.user_id)).map(r => r.user_id));
      return res.json({ ok: true, bids: rows.map(b => ({ ...sanitizeBidForUser(b, user, { includeProviderContact: true }), verificationStatus: approved.has(b.mechanic_id) ? 'approved' : 'unreviewed' })) });
    }

    rows = await listBids({ requestId, mechanicId: String(user.id), status });
    res.json({ ok: true, bids: rows.map(b => sanitizeBidForUser(b, user, { includeProviderContact: true })) });
  } catch {
    res.status(500).json({ error: 'Could not load bids.' });
  }
});

route('post', '/api/bids/:id/accept', async (req, res) => {
  const bidId = Number(req.params.id);
  if (!bidId) return res.status(400).json({ error: 'Invalid bid id.' });
  const adminOverride = isAuthorizedAdminRequest(req);
  const user = adminOverride ? null : await requireAuthenticatedUser(req, res, ['owner']);
  if (!adminOverride && !user) return;

  try {
    const bid = await getBidById(bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found.' });
    const repair = await getRepairById(bid.request_id);
    if (!repair) return res.status(404).json({ error: 'Repair request not found.' });
    if (!adminOverride && String(repair.owner_id || '') !== String(user.id)) {
      return res.status(403).json({ error: 'You can only accept bids for your own repair requests.' });
    }

    if (!['open', 'accepted'].includes(repair.status) || (repair.status === 'accepted' && bid.status !== 'accepted')) return res.status(409).json({ error: 'This repair already has a selected estimate or is closed.' });
    if (USE_SUPABASE) {
      await supabaseRequest('rpc/accept_marketplace_bid', { method: 'POST', body: { p_bid_id: bidId, p_owner_id: user?.id || req.adminUser?.id || '', p_admin: adminOverride } });
      await notifyUser(bid.mechanic_id, `accepted:${bidId}`, 'Your estimate was selected', 'The owner selected your estimate. Open your dashboard to review the job.', '/mechanic.html');
      return res.json({ ok: true });
    }

    const bids = readJson(BIDS_PATH, []);
    const target = bids.find(b => Number(b.id) === bidId);
    if (!target) return res.status(404).json({ error: 'Bid not found.' });
    const currentRepair=readJson(REPAIR_REQUESTS_PATH,[]).find(r=>Number(r.id)===Number(target.request_id));
    if(!currentRepair||!['open','accepted'].includes(currentRepair.status)||(currentRepair.status==='accepted'&&target.status!=='accepted'))return res.status(409).json({error:'Repair changed. Refresh before accepting.'});
    bids.forEach(b => {
      if (Number(b.request_id) === Number(target.request_id)) b.status = Number(b.id) === bidId ? 'accepted' : 'declined';
    });
    writeJson(BIDS_PATH, bids);

    const requests = readJson(REPAIR_REQUESTS_PATH, []);
    requests.forEach(r => {
      if (Number(r.id) === Number(target.request_id) && r.status !== 'accepted') {
        r.transition_history=[...(r.transition_history||[]),{action:'accept',actor_id:user?.id||req.adminUser?.id,from_status:r.status,to_status:'accepted',created_at:new Date().toISOString()}];
        r.status = 'accepted';
      }
    });
    writeJson(REPAIR_REQUESTS_PATH, requests);

    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Could not accept bid. Repair state may have changed; refresh before retrying.' });
  }
});

route('get', '/api/feedbacks', async (req, res) => {
  const adminOverride = isAuthorizedAdminRequest(req);
  const user = adminOverride ? null : await requireAuthenticatedUser(req, res, ['owner', 'mechanic', 'shop']);
  if (!adminOverride && !user) return;

  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    if(req.query.requestId!==undefined&&(!Number.isSafeInteger(requestId)||requestId<1))return res.status(400).json({error:'Invalid repair ID.'});
    const mechanicId = adminOverride
      ? (req.query.mechanicId ? String(req.query.mechanicId) : undefined)
      : (roleForUser(user) === 'owner' ? undefined : String(user.id));
    if (!adminOverride && roleForUser(user) === 'owner' && requestId) {
      const repair = await getRepairById(requestId);
      if (!repair || String(repair.owner_id || '') !== String(user.id)) {
        return res.status(403).json({ error: 'You can only view feedback for your own repair requests.' });
      }
    }
    let rows = await listFeedbacks({ requestId, mechanicId });
    if(!adminOverride&&roleForUser(user)==='owner'&&!requestId){
      const ids=new Set((await listRepairRequests({ownerId:String(user.id)})).map(r=>Number(r.id)));
      rows=rows.filter(r=>ids.has(Number(r.request_id)));
    }
    res.json({ ok: true, feedbacks: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load feedbacks.' });
  }
});

route('post', '/api/feedbacks', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['owner']);
  if (!user) return;

  const { requestId, bidId, rating, text } = req.body || {};
  if (!requestId || !bidId || !rating) return res.status(400).json({ error: 'Missing required fields.' });
  const score = Number(rating);
  if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

  try {
    const repair = await getRepairById(requestId);
    if (!repair || String(repair.owner_id || '') !== String(user.id)) {
      return res.status(403).json({ error: 'You can only review your own completed repairs.' });
    }
    const st = String(repair?.status || '').toLowerCase();
    if (st !== 'completed') return res.status(400).json({ error: 'Reviews can only be submitted for completed jobs.' });
    const bid = await getBidById(bidId);
    if (!bid || Number(bid.request_id) !== Number(requestId) || String(bid.status || '').toLowerCase() !== 'accepted') {
      return res.status(400).json({ error: 'Reviews require the accepted bid for this repair.' });
    }

    const saved = await upsertFeedback({
      request_id: Number(requestId),
      bid_id: Number(bidId),
      mechanic_id: String(bid.mechanic_id),
      owner_id: String(user.id),
      rating: score,
      text: String(text || '').trim()
    });
    res.json({ ok: true, feedback: saved });
  } catch (e) {
    res.status(500).json({ error: 'Could not save feedback.' });
  }
});

route('get', '/api/billing/status', async (req, res) => {
  const user = await requireAuthenticatedUser(req, res, ['mechanic', 'shop']);
  if (!user) return;
  const userId = String(user.id || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  let billing = await getBillingByUserIdAsync(userId);
  if (!BILLING_ENABLED) return res.json({ ok: true, billingMode: 'disabled', canSubmitEstimates: false,
    hasSubscription: !!billing, hasStripeCustomer: !!billing?.stripe_customer_id,
    status: billing?.subscription_status || 'none', currentPeriodEnd: billing?.current_period_end || null,
    message: BILLING_UNAVAILABLE, billingManagementAvailable: false });
  billing = await syncBillingFromStripe(billing);
  if (!billing) {
    return res.json({
      ok: true,
      hasSubscription: false,
      hasStripeCustomer: false,
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
    hasStripeCustomer: !!billing.stripe_customer_id,
    status,
    manualAccessOverride: billing.manual_access_override || null,
    canSubmitEstimates: roleForUser(user) === 'shop' && subscribedShop((await ops.list('provider_verifications', { user_id: userId }))[0], billing, userId),
    currentPeriodEnd: billing.current_period_end || null,
    amountLabel: '$99/month',
    refundPolicy: 'If you receive zero eligible opportunities to submit an estimate in a billing month, your $99 is refunded. Winning jobs is based on quote quality, speed, and reputation.'
  });
});

route('post', '/api/billing/create-checkout-session', async (req, res) => {

  const user = await requireAuthenticatedUser(req, res, ['shop']);
  if (!user) return;
  if (!(await requireShopAccess(user, res, false))) return;
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  const userId = String(user.id || '');
  const email = String(user.email || '').trim().toLowerCase();
  if (!userId || !email) return res.status(400).json({ error: 'userId and email are required.' });

  const role = 'shop';
  const meta = user.user_metadata || {};
  if (!validZip(meta.zip) || !String(meta.services || '').trim() || Number(meta.serviceRadiusMiles) < 1 || Number(meta.serviceRadiusMiles) > 100 || !Number.isFinite(Number(meta.serviceRadiusMiles))) return res.status(400).json({ error: 'Complete your ZIP code, specialties, and service radius in Profile before subscribing.' });
  const price = resolvePriceForRole(role);
  const priceConfigError = stripePriceConfigError(price);
  if (priceConfigError) return res.status(500).json({ error: priceConfigError });

  try {
    const configuredPrice = await stripe.prices.retrieve(price);
    if (!configuredPrice.active || configuredPrice.unit_amount !== 9900 || configuredPrice.currency !== 'usd' || configuredPrice.recurring?.interval !== 'month' || configuredPrice.recurring?.interval_count !== 1) return res.status(503).json({ error: 'The $99 monthly plan needs configuration. Please contact support.' });
    const existing = await syncBillingFromStripe(await getBillingByUserIdAsync(userId));
    if (existing?.stripe_subscription_id && isSubscriptionActive(existing.subscription_status)) return res.status(409).json({ error: 'You already have an active subscription. Use Manage Billing.' });
    if (existing?.stripe_checkout_session_id) {
      const previous = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
      if (previous.status === 'open' && previous.url) return res.json({ ok: true, url: previous.url });
    }
    let customerId = existing?.stripe_customer_id || '';

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: String(email).trim().toLowerCase(),
        metadata: { userId: String(userId), role: String(role || 'mechanic') }
      }, { idempotencyKey: `customer:${userId}` });
      customerId = customer.id;
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${APP_URL}/mechanic.html?billing=success`,
      cancel_url: `${APP_URL}/mechanic.html?billing=cancel`,
      allow_promotion_codes: true,
      subscription_data: { metadata: { userId, role } },
      metadata: {
        userId: String(userId),
        role: String(role || 'mechanic')
      }
    }, { idempotencyKey: `checkout:${userId}:${Math.floor(Date.now() / 300000)}` });

    await upsertBillingByUserIdAsync(userId, {
      email: String(email).trim().toLowerCase(),
      role: String(role || 'mechanic'),
      stripe_customer_id: customerId,
      stripe_checkout_session_id: checkout.id
    });

    res.json({ ok: true, url: checkout.url });
  } catch (e) {
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

route('post', '/api/billing/create-portal-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe is not configured on the server.' });

  const user = await requireAuthenticatedUser(req, res, ['mechanic', 'shop']);
  if (!user) return;
  const userId = String(user.id || '');
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const billing = await getBillingByUserIdAsync(userId);
  if (!billing?.stripe_customer_id) return res.status(400).json({ error: 'No Stripe customer found for this account yet.' });

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${APP_URL}/mechanic.html`
    });
    res.json({ ok: true, url: portal.url });
  } catch (e) {
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

route('get','/api/admin/audit',async(req,res)=>{if(guardAdminApi(req,res))return;res.json({ok:true,events:await admins.recent()});});

route('get', '/api/admin/billing', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const rows = (await listBillingAccounts()).sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    const summary = {
      total: rows.length,
      active: rows.filter(r => isSubscriptionActive(r.subscription_status)).length,
      cancelled: rows.filter(r => String(r.subscription_status || '').toLowerCase() === 'canceled').length,
      pastDue: rows.filter(r => String(r.subscription_status || '').toLowerCase() === 'past_due').length
    };
    res.json({ ok: true, summary, stripeConfigured: !!stripe, billing: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load billing accounts.' });
  }
});

route('get', '/api/admin/repairs', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const status = req.query.status ? String(req.query.status).toLowerCase() : 'open';
    const repairs = await listRepairRequests({ status });
    const invites = await listInvites();

    const rows = await Promise.all((repairs || []).map(async (r) => {
      const rid = Number(r.id || r.Id);
      const assigned = invites
        .filter(i => Number(i.repair_id) === rid)
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      const bids = await listBids({ requestId: rid });
      return {
        ...r,
        admin: {
          totalInvites: assigned.length,
          activeInvites: assigned.filter(i => String(i.status || '').toLowerCase() === 'pending').length,
          submittedInvites: assigned.filter(i => String(i.status || '').toLowerCase() === 'submitted').length,
          bids: Array.isArray(bids) ? bids.length : 0,
          assigned: assigned.map(i => ({
            provider_email: i.provider_email,
            provider_type: i.provider_type,
            status: i.status,
            created_at: i.created_at,
            expires_at: i.expires_at,
            submitted_at: i.submitted_at,
            escalation_wave: i.escalation_wave || null
          }))
        }
      };
    }));

    res.json({ ok: true, repairs: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load admin repairs.' });
  }
});

route('post', '/api/admin/repairs/:id/remove', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const repairId = Number(req.params.id);
  if (!repairId) return res.status(400).json({ error: 'Invalid repair id.' });

  try {
    if (USE_SUPABASE) {
      await supabaseRequest(`repair_requests?id=eq.${repairId}`, { method: 'DELETE' });
      await supabaseRequest(`bids?request_id=eq.${repairId}`, { method: 'DELETE' });
      try { await supabaseRequest(`feedbacks?request_id=eq.${repairId}`, { method: 'DELETE' }); } catch {}
    } else {
      writeJson(REPAIR_REQUESTS_PATH, readJson(REPAIR_REQUESTS_PATH, []).filter(r => Number(r.id) !== repairId));
      writeJson(BIDS_PATH, readJson(BIDS_PATH, []).filter(b => Number(b.request_id) !== repairId));
      writeJson(FEEDBACKS_PATH, readJson(FEEDBACKS_PATH, []).filter(f => Number(f.request_id) !== repairId));
    }

    await removeInvitesForRepair(repairId);
    res.json({ ok: true, removedRepairId: repairId });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove repair.' });
  }
});

route('post', '/api/admin/billing/:userId/cancel', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });

  const billing = await getBillingByUserIdAsync(userId);
  if (!billing) return res.status(404).json({ error: 'Billing account not found for this user.' });

  if (!stripe) {
    const updated = await upsertBillingByUserIdAsync(userId, {
      subscription_status: 'canceled',
      cancel_at_period_end: true
    });
    return res.json({ ok: true, mockMode: true, billing: updated });
  }

  if (!billing?.stripe_subscription_id) return res.status(404).json({ error: 'Stripe subscription id not found for this user.' });

  try {
    const sub = await stripe.subscriptions.update(billing.stripe_subscription_id, { cancel_at_period_end: true });
    const updated = await upsertBillingByUserIdAsync(userId, {
      subscription_status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: subscriptionPeriodEnd(sub)
    });
    res.json({ ok: true, billing: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not schedule cancellation.' });
  }
});

route('post', '/api/admin/billing/:userId/reactivate', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });

  const billing = await getBillingByUserIdAsync(userId);
  if (!billing) return res.status(404).json({ error: 'Billing account not found for this user.' });

  if (!stripe) {
    const updated = await upsertBillingByUserIdAsync(userId, {
      subscription_status: 'active',
      cancel_at_period_end: false
    });
    return res.json({ ok: true, mockMode: true, billing: updated });
  }

  if (!billing?.stripe_subscription_id) return res.status(404).json({ error: 'Stripe subscription id not found for this user.' });

  try {
    const sub = await stripe.subscriptions.update(billing.stripe_subscription_id, { cancel_at_period_end: false });
    const updated = await upsertBillingByUserIdAsync(userId, {
      subscription_status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: subscriptionPeriodEnd(sub)
    });
    res.json({ ok: true, billing: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not reactivate subscription.' });
  }
});

route('post', '/api/admin/billing/:userId/manual-access', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const userId = String(req.params.userId || '').trim();
  const mode = String(req.body?.mode || '').toLowerCase(); // active|disabled|clear
  const reason = String(req.body?.reason || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required.' });
  if (!['active', 'disabled', 'clear'].includes(mode)) return res.status(400).json({ error: 'mode must be active, disabled, or clear.' });

  const existing = await getBillingByUserIdAsync(userId) || { user_id: userId };
  const updated = await upsertBillingByUserIdAsync(userId, {
    email: existing.email || '',
    role: existing.role || '',
    manual_access_override: mode === 'clear' ? null : mode,
    manual_access_reason: reason || existing.manual_access_reason || ''
  });

  res.json({ ok: true, billing: updated });
});

route('get', '/api/admin/accounts', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const [signups, authUsers, billing] = await Promise.all([listSignups(), listAuthUsers(), listBillingAccounts()]);
    const bans = await readBannedAccounts();

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
    res.status(500).json({ error: 'Could not load accounts' });
  }
});

route('post', '/api/admin/accounts/:email/ban', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const email = String(req.params.email || '').trim().toLowerCase();
  const reason = String(req.body?.reason || 'Admin action').trim();
  const category = String(req.body?.category || '').trim();
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const updated = await setBannedEmail(email, true, reason, category);
  res.json({ ok: true, ban: updated });
});

route('post', '/api/admin/accounts/:email/unban', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  const email = String(req.params.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const updated = await setBannedEmail(email, false);
  res.json({ ok: true, ban: updated });
});

route('get', '/provider/:id', async (req, res) => {
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
route('get', '/api/admin/ops', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const repairs = await listRepairRequests({});
    const bids = await listBids({});
    const invites = await listInvites();
    const reconciliation = await reconcileBidNotifications({ apply: false });
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
        totalInvites: invites.length,
        missingBidNotifications: reconciliation.missingBidNotifications
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load ops data' });
  }
});

route('post', '/api/admin/ops/reconcile-notifications', async (req, res) => {
  { const blocked = guardAdminApi(req, res); if (blocked) return; }
  try {
    const out = await reconcileBidNotifications({ apply: true });
    res.json({ ok: true, ...out });
  } catch {
    res.status(500).json({ error: 'Could not reconcile notifications.' });
  }
});

route('get','/admin',async(req,res)=>res.redirect('/admin-dashboard.html'));
route('get','/admin/ops',async(req,res)=>res.redirect('/admin-dashboard.html'));

registerPhotos({ route, requireUser: requireAuthenticatedUser, getRepair: getRepairById,
  canView: async (user, repair) => {
    const ownBids = await listBids({ requestId: Number(repair.id), mechanicId: String(user.id) });
    if (ownBids.length) return true; // Historical participants retain access without buying new leads.
    if (roleForUser(user) !== 'shop') return false;
    const verification = (await ops.list('provider_verifications', { user_id: user.id }))[0];
    if (!subscribedShop(verification, await getBillingByUserIdAsync(user.id), user.id)) return false;
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) return false;
    const invites = await listInvites({ repairId: Number(repair.id), providerEmail: email, providerType: 'shop', status: 'pending' });
    return repair.status === 'open' && !requestIsExpiredForNewInvites(repair) && invites.some(i => Date.parse(i.expires_at) > Date.now())
      && providerSupportsRepair({ zip: user.user_metadata?.zip, services: user.user_metadata?.services, serviceRadiusMiles: user.user_metadata?.serviceRadiusMiles }, repair);
  },
  metadata: photoMetadata({ database: USE_SUPABASE, request: supabaseRequest, directory: path.join(__dirname, '.local-data') }),
  objects: privatePhotoObjects
});

registerMessages({ route, requireUser: requireAuthenticatedUser, getBid: getBidById, getRepair: getRepairById,
  store: messageStore({ database: USE_SUPABASE, request: supabaseRequest, directory: path.join(__dirname, '.local-data') }) });

registerOperations({ route, store: ops, requireUser: requireAuthenticatedUser, guardAdmin: guardAdminApi, billingFor: getBillingByUserIdAsync, stripe, request: supabaseRequest });

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' });
  console.error('Request failed:', JSON.stringify(requestFailureSummary(req, error)));
  if (res.headersSent) return next(error);
  res.status(503).json({ error: 'Service temporarily unavailable. Please try again shortly.' });
});

if (process.env.NODE_ENV !== 'test') {
const billingWorkerConfig = reconciliationConfig(process.env);
if (BILLING_ENABLED && billingWorkerConfig.enabled) {
  if (!USE_SUPABASE || !stripe || !STRIPE_PRICE_SHOP_MONTHLY) throw new Error('Billing reconciliation requires Supabase and configured Stripe shop price');
  const workerStripe = new Stripe(STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 0 });
  const runBillingReconciliation = createBillingReconciler({
    config: billingWorkerConfig, priceId: STRIPE_PRICE_SHOP_MONTHLY,
    listDue: (limit, cutoff) => {
      const query = new URLSearchParams({ select: 'user_id,stripe_subscription_id,stripe_customer_id,updated_at',
        stripe_subscription_id: 'not.is.null', or: '(shop_plan_checked_at.is.null,shop_plan_checked_at.lt.' + cutoff + ')',
        and: '(or(subscription_status.is.null,subscription_status.not.in.(canceled,incomplete_expired)),or(billing_reconcile_after.is.null,billing_reconcile_after.lte.' + new Date().toISOString() + '))',
        order: 'billing_reconcile_after.asc.nullsfirst,shop_plan_checked_at.asc.nullsfirst,user_id.asc', limit: String(limit) });
      return supabaseRequest('billing_accounts?' + query);
    },
    retrieve: id => workerStripe.subscriptions.retrieve(id),
    save: (row, patch) => {
      // Compare-and-set prevents a delayed refresh overwriting a webhook or replaced subscription.
      const query = new URLSearchParams({ user_id: 'eq.' + row.user_id,
        stripe_subscription_id: 'eq.' + row.stripe_subscription_id, updated_at: 'eq.' + row.updated_at });
      return supabaseRequest('billing_accounts?' + query, { method: 'PATCH',
        body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    }
  });
  const tick = () => runBillingReconciliation().then(result => {
    if (!result.skipped) console.info('Billing reconciliation:', JSON.stringify(result));
  }).catch(error => console.error('Billing reconciliation unavailable:', error.name));
  const billingTimer = setInterval(tick, billingWorkerConfig.intervalMs);
  billingTimer.unref();
  void tick();
}
let dispatchRunning = false;
const dispatchTimer = setInterval(async () => {
  if (!BILLING_ENABLED || dispatchRunning || !USE_SUPABASE) return;
  dispatchRunning = true;
  try {
    const repairs = await supabaseRequest('repair_requests?select=*&status=eq.open');
    await refreshDispatch(repairs);
  } catch (error) { console.error('Dispatch retry needed:', error.name); }
  finally { dispatchRunning = false; }
}, 60000);
dispatchTimer.unref();
app.listen(PORT, () => {

  console.log(`Live: http://localhost:${PORT}`);
});
}

export { app, sanitizeRepairForUser, sanitizeBidForUser, stripTaggedJson, parseTaggedJson };

