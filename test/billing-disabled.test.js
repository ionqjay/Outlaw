import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { billingMode, missingReleaseConfig, BILLING_UNAVAILABLE } from '../lib/billing-mode.js';

test('only explicit disabled waives Stripe; storage and security remain required', () => {
  assert.equal(billingMode({}), 'enabled');
  assert.throws(() => billingMode({ BILLING_MODE: 'false' }));
  assert.ok(missingReleaseConfig({}).includes('STRIPE_SECRET_KEY'));
  const missing = missingReleaseConfig({ BILLING_MODE: 'disabled' });
  assert.ok(!missing.some(key => key.startsWith('STRIPE')));
  for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CORS_ORIGINS','APP_URL','REPAIR_PHOTO_BUCKET']) assert.ok(missing.includes(key));
});

test('disabled production health still probes database and private storage', async () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("route('get', '/api/health'");
  const end = source.indexOf("route('post', '/api/send-otp'", start);
  let handler, storageBroken = false;
  const env = { BILLING_MODE: 'disabled', SUPABASE_URL: 'local', SUPABASE_SERVICE_ROLE_KEY: 'test', APP_URL: 'local', CORS_ORIGINS: 'local', REPAIR_PHOTO_BUCKET: 'private' };
  const context = vm.createContext({ route: (_method,_path,h) => { handler=h; }, missingProductionConfig: () => missingReleaseConfig(env), USE_SUPABASE:true, BILLING_ENABLED:false, stripe:null, billingConfigReady:()=>false, process:{env:{NODE_ENV:'production'},uptime:()=>0}, supabaseRequest:async()=>[], privatePhotoObjects:{ready:async()=>{if(storageBroken)throw Error('private bucket unavailable');}} });
  vm.runInContext(source.slice(start,end),context);
  const res = { status(n){this.code=n;return this;},json(body){this.body=body;} };
  await handler({},res); assert.equal(res.code,200); assert.equal(res.body.billingMode,'disabled');
  storageBroken=true; await handler({},res); assert.equal(res.code,503);
  storageBroken=false; delete env.CORS_ORIGINS; await handler({},res); assert.equal(res.code,503);
});

test('disabled server blocks cached paid access and Stripe routes but preserves history', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-disabled-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.mjs'));
  fs.cpSync(path.join(root,'lib'),path.join(dir,'lib'),{recursive:true});
  fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  fs.mkdirSync(path.join(dir,'.local-data'));
  const save = (name,rows) => fs.writeFileSync(path.join(dir,name),JSON.stringify(rows));
  save('billing_accounts.json',[{user_id:'shop',subscription_status:'active',stripe_customer_id:'cus_test',stripe_subscription_id:'sub_test',shop_plan_valid:true,shop_plan_price_id:'price_test',shop_plan_checked_at:new Date().toISOString(),current_period_end:'2030-01-01',manual_access_override:'active'}]);
  save('.local-data/provider_verifications.json',[{user_id:'shop',status:'approved',business_type:'registered_shop'}]);
  save('repair_requests.json',[{id:1,owner_id:'owner',status:'accepted',title:'Existing job'},{id:2,owner_id:'owner',status:'open',title:'Undisclosed new lead'}]);
  save('bids.json',[{id:1,request_id:1,mechanic_id:'shop',status:'accepted',amount:99}]);
  save('request_invites.json',[{repair_id:2,provider_email:'shop@example.com',provider_type:'shop',status:'pending',expires_at:'2030-01-01'}]);
  const snapshot=fs.readFileSync(path.join(dir,'request_invites.json'),'utf8');
  Object.assign(process.env,{NODE_ENV:'test',ALLOW_DEV_AUTH:'true',BILLING_MODE:'disabled',STRIPE_SECRET_KEY:'sk_test_never_use',BILLING_RECONCILIATION_ENABLED:'true'});
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const {app}=await import(pathToFileURL(path.join(dir,'server.mjs')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const call=(url,method='GET',role='shop')=>fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{'x-dev-user-id':role,'x-dev-user-email':role+'@example.com','x-dev-user-role':role,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
  try {
    const health=await (await call('/api/health')).json();assert.equal(health.ok,true);assert.equal(health.billingMode,'disabled');assert.equal(health.stripeConfigured,false);
    const status=await (await call('/api/billing/status')).json();assert.equal(status.status,'active');assert.equal(status.canSubmitEstimates,false);
    for(const url of ['/api/billing/create-checkout-session','/api/billing/create-portal-session','/api/billing/refund-requests','/api/stripe/webhook','/api/bids','/api/repairs','/api/owner-request']) assert.equal((await call(url,'POST')).status,503,url);
    assert.equal((await call('/api/billing/invoices')).status,503);
    assert.equal((await call('/api/repairs')).status,503);
    assert.equal((await call('/api/repairs/2/photos')).status,404);
    assert.equal((await call('/api/repairs/1/photos')).status,200);
    const history=await (await call('/api/provider/repair-history')).json();assert.deepEqual(history.repairs.map(r=>r.id),[1]);
    assert.equal((await (await call('/api/bids')).json()).bids.length,1);
    assert.equal((await (await call('/api/repairs','GET','owner')).json()).repairs.length,2);
    assert.equal(fs.readFileSync(path.join(dir,'request_invites.json'),'utf8'),snapshot);
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('owner and shop UI clearly announces coming soon without blocking history',async()=>{
 const dom=new JSDOM('<h1 id="heroHeadline">Quotes</h1><button data-view="quote">Post</button><button data-view="dashboard">History</button><button id="startSubscriptionBtn">Pay</button>',{runScripts:'outside-only',url:'http://localhost'});
 dom.window.fetch=async()=>({ok:true,json:async()=>({billingMode:'disabled',message:BILLING_UNAVAILABLE})});
 dom.window.eval(fs.readFileSync(new URL('../public/availability.js',import.meta.url),'utf8'));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(dom.window.document.getElementById('availabilityNotice').textContent,/coming soon/);
 assert.equal(dom.window.document.querySelector('[data-view="quote"]').disabled,true);
 assert.equal(dom.window.document.querySelector('[data-view="dashboard"]').disabled,false);
 assert.equal(dom.window.document.getElementById('startSubscriptionBtn').disabled,true);
 dom.window.close();
});
