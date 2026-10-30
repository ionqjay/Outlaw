import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import {singleFlightProbe} from '../lib/health-probe.js';
import {photoObjects} from '../lib/photos.js';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function mount({request,ready=async()=>{},missing=()=>[],options={}}){
 const app=express(); app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const start=source.indexOf('const checkDatabaseReadiness'),end=source.indexOf("route('post', '/api/send-otp'",start);
 vm.runInNewContext(source.slice(start,end),{singleFlightProbe:p=>singleFlightProbe(p,options),route:(method,path,h)=>app[method](path,h),supabaseRequest:request,privatePhotoObjects:{ready},missingProductionConfig:missing,USE_SUPABASE:true,BILLING_ENABLED:false,stripe:null,billingConfigReady:()=>false,process:{env:{NODE_ENV:'production'},uptime:()=>0}});
 return app;
}
test('actual health handler returns no-store503 within default3s budget for hung dependencies',async()=>{
 let calls=0;const signals=[];
 const app=mount({request:(_,options)=>{calls++;signals.push(options.signal);return new Promise(()=>{});}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try {
  const url='http://127.0.0.1:'+server.address().port+'/API/HEALTH',start=Date.now();
  const responses=await Promise.all([fetch(url),fetch(url)]);
  assert.ok(Date.now()-start<4500);
  for(const r of responses){assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');const b=await r.json();assert.equal(b.ok,false);assert.equal(b.databaseReady,false);}
  assert.equal(calls,7);assert.ok(signals.every(s=>s.aborted));
  assert.equal((await fetch(url)).status,503);assert.equal(calls,7);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('config is read after awaiting dependencies and rechecked on cached success',async()=>{
 let missing=[],release;const app=mount({request:async()=>[],ready:()=>new Promise(resolve=>{release=resolve;}),missing:()=>missing});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api/health';const pending=fetch(url);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  missing=['CORS_ORIGINS'];release();assert.equal((await pending).status,503);
  missing=[];assert.equal((await fetch(url)).status,200);
  missing=['APP_URL'];assert.equal((await fetch(url)).status,503);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('bucket metadata readiness preserves private requirement and propagates cancellation',async()=>{
 const original=globalThis.fetch;const controller=new AbortController();
 const objects=photoObjects({database:true,url:'https://example.supabase.co/',key:'synthetic',bucket:'private',directory:'/unused'});
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://example.supabase.co/storage/v1/bucket/private');assert.ok(options.signal);return new Response(JSON.stringify({public:false}));};
  await objects.ready({signal:controller.signal});
  globalThis.fetch=async()=>new Response(JSON.stringify({public:true}));await assert.rejects(objects.ready({signal:controller.signal}));
  let signal;globalThis.fetch=(_,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
  const pending=objects.ready({signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(signal.aborted,true);
 }finally{globalThis.fetch=original;}
});
