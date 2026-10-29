import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlightProbe } from '../lib/health-probe.js';
test('health requests share in-flight work and cache only for five seconds', async () => {
  let now = 0, calls = 0, finish;
  const check = singleFlightProbe(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { clock: () => now });
  const first = check(), second = check();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  finish(true); assert.equal(await first, true);
  now = 4999; assert.equal(await check(), true); assert.equal(calls, 1);
  now = 5000; const fresh = check(); await Promise.resolve(); assert.equal(calls, 2);
  finish(false); assert.equal(await fresh, false);
  assert.equal(await check(), false); assert.equal(calls, 2);
});
test('failed health probes fail closed and recover after TTL, including synchronous throws', async () => {
  let now = 0, fail = true, calls = 0;
  const check = singleFlightProbe(() => { calls++; if (fail) throw Error('private dependency detail'); return true; }, { clock: () => now });
  assert.equal(await check(), false); fail = false;
  assert.equal(await check(), false); assert.equal(calls, 1);
  now = 5000; assert.equal(await check(), true); assert.equal(calls, 2);
});
