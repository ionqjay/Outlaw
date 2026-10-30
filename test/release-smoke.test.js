import test from 'node:test';
import assert from 'node:assert/strict';
import { smoke, targetOrigin } from '../scripts/release-smoke.mjs';
const good = { ok: true, databaseReady: true, billingMode: 'disabled', newQuotesAvailable: false };
function response(body = good, status = 200, cache = 'private, no-store') {
  return new Response(JSON.stringify(body), { status, headers: { 'cache-control': cache } });
}
test('requires explicit safe origin without credentials or paths', () => {
  for (const value of [undefined, 'http://example.com', 'https://u:p@example.com', 'https://example.com/api', 'https://example.com?token=x', 'https://example.com#x']) assert.throws(() => targetOrigin(value));
  assert.equal(targetOrigin('http://127.0.0.1:3418'), 'http://127.0.0.1:3418');
});
test('only three unauthenticated GETs; no redirects/retries and bounded timeout', async () => {
  const calls = [];
  const result = await smoke('https://example.com', { fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: 'application/json' }); return response();
  }});
  assert.equal(result.pass, true);
  assert.deepEqual(calls, ['/api/health', '/API/HEALTH', '/api/availability'].map(p => 'https://example.com' + p));
});
test('fails closed for status, cache and billing contract mismatches', async () => {
  for (const factory of [() => response(good, 503), () => response(good, 200, 'public'), () => response({...good, billingMode: 'enabled'}), () => response({...good, databaseReady: false}), () => response({...good, newQuotesAvailable: true})]) {
    assert.equal((await smoke('https://example.com', {fetchImpl: async () => factory()})).pass, false);
  }
});
test('network or invalid JSON errors are generic and never leak response contents', async () => {
  for (const factory of [() => { throw new Error('SECRET'); }, () => new Response('SECRET')]) {
    const result = await smoke('https://example.com', {fetchImpl: async () => factory()});
    assert.equal(result.pass, false); assert.equal(result.results.length, 3);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
