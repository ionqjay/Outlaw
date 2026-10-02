import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { withinServiceArea, trustedRole, subscriptionPeriodEnd } from '../lib/matching.js';
import { operationsStore, registerOperations } from '../lib/operations.js';

test('geographic matching includes nearby ZIPs and excludes distant or incomplete profiles', () => {
  const provider = { zip: '10522', serviceRadiusMiles: 25 };
  assert.equal(withinServiceArea(provider, { zip: '10701' }), true);
  assert.equal(withinServiceArea(provider, { zip: '90210' }), false);
  assert.equal(withinServiceArea({ ...provider, zip: '' }, { zip: '10701' }), false);
  assert.equal(withinServiceArea({ ...provider, serviceRadiusMiles: 1000 }, { zip: '10701' }), false);
});

test('user-editable metadata cannot create an admin role', () => {
  assert.equal(trustedRole({ user_metadata: { role: 'admin' } }), '');
  assert.equal(trustedRole({ app_metadata: { role: 'owner' }, user_metadata: { role: 'admin' } }), 'owner');
  assert.equal(trustedRole({ app_metadata: { role: 'admin' } }), 'admin');
});

test('billing understands both legacy and item-level Stripe period ends', () => {
  assert.equal(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }), subscriptionPeriodEnd({ current_period_end: 1800000000 }));
  assert.equal(subscriptionPeriodEnd({}), null);
});

test('database outages never silently store operational data in local files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-fail-'));
  const store = operationsStore({ database: true, directory, request: async () => { throw new Error('Database offline'); } });
  await assert.rejects(store.save('notifications', { event_key: 'one' }), /Database offline/);
  assert.deepEqual(fs.readdirSync(directory), []);
  fs.rmSync(directory, { recursive: true });
});

async function withOperations(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-ops-'));
  const store = operationsStore({ database: false, directory });
  const app = express(); app.use(express.json());
  const invoices = new Map(); let refundsCreated = 0; const invoiceListCalls = [];
  const stripe = {
    invoices: {
      retrieve: async id => invoices.get(id),
      list: async params => {
        invoiceListCalls.push(params);
        return { data: [...invoices.values()].filter(invoice => invoice.customer === params.customer && invoice.status === params.status).slice(0, params.limit) };
      }
    },
    refunds: { create: async () => { refundsCreated++; return { id: 're_one', status: 'succeeded' }; }, retrieve: async () => ({ id: 're_one', status: 'succeeded' }) }
  };
  registerOperations({
    route: (method, routePath, handler) => app[method](routePath, (req,res,next) => Promise.resolve(handler(req,res)).catch(next)), store, stripe,
    requireUser: async (req, res) => { const id = req.headers['x-test-user']; if (!id) { res.status(401).json({ error: 'Auth required' }); return null; } return { id, email: `${id}@example.com` }; },
    guardAdmin: (req,res) => req.headers['x-test-admin'] === 'yes' ? null : res.status(401).json({ error: 'Unauthorized' }),
    billingFor: async () => ({ stripe_customer_id: 'cus_owner', stripe_subscription_id: 'sub_owner' })
  });
  app.use((error,req,res,next) => res.status(500).json({ error: error.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (url, body, user='alice', admin=false) => fetch(base+url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', 'x-test-user':user, ...(admin ? {'x-test-admin':'yes'}:{}) }, body: body ? JSON.stringify(body) : undefined });
  try { await fn({ store, call, invoices, invoiceListCalls, refundsCreated: () => refundsCreated }); }
  finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true }); }
}

test('notifications are private to their recipient and events are idempotent', () => withOperations(async ({store,call}) => {
  const record = { user_id:'alice', event_key:'bid:1', title:'Estimate', body:'New quote', href:'/owner-app.html' };
  await store.save('notifications',record,'event_key',true);
  await store.save('notifications',record,'event_key',true);
  assert.equal((await store.list('notifications')).length,1);
  const list = await (await call('/api/notifications',null,'bob')).json();
  assert.equal(list.notifications.length,0);
  assert.equal((await call('/api/notifications/1/read',{},'bob')).status,404);
  assert.equal((await call('/api/notifications/1/read',{},'alice')).status,200);
}));

test('provider review cannot be self-approved and reviewed status survives reload', () => withOperations(async ({store,call}) => {
  await call('/api/provider/verification',{business_name:'Example Garage',license_reference:'TEST',insurance_reference:'TEST',status:'approved'});
  assert.equal((await store.list('provider_verifications'))[0].status,'pending');
  assert.equal((await call('/api/admin/verification/alice',{status:'approved',note:'Checked supporting evidence'})).status,401);
  assert.equal((await call('/api/admin/verification/alice',{status:'approved',note:'Checked supporting evidence'},'admin',true)).status,200);
  assert.equal((await (await call('/api/provider/verification')).json()).verification.status,'approved');
}));

test('refund requests reject other customers and duplicate requests preserve review state', () => withOperations(async ({store,call,invoices}) => {
  const invoice = { id:'in_one', customer:'cus_wrong', subscription:'sub_owner', status:'paid', amount_paid:9900, currency:'usd', lines:{data:[{type:'subscription',period:{start:1700000000,end:1702600000}}]} };
  invoices.set('in_one',invoice);
  assert.equal((await call('/api/billing/refund-requests',{invoiceId:'in_one'})).status,404);
  invoice.customer='cus_owner';
  assert.equal((await call('/api/billing/refund-requests',{invoiceId:'in_one'})).status,200);
  const row=(await store.list('refund_requests'))[0];
  await store.save('refund_requests',{...row,status:'approved'});
  const retry=await (await call('/api/billing/refund-requests',{invoiceId:'in_one'})).json();
  assert.equal(retry.request.status,'approved');
}));

test('billing invoice list is scoped to the current Stripe customer and subscription', () => withOperations(async ({call,invoices,invoiceListCalls}) => {
  invoices.set('in_owner', { id:'in_owner', customer:'cus_owner', subscription:'sub_owner', status:'paid', amount_paid:9900, currency:'usd', created:1702700000, lines:{data:[{type:'subscription',period:{start:1700000000,end:1702600000}}]} });
  invoices.set('in_other_customer', { id:'in_other_customer', customer:'cus_wrong', subscription:'sub_owner', status:'paid', amount_paid:9900, currency:'usd', created:1702700000, lines:{data:[{type:'subscription',period:{start:1700000000,end:1702600000}}]} });
  invoices.set('in_other_subscription', { id:'in_other_subscription', customer:'cus_owner', subscription:'sub_other', status:'paid', amount_paid:9900, currency:'usd', created:1702700000, lines:{data:[{type:'subscription',period:{start:1700000000,end:1702600000}}]} });
  const data = await (await call('/api/billing/invoices')).json();
  assert.deepEqual(data.invoices.map(invoice => invoice.id), ['in_owner']);
  assert.deepEqual(invoiceListCalls[0], { customer:'cus_owner', status:'paid', limit:24 });
}));

test('refund processing requires review and cannot refund twice', () => withOperations(async ({store,call,invoices,refundsCreated}) => {
  const row=await store.save('refund_requests',{user_id:'alice',invoice_id:'in_one',amount_paid:9900,status:'pending'},'invoice_id');
  invoices.set('in_one',{payments:{data:[{status:'paid',payment:{payment_intent:'pi_one'}}]}});
  assert.equal((await call(`/api/admin/refund/${row.id}/process`,{},'admin',true)).status,409);
  await store.save('refund_requests',{...row,status:'approved'});
  assert.equal((await call(`/api/admin/refund/${row.id}/process`,{},'admin',true)).status,200);
  assert.equal((await call(`/api/admin/refund/${row.id}/process`,{},'admin',true)).status,200);
  assert.equal(refundsCreated(),1);
}));

test('submitted Stripe refunds cannot be re-reviewed while the refund is pending', () => withOperations(async ({store,call,invoices}) => {
  const row=await store.save('refund_requests',{user_id:'alice',invoice_id:'in_one',amount_paid:9900,status:'approved'},'invoice_id');
  invoices.set('in_one',{payments:{data:[{status:'paid',payment:{payment_intent:'pi_one'}}]}});
  assert.equal((await call(`/api/admin/refund/${row.id}/process`,{},'admin',true)).status,200);
  const stored=(await store.list('refund_requests'))[0];
  assert.equal(stored.stripe_refund_id,'re_one');
  assert.equal((await call(`/api/admin/refund/${row.id}/review`,{status:'rejected',note:'Changed after Stripe submit'},'admin',true)).status,400);
}));

test('refund form submits the selected billing month instead of manual invoice entry', async () => {
  const dom = new JSDOM('<form id="refundForm"><select id="refundInvoiceSelect" name="invoiceId"></select><button>Request review</button><p id="refundStatus"></p></form>', { url:'https://www.shopmyrepair.com', runScripts:'outside-only' });
  const calls = [];
  dom.window.APP_CONFIG = { API_BASE: '' };
  dom.window.smrAuth = { getAuthHeaders: async () => ({}), getActiveSession: async () => ({ id:'alice' }) };
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body });
    if (String(url).endsWith('/api/billing/invoices')) return new Response(JSON.stringify({ ok:true, invoices:[{ id:'in_one', amount_paid:9900, currency:'usd', period_start:'2023-11-14T00:00:00.000Z', period_end:'2023-12-14T00:00:00.000Z' }] }), { status:200, headers:{ 'Content-Type':'application/json' } });
    return new Response(JSON.stringify({ ok:true, request:{ id:7, status:'pending' } }), { status:200, headers:{ 'Content-Type':'application/json' } });
  };
  dom.window.eval(fs.readFileSync(new URL('../public/operations-ui.js', import.meta.url), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector('#refundInvoiceSelect').value, 'in_one');
  dom.window.document.querySelector('#refundForm').dispatchEvent(new dom.window.Event('submit', { bubbles:true, cancelable:true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(calls.find(call => String(call.url).endsWith('/api/billing/refund-requests')).body).invoiceId, 'in_one');
  assert.match(dom.window.document.querySelector('#refundStatus').textContent, /Request #7/);
  dom.window.close();
});

test('HTML sanitizer removes stored executable markup and preserves quote controls', () => {
  const dom = new JSDOM(''); const purify=createDOMPurify(dom.window);
  const html=purify.sanitize('<img src=x onerror="alert(1)"><script>alert(1)</script><button data-bid="3">Choose</button>');
  assert.doesNotMatch(html,/onerror|<script/);
  assert.match(html,/data-bid="3"/);dom.window.close();
});

test('homepage quote CTA enters the actual owner flow and mobile menu opens with ARIA state', () => {
  const dom=new JSDOM(fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://www.shopmyrepair.com',runScripts:'outside-only'});
  const {document}=dom.window;
  const links=[...document.querySelectorAll('a')].filter(a=>a.textContent==='Get Repair Quotes');
  assert.ok(links.length>=2);assert.ok(links.every(a=>a.href.includes('next=%2Fowner-app.html%3Fview%3Dquote')));
  assert.equal(document.querySelector('#modal'),null);
  dom.window.eval(fs.readFileSync(new URL('../public/navigation.js',import.meta.url),'utf8'));
  const toggle=document.querySelector('.menu-toggle');toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(toggle.getAttribute('aria-expanded'),'false');dom.window.close();
});
