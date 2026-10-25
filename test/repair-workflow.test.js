import test from 'node:test';import assert from 'node:assert/strict';import {repairTransition} from '../lib/repair-workflow.js';
const base={id:1,owner_id:'owner',status:'accepted'},bids=[{request_id:1,status:'accepted',mechanic_id:'shop'},{request_id:1,status:'declined',mechanic_id:'other-shop'}];
test('only accepted provider starts and requests; only owner confirms with idempotent transitions',()=>{
 for(const id of ['owner','other-shop','stranger'])assert.throws(()=>repairTransition(base,bids,{id},'start-work'),/authorized/);
 const started=repairTransition(base,bids,{id:'shop'},'start-work');assert.equal(started.repair.status,'in_progress');assert.equal(repairTransition(started.repair,bids,{id:'shop'},'start-work').changed,false);
 const requested=repairTransition(started.repair,bids,{id:'shop'},'request-completion');assert.ok(requested.repair.completion_requested_at);assert.equal(repairTransition(requested.repair,bids,{id:'shop'},'request-completion').changed,false);
 assert.throws(()=>repairTransition(requested.repair,bids,{id:'shop'},'complete'),/authorized/);
 const continued=repairTransition(requested.repair,bids,{id:'owner'},'continue-work');assert.equal(continued.repair.completion_requested_at,null);
 const completed=repairTransition(requested.repair,bids,{id:'owner'},'complete');assert.equal(completed.repair.status,'completed');assert.equal(repairTransition(completed.repair,bids,{id:'owner'},'complete').changed,false);
 assert.throws(()=>repairTransition(completed.repair,bids,{id:'shop'},'start-work'));
});
test('cancellation only applies to open requests and owner direct completion stays compatible',()=>{
 for(const status of ['accepted','in_progress','completed'])assert.throws(()=>repairTransition({...base,status},bids,{id:'owner'},'cancel'),/Only open/);
 const cancelled=repairTransition({...base,status:'open'},[],{id:'owner'},'cancel');assert.equal(cancelled.repair.status,'cancelled');assert.equal(repairTransition(cancelled.repair,[],{id:'owner'},'cancel').changed,false);
 assert.equal(repairTransition(base,bids,{id:'owner'},'complete').repair.status,'completed');
 assert.throws(()=>repairTransition(base,bids,{id:'shop'},'request-completion'),/Start work/);
});

test('stale completion-cycle actions cannot overwrite newer owner decisions',()=>{
 let r=repairTransition(base,bids,{id:'shop'},'start-work',undefined,0).repair;
 r=repairTransition(r,bids,{id:'shop'},'request-completion',undefined,1).repair;
 r=repairTransition(r,bids,{id:'owner'},'continue-work',undefined,2).repair;
 assert.throws(()=>repairTransition(r,bids,{id:'shop'},'request-completion',undefined,1),/Refresh/);
 r=repairTransition(r,bids,{id:'shop'},'request-completion',undefined,3).repair;
 assert.throws(()=>repairTransition(r,bids,{id:'owner'},'continue-work',undefined,2),/Refresh/);
});

import fs from 'node:fs';import {JSDOM} from 'jsdom';
test('workflow UI normalizes base, sends authenticated revision and refreshes without navigation',async()=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;let request,updated,fail=false;
 w.APP_CONFIG={API_BASE:' https://api.example.test/ '};w.smrAuth={getAuthHeaders:async()=>({Authorization:'test-authorization'})};w.confirm=()=>true;w.alert=()=>{};w.AbortSignal={timeout:()=>undefined};
 w.fetch=async(url,options)=>{request={url,options};return{ok:!fail,json:async()=>fail?{error:'Stale revision'}:{ok:true}}};
 w.addEventListener('smr-workflow-updated',event=>{updated=event.detail.repairId});
 w.eval(fs.readFileSync(new URL('../public/workflow-ui.js',import.meta.url),'utf8'));w.document.body.insertAdjacentHTML('beforeend',w.smrWorkflow.button(9,'complete',3));const button=w.document.querySelector('button');button.click();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(request.url,'https://api.example.test/api/repairs/9/complete');assert.equal(JSON.parse(request.options.body).expectedRevision,3);assert.equal(request.options.headers.Authorization,'test-authorization');assert.equal(updated,9);assert.equal(w.location.href,'http://localhost/');
 fail=true;button.disabled=false;button.click();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(button.disabled,false);dom.window.close();
});
