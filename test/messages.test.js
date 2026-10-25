import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { JSDOM } from 'jsdom';
import { messageStore,registerMessages } from '../lib/messages.js';
async function fixture(fn){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'smr-messages-')),store=messageStore({database:false,directory});
 const app=express();app.use(express.json());
 registerMessages({route:(method,url,handler)=>app[method](url,(req,res,next)=>Promise.resolve(handler(req,res)).catch(next)),store,
 requireUser:async(req,res)=>{const id=req.headers['x-user'];if(!id){res.status(401).json({error:'Auth required'});return null;}return {id};},
 getBid:async id=>[{id:1,request_id:7,mechanic_id:'legacy',status:'accepted'},{id:2,request_id:7,mechanic_id:'expired-shop',status:'declined'},{id:3,request_id:8,mechanic_id:'other'}].find(b=>b.id===id),
 getRepair:async id=>({id,owner_id:id===7?'owner':'other-owner'})});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const call=(id,user,body,query='')=>fetch('http://127.0.0.1:'+server.address().port+'/api/bids/'+id+'/messages'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},body:body?JSON.stringify(body):undefined});
 try{await fn({call,store});}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true});}
}
test('messages require real participation; spoofed sender and recipient cannot widen threads',()=>fixture(async({call,store})=>{
 const body={body:'Hello about this repair',clientMessageId:'message_token_0001',sender_id:'other',sender_role:'admin',bid_id:3};
 assert.equal((await call(1,null)).status,401);
 for(const user of ['stranger','other-owner','expired-shop'])for(const write of [undefined,body])assert.equal((await call(1,user,write)).status,404);
 assert.equal((await call(1,'owner',body)).status,200);assert.equal((await call(1,'owner',body)).status,200);
 assert.equal((await store.list(1,null,50)).length,1);assert.equal((await store.list(1,null,50))[0].sender_id,'owner');
 assert.equal((await call(1,'legacy',{...body,clientMessageId:'message_token_0002'})).status,200);
 assert.equal((await call(2,'expired-shop',body)).status,200);
 const data=await(await call(1,'legacy')).json();assert.equal(data.messages.length,2);assert.equal(data.messages[0].mine,true);assert.equal(data.messages[1].senderRole,'owner');assert.equal(data.messages[0].sender_id,undefined);
 assert.equal((await call(3,'owner')).status,404);
}));
test('message validation, bounded keyset pages and retry idempotency',()=>fixture(async({call})=>{
 for(const body of ['',{},'x'.repeat(2001),'bad'+String.fromCharCode(0)])assert.equal((await call(1,'owner',{body,clientMessageId:'message_token_0001'})).status,400);
 assert.equal((await call(1,'owner',{body:'Hello',clientMessageId:'short'})).status,400);
 for(let i=0;i<3;i++)await call(1,'owner',{body:'Message '+i,clientMessageId:'message_token_000'+i});
 const page=await(await call(1,'owner',null,'?limit=2')).json();assert.equal(page.messages.length,2);assert.ok(page.nextBefore);
 const next=await(await call(1,'owner',null,'?limit=2&before='+page.nextBefore)).json();assert.equal(next.messages.length,1);assert.equal(next.nextBefore,null);
 for(const query of ['?limit=1000','?before=-1','?limit=no'])assert.equal((await call(1,'owner',null,query)).status,400);
}));
test('message rendering keeps stored executable text inert',async()=>{
 const dom=new JSDOM('<button data-message-bid="1">Messages</button>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.smrAuth={getAuthHeaders:async()=>({})};
 w.fetch=async()=>({ok:true,json:async()=>({messages:[{id:1,body:'<img src=x onerror="window.pwned=true"><script>bad()</script>',senderRole:'provider',createdAt:'now'}],nextBefore:null})});
 w.eval(fs.readFileSync(new URL('../public/messages-ui.js',import.meta.url),'utf8'));
 w.document.querySelector('[data-message-bid]').click();assert.equal(w.document.querySelector('dialog').open,false);
 w.document.body.insertAdjacentHTML('beforeend',w.smrMessages.button(1));w.document.querySelector('[data-message-key]').click();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(w.document.querySelector('dialog img'),null);assert.equal(w.document.querySelector('dialog script'),null);assert.match(w.document.querySelector('dialog li').textContent,/<img/);assert.equal(w.pwned,undefined);dom.window.close();
});

import vm from 'node:vm';
test('database adapter accepts empty successful inserts and message store scopes conflict keys',async()=>{
 const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const ctx=vm.createContext({USE_SUPABASE:true,SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',AbortSignal,fetch:async()=>({ok:true,status:201,text:async()=>''})});
 vm.runInContext(source.slice(source.indexOf('async function supabaseRequest('),source.indexOf('async function listAuthUsers(')),ctx);
 assert.equal((await ctx.supabaseRequest('repair_messages',{method:'POST',prefer:'return=minimal',body:{}})).length,0);
 const calls=[];const store=messageStore({database:true,directory:'unused',request:async(url,options)=>{calls.push({url,options});return []}});
 await store.save({bid_id:1,sender_id:'owner',client_message_id:'message_token_test',body:'Hello'});await store.list(1,9,31);
 assert.match(calls[0].url,/on_conflict=bid_id,sender_id,client_message_id/);assert.match(calls[1].url,/bid_id=eq.1/);assert.match(calls[1].url,/limit=31/);
});
test('late initial message response cannot erase newer post-send refresh',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.smrAuth={getAuthHeaders:async()=>({})};let firstResolve,gets=0;
 const data=body=>({ok:true,json:async()=>({conversation:{requestId:7,providerName:'Garage'},messages:[{body,createdAt:'now',mine:true}],nextBefore:null})});
 w.fetch=async(url,options)=>{if(options.method==='POST')return {ok:true,json:async()=>({ok:true})};gets++;if(gets===1)return new Promise(resolve=>firstResolve=resolve);return data('Newest saved message')};
 w.eval(fs.readFileSync(new URL('../public/messages-ui.js',import.meta.url),'utf8'));w.document.body.insertAdjacentHTML('beforeend',w.smrMessages.button(1));w.document.querySelector('[data-message-key]').click();
 await new Promise(resolve=>setTimeout(resolve,5));w.document.querySelector('textarea').value='Newest saved message';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await new Promise(resolve=>setTimeout(resolve,10));firstResolve(data('Old response'));await new Promise(resolve=>setTimeout(resolve,10));
 assert.match(w.document.querySelector('ol').textContent,/Newest saved message/);assert.doesNotMatch(w.document.querySelector('ol').textContent,/Old response/);assert.match(w.document.querySelector('h2').textContent,/Request #7/);dom.window.close();
});
