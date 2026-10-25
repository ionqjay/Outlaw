import test from 'node:test';
import assert from 'node:assert/strict';
import { attestShopPlan } from '../lib/stripe-entitlement.js';
import { subscribedShop } from '../lib/shop-eligibility.js';
const make=()=>({items:{has_more:false,data:[{quantity:1,price:{id:'price_shop',currency:'usd',unit_amount:9900,recurring:{interval:'month',interval_count:1}}}]}});
test('attest exact single-item $99 monthly shop plan from retrieved subscription',()=>{
  assert.equal(attestShopPlan(make(),'price_shop').shop_plan_valid,true);
  for(const mutate of [s=>s.items.data[0].quantity=2,s=>s.items.data[0].price.id='price_legacy',s=>s.items.data[0].price.unit_amount=100,s=>s.items.data[0].price.currency='cad',s=>s.items.data[0].price.recurring.interval='year',s=>s.items.data[0].price.recurring.interval_count=2,s=>s.items.data.push(s.items.data[0]),s=>s.items.has_more=true,s=>s.items.data[0].price='price_shop']) {
    const s=make();mutate(s);const result=attestShopPlan(s,'price_shop');assert.equal(result.shop_plan_valid,false);assert.equal(result.shop_plan_price_id,null);
  }
  assert.equal(attestShopPlan(make(),'').shop_plan_valid,false);
  assert.equal(attestShopPlan({items:{data:[null]}},'price_shop').shop_plan_valid,false);
  assert.equal(attestShopPlan({items:{data:[{quantity:1,price:null}]}},'price_shop').shop_plan_valid,false);
});
test('portal plan changes replace eligibility and stale/missing attestations fail closed',()=>{
 const now=Date.now(),v={user_id:'shop',status:'approved',business_type:'registered_shop'};
 const b={user_id:'shop',subscription_status:'active',stripe_subscription_id:'sub_test',current_period_end:new Date(now+86400000).toISOString(),...attestShopPlan(make(),'price_shop',now)};
 assert.equal(subscribedShop(v,b,'shop',now),true);
 for(const patch of [{shop_plan_valid:false},{shop_plan_price_id:null},{shop_plan_checked_at:null},{shop_plan_checked_at:new Date(now-86400000).toISOString()},{shop_plan_checked_at:new Date(now+1000).toISOString()},attestShopPlan(make(),'price_changed',now)]) assert.equal(subscribedShop(v,{...b,...patch},'shop',now),false);
});
