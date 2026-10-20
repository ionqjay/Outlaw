import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedShop, subscribedShop } from '../lib/shop-eligibility.js';
const v = { user_id: 'shop', status: 'approved', business_type: 'registered_shop' };
const b = { user_id: 'shop', subscription_status: 'active', stripe_subscription_id: 'sub_test', current_period_end: '2030-01-01T00:00:00Z' };
test('only explicit registered-business review grants approval', () => {
  assert.equal(approvedShop(v, 'shop'), true);
  for (const record of [null, { ...v, status:'pending' }, { ...v, status:'rejected' }, { ...v, business_type:null }, { ...v, user_id:'other' }]) assert.equal(approvedShop(record, 'shop'), false);
});
test('new leads require active paid period; trials, overrides and expired cache fail closed', () => {
  assert.equal(subscribedShop(v,b,'shop'),true);
  for (const patch of [{subscription_status:'trialing'}, {subscription_status:'past_due'}, {subscription_status:'canceled'}, {subscription_status:'none',manual_access_override:'active'}, {current_period_end:null}, {current_period_end:'2020-01-01'}, {stripe_subscription_id:''}, {user_id:'other'}, {manual_access_override:'disabled'}]) assert.equal(subscribedShop(v,{...b,...patch},'shop'),false);
});

import fs from 'node:fs';
import vm from 'node:vm';
test('local quote writer caps concurrent submissions at three including legacy declined quotes', async () => {
  const source = fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  let rows = [{id:1,request_id:7,mechanic_id:'legacy',status:'declined',notes:'untagged legacy quote'}];
  const ctx = vm.createContext({ USE_SUPABASE:false, BIDS_PATH:'unused', readJson:()=>rows, writeJson:(_p,r)=>{rows=r;} });
  vm.runInContext(source.slice(source.indexOf('async function createBid('),source.indexOf('async function listBids(')),ctx);
  const results = await Promise.allSettled([1,2,3,4].map(id=>ctx.createBid({request_id:7,mechanic_id:'shop'+id,status:'open'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(rows.length,3);
  await assert.rejects(ctx.createBid({request_id:7,mechanic_id:'shop1'}));
});
test('production RPC locks the repair and counts all quotes without trusting notes', () => {
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261020170000_registered_shops_only.sql',import.meta.url),'utf8');
  assert.match(sql,/for update/);
  assert.ok(sql.includes('count(*) from public.bids where request_id=r.id)>=3'));
  assert.match(sql,/v.business_type='registered_shop'/);
  assert.match(sql,/revoke execute on function public.create_marketplace_bid/);
  assert.doesNotMatch(sql,/notes like/);
});
