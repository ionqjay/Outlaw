import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {trustedProxyPolicy,createRateLimiter,repairValidationError,boundedText} from '../lib/request-security.js';
test('proxy trust defaults off and rejects hop counts, wildcards and invalid CIDRs',()=>{
 assert.equal(trustedProxyPolicy(),false);
 for(const p of ['true','1','0.0.0.0/0','::/0','127.0.0.1/33','loopback']) assert.throws(()=>trustedProxyPolicy(p));
 assert.deepEqual(trustedProxyPolicy('127.0.0.1/32, ::1/128'),['127.0.0.1/32','::1/128']);
});
test('spoofed forwarding headers cannot reset client rate budget',async()=>{
 const app=express();app.set('trust proxy',trustedProxyPolicy());app.use(createRateLimiter({rules:[{prefix:'/api/bids',max:2}]}));app.get('/api/bids',(req,res)=>res.json({ok:true}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try {for(let i=0;i<3;i++){const response=await fetch('http://127.0.0.1:'+server.address().port+(i===2?'/API/Bids':'/api/bids'),{headers:{'x-forwarded-for':'203.0.113.'+i}});assert.equal(response.status,i<2?200:429);if(i===2)assert.ok(response.headers.get('retry-after'));}}finally{await new Promise(resolve=>server.close(resolve));}
});
test('limiter expires windows, caps memory and never evicts active budgets',()=>{
 let now=0;const limiter=createRateLimiter({rules:[{prefix:'/api/bids',max:1}],maxEntries:2,windowMs:1000,clock:()=>now});
 function call(ip){let status=200;const res={setHeader(){},status(n){status=n;return this},json(){}};limiter({path:'/api/bids',method:'POST',ip},res,()=>{});return status;}
 assert.equal(call('a'),200);assert.equal(call('b'),200);assert.equal(call('c'),429);assert.equal(limiter.entryCount(),2);assert.equal(call('a'),429);
 now=1000;assert.equal(call('c'),200);assert.equal(limiter.entryCount(),1);
});
test('repair validation accepts current UI vocabulary and rejects invalid typed or oversized inputs',()=>{
 const good={title:'Brake repair',issueDetails:'Squeaking brakes need inspection.',issueCategory:'Brakes',vehicleYear:'2020',vehicleMake:'Toyota',vehicleModel:'Camry',city:'Yonkers',state:'NY',zip:'10701',urgency:'Standard'};
 assert.equal(repairValidationError(good,2026),null);
 for(const patch of [{title:'x'.repeat(161)},{issueDetails:{}},{vehicleYear:'2030'},{vehicleYear:'abcd'},{vehicleModel:['Camry']},{state:'New York'},{state:'ZZ'},{issueDetails:'[OWNER_META]{"ownerEmail":"long@example.test"}[/OWNER_META] [Parts preference: Bring parts] x'},{zip:10701},{urgency:'Immediate'},{issueCategory:'unsupported'},{city:'bad'+String.fromCharCode(0)}]) assert.ok(repairValidationError({...good,...patch},2026));
 assert.equal(boundedText({},1,500),false);assert.equal(boundedText(' '.repeat(5),1,500),false);assert.equal(boundedText('Registered Garage',1,500),true);
});

test('explicit trusted proxy policy separates real clients but ignores attacker prepended IPs',async()=>{
 const app=express();app.set('trust proxy',trustedProxyPolicy('127.0.0.1/32,::1/128'));app.use(createRateLimiter({rules:[{prefix:'/api/bids',max:1}]}));app.get('/api/bids',(req,res)=>res.json({ip:req.ip}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const call=header=>fetch('http://127.0.0.1:'+server.address().port+'/api/bids',{headers:{'x-forwarded-for':header}});
 try{
  assert.equal((await call('203.0.113.1, 198.51.100.1')).status,200);
  assert.equal((await call('203.0.113.2, 198.51.100.1')).status,429);
  assert.equal((await call('198.51.100.2')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
