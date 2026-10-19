import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { rankInviteCandidates, initialInviteCandidates, createDispatchQueue, FAIRNESS_WINDOW_MS } from '../lib/invite-ranking.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const provider = (id, type = 'shop', extra = {}) => ({ email: `${id}@example.test`, providerType: type, can_submit_estimates: true, services: 'brakes', distanceMiles: 10, serviceRadiusMiles: 25, ...extra });
const repair = (id = 1, extra = {}) => ({ id, status: 'open', issue_category: 'brakes', urgency: 'standard', created_at: new Date(now).toISOString(), ...extra });
const invite = (p, id, extra = {}) => ({ repair_id: id, provider_email: p.email, provider_type: p.providerType, status: 'pending', created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 7200000).toISOString(), ...extra });
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing server section: ${start}`);
  return source.slice(from, to);
}

// Executes the real server dispatch/read functions with controlled persistence
// and geography. No network, production accounts, Stripe, or real DB writes.
function harness(pool, initial = [], repairs = [repair()], hosted = false) {
  let clock = now;
  const rows = structuredClone(initial);
  let bids = [];
  const context = vm.createContext({
    console, rankInviteCandidates, initialInviteCandidates,
    runDispatchExclusive: createDispatchQueue(),
    Date: class extends Date { static now() { return clock; } },
    STANDARD_INVITE_WINDOW_MS: 7200000, URGENT_INVITE_WINDOW_MS: 2700000,
    MAX_REQUEST_AGE_MS: 86400000, ESCALATION_WAVE_2_MS: 5400000,
    ESCALATION_WAVE_3_MS: 10800000, ESCALATION_MIN_BIDS: 2,
    USE_SUPABASE: hosted, REPAIR_REQUESTS_PATH: 'repairs',
    readJson: () => structuredClone(repairs),
    supabaseRequest: async () => structuredClone(repairs),
    withinServiceArea: (p) => p.distanceMiles <= p.serviceRadiusMiles,
    providerDistanceMiles: p => p.distanceMiles,
    listProviderPool: async () => pool,
    listInvites: async ({ providerEmail, repairId } = {}) => structuredClone(rows.filter(i => (!providerEmail || i.provider_email === providerEmail) && (!repairId || i.repair_id === repairId))),
    appendInvites: async additions => {
      const inserted = additions.filter(a => !rows.some(i => i.repair_id === a.repair_id && i.provider_email === a.provider_email && i.provider_type === a.provider_type));
      rows.push(...structuredClone(inserted));
      return structuredClone(inserted);
    },
    updateInvite: async (inv, patch) => Object.assign(rows.find(i => i.repair_id === inv.repair_id && i.provider_email === inv.provider_email), patch),
    listBids: async () => bids,
  });
  vm.runInContext(section('function normalizeProviderType(', 'function readInvites(')
    + section('function eligibleRankedProviders(', 'async function attachOwnerDispatchSummary(')
    + section('async function listRepairRequests(', 'async function createBid('), context);
  return { context, rows, advance: ms => { clock += ms; }, setBids: value => { bids = value; } };
}

test('fairness beats distance and response history when opportunity counts differ', () => {
  const busy = provider('busy', 'shop', { distanceMiles: 1 });
  const fresh = provider('fresh', 'shop', { distanceMiles: 24 });
  assert.equal(rankInviteCandidates([busy, fresh], [invite(busy, 80, { status: 'submitted' })], repair(), now)[0].email, fresh.email);
});

test('response history and proximity break equal opportunity counts; newcomers get neutral history', () => {
  const responsive = provider('responsive');
  const ignored = provider('ignored');
  const history = [invite(responsive, 80, { status: 'submitted' }), invite(ignored, 81, { status: 'expired' })];
  assert.equal(rankInviteCandidates([ignored, responsive], history, repair(), now)[0].email, responsive.email);
  const near = provider('near', 'shop', { distanceMiles: 2 });
  assert.equal(rankInviteCandidates([responsive, near], [], repair(), now)[0].email, near.email);
});

test('ranking is independent of input order and counts duplicate opportunity rows once', () => {
  const a = provider('a'); const b = provider('b');
  const single = invite(a, 5);
  assert.deepEqual(rankInviteCandidates([a, b], [single, single], repair(), now), rankInviteCandidates([b, a], [single], repair(), now));
  assert.deepEqual(rankInviteCandidates([a, b], [], repair(), now), rankInviteCandidates([b, a], [], repair(), now));
});

test('old, future, and malformed dates do not skew the seven-day rotation', () => {
  const a = provider('a'); const b = provider('b');
  const history = [invite(a, 1, { created_at: new Date(now - FAIRNESS_WINDOW_MS - 1).toISOString() }), invite(a, 2, { created_at: 'bad' }), invite(a, 3, { created_at: new Date(now + 1).toISOString() })];
  assert.deepEqual(rankInviteCandidates([a, b], history, repair(), now), rankInviteCandidates([a, b], [], repair(), now));
});

test('100 equally eligible shops rotate across 100 initial requests', () => {
  const pool = Array.from({ length: 100 }, (_, i) => provider(i));
  const history = [];
  for (let id = 1; id <= 100; id++) {
    const selected = initialInviteCandidates(rankInviteCandidates(pool, history, repair(id), now));
    assert.equal(selected.length, 3);
    history.push(...selected.map(p => invite(p, id)));
  }
  const counts = pool.map(p => history.filter(i => i.provider_email === p.email).length);
  assert.equal(Math.min(...counts), 3);
  assert.equal(Math.max(...counts), 3);
});

test('initial invites select shops only and do not fill with mechanics', () => {
  const shops = Array.from({ length: 8 }, (_, i) => provider(i));
  const mechanics = Array.from({ length: 8 }, (_, i) => provider(`m${i}`, 'mechanic'));
  assert.equal(initialInviteCandidates(shops).length, 3);
  assert.equal(initialInviteCandidates(mechanics).length, 0);
  assert.equal(initialInviteCandidates([...shops, ...mechanics]).length, 3);
  assert.ok(initialInviteCandidates([...shops, ...mechanics]).every(p => p.providerType === 'shop'));
});

test('real dispatch filters service, distance, access, and mechanics before picking 3 shops', async () => {
  const pool = [provider('unpaid', 'shop', { can_submit_estimates: false }), provider('far', 'shop', { distanceMiles: 100 }), provider('wrong-service', 'shop', { services: 'tires' }), ...Array.from({ length: 10 }, (_, i) => provider(i)), ...Array.from({ length: 5 }, (_, i) => provider(`m${i}`, 'mechanic'))];
  const h = harness(pool);
  await h.context.createDispatchSnapshot(repair());
  assert.equal(h.rows.length, 3);
  assert.equal(h.rows.filter(i => i.provider_type === 'shop').length, 3);
  assert.equal(h.rows.filter(i => i.provider_type === 'mechanic').length, 0);
  assert.ok(h.rows.every(i => !/unpaid|far|wrong-service/.test(i.provider_email)));
});

for (const hosted of [false, true]) {
  test(`dashboard reads cannot add invitations for the viewing provider (${hosted ? 'hosted' : 'local'})`, async () => {
    const pool = Array.from({ length: 10 }, (_, i) => provider(i));
    const h = harness(pool, [], [repair()], hosted);
    await h.context.createDispatchSnapshot(repair());
    const outsider = pool.find(p => !h.rows.some(i => i.provider_email === p.email));
    for (let i = 0; i < 3; i++) {
      const visible = await h.context.listRepairRequests({ providerEmail: outsider.email, previewLeads: false });
      assert.equal(visible.length, 0);
    }
    assert.equal(h.rows.length, 3);
  });
}

test('simultaneous same-request dispatch is idempotent and concurrent jobs rotate', async () => {
  const pool = Array.from({ length: 10 }, (_, i) => provider(i));
  const h = harness(pool);
  await Promise.all(Array.from({ length: 8 }, () => h.context.createDispatchSnapshot(repair())));
  assert.equal(h.rows.length, 3);
  await Promise.all([h.context.createDispatchSnapshot(repair(2)), h.context.createDispatchSnapshot(repair(3))]);
  assert.equal(new Set(h.rows.map(i => i.provider_email)).size, 9);
});

test('simultaneously expired invitations get distinct fair replacements of the same type', async () => {
  const pool = Array.from({ length: 12 }, (_, i) => provider(i));
  const history = pool.slice(0, 3).map(p => invite(p, 1, { expires_at: new Date(now - 1).toISOString() }));
  const h = harness(pool, history);
  await h.context.processInviteExpirations([repair()]);
  const replacements = h.rows.filter(i => i.replaced_from);
  assert.equal(replacements.length, 3);
  assert.equal(new Set(replacements.map(i => i.provider_email)).size, 3);
  assert.ok(replacements.every(i => i.provider_type === 'shop'));
});

test('escalation retains 90m/3h waves, uses uninvited candidates, and does not repeat waves', async () => {
  const pool = Array.from({ length: 30 }, (_, i) => provider(i));
  const h = harness(pool);
  await h.context.createDispatchSnapshot(repair());
  h.advance(90 * 60000);
  await h.context.processInviteEscalations([repair()]);
  await h.context.processInviteEscalations([repair()]);
  assert.equal(h.rows.filter(i => i.escalation_wave === 2).length, 5);
  h.advance(90 * 60000);
  await h.context.processInviteEscalations([repair()]);
  assert.equal(h.rows.filter(i => i.escalation_wave === 3).length, 8);
  assert.equal(new Set(h.rows.map(i => i.provider_email)).size, h.rows.length);
});

test('two quotes stop escalation and closed or old requests receive no initial invitations', async () => {
  const h = harness(Array.from({ length: 15 }, (_, i) => provider(i)));
  await h.context.createDispatchSnapshot(repair(2, { status: 'closed' }));
  await h.context.createDispatchSnapshot(repair(3, { created_at: new Date(now - 86400001).toISOString() }));
  assert.equal(h.rows.length, 0);
  await h.context.createDispatchSnapshot(repair());
  h.advance(90 * 60000);
  h.setBids([{ status: 'open' }, { status: 'open' }]);
  await h.context.processInviteEscalations([repair()]);
  assert.equal(h.rows.length, 3);
});

test('unassigned requests recover through the common dispatcher when providers become available', async () => {
  const pool = [];
  const h = harness(pool);
  await h.context.refreshDispatch([repair()]);
  assert.equal(h.rows.length, 0);
  pool.push(...Array.from({ length: 6 }, (_, i) => provider(i)));
  await h.context.refreshDispatch([repair()]);
  await h.context.refreshDispatch([repair()]);
  assert.equal(h.rows.length, 3);
});

test('queue recovers after errors', async () => {
  const queue = createDispatchQueue();
  await assert.rejects(queue(async () => { throw new Error('offline'); }));
  assert.equal(await queue(async () => 'recovered'), 'recovered');
});

test('invitation history pagination does not truncate at the API row limit', async () => {
  const offsets = [];
  const ctx = vm.createContext({ USE_SUPABASE: true, encodeURIComponent, supabaseRequest: async path => {
    const offset = Number(new URL(`https://example.test/${path}`).searchParams.get('offset'));
    offsets.push(offset);
    return Array.from({ length: Math.min(500, Math.max(0, 1250 - offset)) }, (_, i) => ({ id: offset + i }));
  } });
  vm.runInContext(section('async function listInvites(', 'async function replaceInvitesForRepair('), ctx);
  assert.equal((await ctx.listInvites()).length, 1250);
  assert.deepEqual(offsets, [0, 500, 1000, 1250]);
});

test('banned providers cannot re-enter through the billing-account fallback', async () => {
  const ctx = vm.createContext({
    listAuthUsers: async () => [{ id: 'banned', email: 'banned@example.test', user_metadata: { role: 'shop' } }],
    trustedRole: u => u.user_metadata.role,
    isBannedEmail: async email => email === 'banned@example.test',
    getBillingByUserIdAsync: async () => ({ subscription_status: 'active' }),
    canSubmitEstimatesFromBilling: () => true,
    listBillingAccounts: async () => [
      { user_id: 'banned', email: 'banned@example.test', role: 'shop' },
      { user_id: 'allowed', email: 'allowed@example.test', role: 'shop' },
    ],
    listSignups: async () => [],
  });
  vm.runInContext(section('async function listProviderPool(', 'function eligibleRankedProviders('), ctx);
  const pool = await ctx.listProviderPool();
  assert.equal(pool.length, 1);
  assert.equal(pool[0].email, 'allowed@example.test');
});
