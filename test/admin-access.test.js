import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {prepareAdminAccess} from '../lib/admin-access.js';
async function fixture(fn,{auditFailure=null,memberFailure=false}={}){
 const events=[];let effects=0;const app=express();app.use(express.json());
 const store={member:async id=>{if(memberFailure)throw Error('membership down');return id==='approved'},audit:async row=>{if(row.outcome===auditFailure)throw Error('audit down');events.push(row)}};
 app.post('/api/admin/thing/:id',async(req,res,next)=>{try{if(!await prepareAdminAccess(req,res,{required:true,getUser:async r=>r.headers['x-user']?{id:r.headers['x-user'],user_metadata:{role:'admin'}}:null,store}))return;effects++;res.status(req.body.fail?409:200).json({ok:!req.body.fail});}catch(e){next(e);}});
 app.use((e,req,res,next)=>res.status(503).json({error:'Unavailable'}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const call=(user,body={})=>fetch('http://127.0.0.1:'+server.address().port+'/api/admin/thing/private-target?token=never-log-this',{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},body:JSON.stringify(body)});
 try{await fn({call,events,effects:()=>effects});}finally{await new Promise(resolve=>server.close(resolve));}
}
test('membership not editable roles authorizes; audit contains minimal intent and outcome',()=>fixture(async({call,events,effects})=>{
 assert.equal((await call(null)).status,401);assert.equal((await call('unapproved')).status,403);assert.equal(effects(),0);
 assert.equal((await call('approved',{customerMessage:'do-not-log',token:'secret-body'})).status,200);assert.equal(events.length,2);assert.equal(events[0].actor_id,'approved');assert.equal(events[0].outcome,'attempt');assert.equal(events[1].outcome,'success');assert.equal(events[0].correlation_id,events[1].correlation_id);
 const encoded=JSON.stringify(events);for(const secret of ['private-target','never-log-this','do-not-log','secret-body'])assert.equal(encoded.includes(secret),false);
 assert.equal((await call('approved',{fail:true})).status,409);assert.equal(events.at(-1).outcome,'failure');
}));
test('failed durable intent denies privileged action',()=>fixture(async({call,effects})=>{assert.equal((await call('approved')).status,503);assert.equal(effects(),0);},{auditFailure:'attempt'}));
test('failed outcome preserves intent and returns reconcile-not-retry warning',()=>fixture(async({call,effects,events})=>{const response=await call('approved');assert.equal(response.status,503);assert.match((await response.json()).error,/reconcile/);assert.equal(effects(),1);assert.equal(events.length,1);},{auditFailure:'success'}));
test('membership outage fails closed',()=>fixture(async({call,effects})=>{assert.equal((await call('approved')).status,503);assert.equal(effects(),0);},{memberFailure:true}));

import fs from 'node:fs';import {JSDOM} from 'jsdom';
test('audit distinguishes allowlisted decisions without recording review notes',()=>fixture(async({call,events})=>{
 await call('approved',{status:'approved',note:'private evidence'});await call('approved',{status:'rejected',note:'private evidence'});await call('approved',{mode:'disabled'});
 assert.deepEqual(events.filter(e=>e.outcome==='attempt').map(e=>e.decision),['approved','rejected','disabled']);assert.equal(JSON.stringify(events).includes('private evidence'),false);
}));
test('admin pages never repaint stale private responses after logout',async()=>{
 for(const page of ['admin-dashboard','admin-launch']){
  const dom=new JSDOM('<button id="loadAdmin"></button><section id="adminContent"></section><p id="adminStatus"></p><form id="adminLogin"></form><p id="opsStatus"></p><div id="verificationQueue"></div><div id="refundQueue"></div>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;let changed,resolve;
  w.smrAuth={getAuthHeaders:async()=>({})};w.smrSupabase={auth:{onAuthStateChange:fn=>{changed=fn}}};w.AbortSignal={timeout:()=>undefined};
  w.fetch=async()=>new Promise(r=>{resolve=r});w.eval(fs.readFileSync(new URL('../public/'+page+'.js',import.meta.url),'utf8'));
  if(page==='admin-dashboard')w.document.getElementById('loadAdmin').click();else w.document.getElementById('adminLogin').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await new Promise(r=>setTimeout(r,5));changed('SIGNED_OUT');resolve({ok:true,json:async()=>({accounts:[{email:'private-customer@example.test'}],verifications:[{business_name:'Private customer'}],refunds:[]})});await new Promise(r=>setTimeout(r,10));
  assert.equal(w.document.body.textContent.includes('private-customer@example.test'),false);assert.equal(w.document.body.textContent.includes('Private customer'),false);dom.window.close();
 }
});
