import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const sql=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
test('embedded PostgreSQL executes migrations, RPC cap, eligibility and role isolation', async()=>{
 const db=new PGlite();
 try {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;");
  // pgcrypto extension packaging is unavailable in this embedded engine; no tested RPC uses it.
  await db.exec(sql('20260923002347_launch_security_and_operations.sql').replace('create extension if not exists pgcrypto;',''));
  await db.exec(sql('20261020170000_registered_shops_only.sql'));
  await db.exec(sql('20261021010000_shop_plan_attestation.sql'));
  await db.exec("grant usage on schema public,auth to service_role; grant select on auth.users to service_role;");
  await db.exec("insert into repair_requests(id,owner_id,title,issue_category,issue_details,vehicle_year,vehicle_make,vehicle_model,city,state,zip) overriding system value values(1,'owner','Brakes','brakes','Noise','2020','Test','Car','Yonkers','NY','10701'),(2,'owner','Other','brakes','Noise','2020','Test','Car','Yonkers','NY','10701');");
  for(let i=1;i<=4;i++){
   const id='00000000-0000-0000-0000-'+String(i).padStart(12,'0');
   await db.query('insert into auth.users values ($1,$2)',[id,'shop'+i+'@example.test']);
   await db.query("insert into provider_verifications(user_id,status,business_type,business_name,license_reference,insurance_reference) values($1,'approved','registered_shop','Garage','test','test')",[id]);
   await db.query("insert into billing_accounts(user_id,subscription_status,stripe_subscription_id,current_period_end,shop_plan_valid,shop_plan_price_id,shop_plan_checked_at) values($1,'active','sub_test',now()+interval '1 day',true,'price_test',now())",[id]);
   await db.query("insert into request_invites(repair_id,provider_email,provider_type,expires_at) values(1,$1,'shop',now()+interval '1 hour')",['shop'+i+'@example.test']);
  }
  await db.exec('set role service_role');
  const bid=i=>({request_id:1,mechanic_id:'00000000-0000-0000-0000-'+String(i).padStart(12,'0'),amount:200,eta_hours:24,notes:'No trusted metadata needed'});
  const results=await Promise.allSettled([1,2,3,4].map(i=>db.query('select * from create_shop_bid($1::jsonb)',[JSON.stringify(bid(i))])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  assert.equal((await db.query('select count(*)::int as count from bids')).rows[0].count,3);
  await assert.rejects(db.query('select * from create_marketplace_bid($1::jsonb)',[JSON.stringify(bid(4))]),/permission denied/);
  await assert.rejects(db.query('select * from create_shop_bid($1::jsonb)',[JSON.stringify({...bid(4),request_id:2})]),/invitation required/);
  await db.exec('reset role');
  await db.exec("update billing_accounts set shop_plan_valid=false");
  await db.exec('set role service_role');
  await assert.rejects(db.query('select * from create_shop_bid($1::jsonb)',[JSON.stringify(bid(4))]),/not eligible/);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(db.query('select * from bids'),/permission denied/);
  await assert.rejects(db.query('select * from create_shop_bid($1::jsonb)',[JSON.stringify(bid(4))]),/permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from billing_accounts'),/permission denied/);
 } finally { await db.close(); }
});
