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

test('hung probe times out, aborts and never accumulates duplicates even beyond TTL', async () => {
  let now=0, calls=0, signal, release;
  const check=singleFlightProbe(s=>{calls++;signal=s;return new Promise(resolve=>{release=resolve;});},{timeoutMs:20,clock:()=>now});
  const first=check(); assert.equal(check(),first);
  assert.equal(await first,false); assert.equal(signal.aborted,true);
  now=10000;
  assert.equal(await check(),false); assert.equal(calls,1);
  release(true); await new Promise(resolve=>setImmediate(resolve));
  // A late success cannot replace the timeout result. Expired cache permits new work.
  const next=check(); await Promise.resolve();assert.equal(calls,2);
  release(true); assert.equal(await next,true);
});
test('abort rejection is consumed and recovery occurs after failure TTL', async () => {
  let now=0, calls=0;
  const check=singleFlightProbe(signal=>{calls++;if(calls>1)return true;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('private')),{once:true}));},{timeoutMs:20,clock:()=>now});
  assert.equal(await check(),false);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await check(),false);assert.equal(calls,1);
  now=5000;assert.equal(await check(),true);assert.equal(calls,2);
});
test('late successful settlement stays false within timeout cache window',async()=>{
  let finish;
  const check=singleFlightProbe(()=>new Promise(resolve=>{finish=resolve;}),{timeoutMs:10});
  assert.equal(await check(),false);finish(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await check(),false);
});
