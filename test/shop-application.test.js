import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

test('application persists locally, isolates accounts, ignores forged approval and keeps marketplace closed', async()=>{
 const root=path.resolve(new URL('..',import.meta.url).pathname),dir=fs.mkdtempSync(path.join(os.tmpdir(),'smr-application-'));
 fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.mjs'));fs.cpSync(path.join(root,'lib'),path.join(dir,'lib'),{recursive:true});fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 Object.assign(process.env,{NODE_ENV:'test',ALLOW_DEV_AUTH:'true',BILLING_MODE:'disabled'});
 for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
 const {app}=await import(pathToFileURL(path.join(dir,'server.mjs')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const call=(url,body,id='applicant',role='shop')=>fetch('http://127.0.0.1:'+server.address().port+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(id?{'x-dev-user-id':id,'x-dev-user-role':role,'x-dev-user-email':id+'@example.invalid'}:{})},body:body?JSON.stringify(body):undefined});
 try{
 const url='/api/provider/verification';
 assert.equal((await call(url,null,'')).status,401);
 assert.equal((await call(url,{},'owner','owner')).status,403);
 assert.equal((await call(url,{})).status,400);
 const application={business_name:'Synthetic Fixture Garage',registration_reference:'TEST ONLY 123',business_address:'123 Fixture Street',license_reference:'TEST LICENSE',insurance_reference:'TEST POLICY',status:'approved',business_type:'registered_shop',user_id:'victim'};
 const response=await call(url,application);assert.equal(response.status,200);
 const row=(await response.json()).verification;assert.equal(row.status,'pending');assert.equal(row.user_id,'applicant');assert.equal(row.business_type,null);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'.local-data/provider_verifications.json'),'utf8'));assert.equal(saved[0].business_name,application.business_name);
 assert.equal((await (await call(url)).json()).verification.id,row.id);
 assert.equal((await (await call(url,null,'other')).json()).verification,null);
 assert.equal((await call('/api/repairs')).status,503);
 assert.equal((await (await call('/api/billing/status')).json()).canSubmitEstimates,false);
 assert.equal((await call('/api/admin/verification/applicant',{status:'approved',note:'forged approval'})).status,403);
 saved[0].status='rejected';saved[0].review_note='Fixture reason';fs.writeFileSync(path.join(dir,'.local-data/provider_verifications.json'),JSON.stringify(saved));
 assert.equal((await (await call(url,application)).json()).verification.status,'pending');
 saved[0].status='approved';saved[0].business_type='registered_shop';fs.writeFileSync(path.join(dir,'.local-data/provider_verifications.json'),JSON.stringify(saved));
 assert.equal((await call(url,application)).status,409);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('nonlocal UI cannot trust a forged local development session',async()=>{
 const dom=new JSDOM('',{url:'https://example.invalid',runScripts:'outside-only'});
 dom.window.localStorage.setItem('smr_session',JSON.stringify({id:'forged',role:'shop'}));
 dom.window.eval(fs.readFileSync(new URL('../public/app-auth.js',import.meta.url),'utf8'));
 assert.equal(await dom.window.smrAuth.getActiveSession(),null);assert.equal(Object.keys(await dom.window.smrAuth.getAuthHeaders()).length,0);dom.window.close();
});

for(const state of ['pending','rejected','approved'])test('application UI restores '+state+' without implying live access',async()=>{
 const html=fs.readFileSync(new URL('../public/mechanic.html',import.meta.url),'utf8');const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'});
 dom.window.smrAuth={getActiveSession:async()=>({id:'fixture'}),getAuthHeaders:async()=>({})};
 dom.window.fetch=async url=>({ok:true,json:async()=>url.endsWith('/verification')?{verification:{status:state,business_name:'Fixture Garage',review_note:'Fixture note'}}:url.endsWith('/notifications')?{notifications:[]}:{invoices:[]}});
 dom.window.eval(fs.readFileSync(new URL('../public/operations-ui.js',import.meta.url),'utf8'));await new Promise(r=>setTimeout(r,0));
 assert.equal(dom.window.document.querySelector('[name=business_name]').value,'Fixture Garage');
 assert.equal(dom.window.document.querySelector('#verificationForm button').disabled,state==='approved');
 assert.equal(dom.window.document.querySelector('#applicationStatus').dataset.state,state);dom.window.close();
});

test('dashboard forms keep unique IDs, visible navigation and no fixed mobile obstruction',()=>{
 for(const file of ['mechanic.html','owner-app.html']){
 const dom=new JSDOM(fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'));
 const ids=[...dom.window.document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
 assert.ok(dom.window.document.querySelector('link[href="/dashboard-design.css"]'));
 assert.ok(dom.window.document.querySelector('#dashboardMain'));assert.equal(dom.window.document.querySelector('.mobile-cta'),null);dom.window.close();
 }
});
