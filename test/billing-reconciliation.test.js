import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingReconciler, reconciliationConfig } from '../lib/billing-reconciliation.js';
import { subscribedShop } from '../lib/shop-eligibility.js';
const now=1800000000000;
const row={user_id:'shop',stripe_subscription_id:'sub_test',stripe_customer_id:'cus_test'};
const subscription=()=>({id:'sub_test',customer:'cus_test',status:'active',current_period_end:now/1000+86400,items:{data:[{quantity:1,price:{id:'price_shop',currency:'usd',unit_amount:9900,recurring:{interval:'month',interval_count:1}}}]}});
const config=reconciliationConfig({BILLING_RECONCILIATION_ENABLED:'true'});
const verification={user_id:'shop',status:'approved',business_type:'registered_shop'};
test('billing worker is disabled by default and rejects unbounded settings',async()=>{
 assert.equal(reconciliationConfig().enabled,false);
 for(const values of [{BILLING_RECONCILIATION_BATCH_SIZE:'21'},{BILLING_RECONCILIATION_INTERVAL_MINUTES:'0'},{BILLING_RECONCILIATION_BATCH_SIZE:'NaN'}]) assert.throws(()=>reconciliationConfig(values));
 const run=createBillingReconciler({config:reconciliationConfig(),listDue:()=>{throw Error('must not run')}});
 assert.deepEqual(await run(),{skipped:true});
});
test('bounded refresh restores active exact-plan access and revokes invalid plans/statuses',async()=>{
 for(const mutate of [s=>s,s=>{s.items.data[0].price.id='price_wrong'},s=>{s.status='canceled'},s=>{s.status='past_due'},s=>{s.customer='cus_other'}]){
  let saved;const sub=subscription();mutate(sub);
  const run=createBillingReconciler({config,priceId:'price_shop',clock:()=>now,listDue:async(limit,cutoff)=>{assert.equal(limit,10);assert.equal(Date.parse(cutoff),now-21600000);return [row]},retrieve:async()=>sub,save:async(r,p)=>{assert.equal(r,row);saved=p}});
  await run();
  assert.equal(subscribedShop(verification,{...row,...saved},'shop',now),sub.status==='active'&&sub.customer==='cus_test'&&sub.items.data[0].price.id==='price_shop');
 }
});
test('failed retrieval invalidates cache; rate limits stop batch and honor Retry-After',async()=>{
 let current=now,calls=0,patch;
 const run=createBillingReconciler({config,priceId:'price_shop',clock:()=>current,listDue:async()=>[row,row],retrieve:async()=>{calls++;throw Object.assign(Error('throttled'),{statusCode:429,headers:{'retry-after':'3600'}})},save:async(r,p)=>{patch=p}});
 assert.equal((await run()).rateLimited,true);assert.equal(calls,1);assert.equal(patch.shop_plan_valid,false);assert.equal(patch.shop_plan_checked_at,null);assert.equal(Date.parse(patch.billing_reconcile_after),now+3600000);
 current+=1800000;assert.deepEqual(await run(),{skipped:true});assert.equal(calls,1);
 current+=1800001;await run();assert.equal(calls,2);
});
test('overlap is skipped, batches are capped, persistence errors release worker lock',async()=>{
 let release;const wait=new Promise(resolve=>{release=resolve});let saved=0;
 const run=createBillingReconciler({config:{...config,batchSize:1},priceId:'price_shop',clock:()=>now,listDue:async()=>[row,row],retrieve:async()=>{await wait;return subscription()},save:async()=>{saved++}});
 const first=run();assert.deepEqual(await run(),{skipped:true});release();await first;assert.equal(saved,1);
 const fail=createBillingReconciler({config,priceId:'price_shop',clock:()=>now,listDue:async()=>[row],retrieve:async()=>subscription(),save:async()=>{throw Error('database unavailable')}});
 await assert.rejects(fail(),/database unavailable/);await assert.rejects(fail(),/database unavailable/);
});
