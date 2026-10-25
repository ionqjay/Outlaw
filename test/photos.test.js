import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import express from 'express';import sharp from 'sharp';
import { normalizePhoto,photoObjects,photoMetadata,registerPhotos,PHOTO_BYTES } from '../lib/photos.js';
const image=()=>sharp({create:{width:12,height:12,channels:3,background:'red'}}).png().toBuffer();
async function fixture(fn,broken=false){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'smr-photo-'));const metadata=photoMetadata({database:false,directory});const objects=photoObjects({database:false,directory:path.join(directory,'private')});if(broken)objects.put=async()=>{throw Error('storage down')};const app=express();
 registerPhotos({route:(method,url,...handlers)=>app[method](url,...handlers.map(h=>(req,res,next)=>Promise.resolve(h(req,res,next)).catch(next))),metadata,objects,
 requireUser:async(req,res)=>{if(!req.headers['x-user']){res.status(401).json({error:'Auth required'});return null;}return{id:req.headers['x-user']};},getRepair:async id=>[1,2].includes(id)?{id,owner_id:id===1?'owner':'other'}:null,canView:async(user,r)=>r.id===1&&['invited','historical'].includes(user.id)});
 app.use((e,req,res,next)=>res.status(e.status||503).json({error:'failed'}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const call=(suffix,user='owner',method='GET',body)=>fetch('http://127.0.0.1:'+server.address().port+'/api/repairs/'+suffix,{method,headers:{...(user?{'x-user':user}:{}),'Content-Type':'image/png'},body});
 try{await fn({call,metadata,objects});}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true});}}
test('images are decoded and reencoded without metadata; SVG, malformed and huge files rejected',async()=>{
 const source=await sharp(await image()).withMetadata({orientation:3}).jpeg().toBuffer();const safe=await normalizePhoto(source);const meta=await sharp(safe).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),Buffer.from('not an image'),Buffer.alloc(PHOTO_BYTES+1)])await assert.rejects(normalizePhoto(bytes));
});
test('only owners upload/delete; authorized historical/invited participants see private content',()=>fixture(async({call})=>{
 assert.equal((await call('1/photos',null)).status,401);
 for(const user of ['other','invited','historical','stranger'])assert.equal((await call('1/photos',user,'POST',await image())).status,404);
 const upload=await call('1/photos','owner','POST',await image());assert.equal(upload.status,200);const {id}=await upload.json();
 for(const user of ['owner','invited','historical']){const result=await call('1/photos/'+id+'/content',user);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/jpeg');assert.equal(result.headers.get('cache-control'),'no-store');}
 assert.equal((await call('1/photos/'+id+'/content','stranger')).status,404);assert.equal((await call('2/photos/'+id+'/content','other')).status,404);
 assert.equal((await call('1/photos/'+id,'historical','DELETE')).status,404);assert.equal((await call('1/photos/'+id,'owner','DELETE')).status,200);assert.equal((await call('1/photos/'+id+'/content')).status,404);
}));
test('photo count includes reservations and storage failure retains no silent orphan',()=>fixture(async({call,metadata})=>{
 for(let i=0;i<5;i++)assert.equal((await call('1/photos','owner','POST',await image())).status,200);
 assert.equal((await call('1/photos','owner','POST',await image())).status,409);assert.equal((await metadata.list(1)).length,5);
 assert.equal((await call('2/photos','other','POST',Buffer.from('fake'))).status,400);
}));
test('ambiguous failed object write retains reservation for delayed cleanup',()=>fixture(async({call,metadata})=>{
 assert.equal((await call('1/photos','owner','POST',await image())).status,503);assert.equal((await metadata.list(1)).length,1);assert.equal((await metadata.list(1))[0].state,'pending');
 const id=(await metadata.list(1))[0].id;assert.equal((await call('1/photos/'+id,'owner','DELETE')).status,409);
},true));

import { JSDOM } from 'jsdom';
test('photo UI uses authenticated blobs, supports missing-object deletion and clears on signout',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;let authChange,revoked=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.AbortSignal={timeout:()=>undefined};w.URL.createObjectURL=()=> 'blob:private-test';w.URL.revokeObjectURL=()=>{revoked++};w.smrAuth={getAuthHeaders:async()=>({Authorization:'Bearer test'})};w.smrSupabase={auth:{onAuthStateChange:fn=>{authChange=fn}}};
 w.fetch=async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer test');if(url.endsWith('/photos'))return {ok:true,json:async()=>({canUpload:true,photos:[{id:'one',state:'ready'},{id:'missing',state:'ready'}]})};if(url.includes('/missing/'))return {ok:false,json:async()=>({error:'missing'})};return {ok:true,blob:async()=>new w.Blob(['jpeg'],{type:'image/jpeg'})};};
 w.eval(fs.readFileSync(new URL('../public/photos-ui.js',import.meta.url),'utf8'));w.document.body.insertAdjacentHTML('beforeend',w.smrPhotos.button(1));w.document.querySelector('[data-photo-key]').click();await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(w.document.querySelector('img').getAttribute('src'),'blob:private-test');assert.equal([...w.document.querySelectorAll('dialog button')].filter(b=>b.textContent==='Delete photo').length,2);
 authChange('SIGNED_OUT');assert.equal(w.document.querySelector('img'),null);assert.equal(revoked,1);assert.equal(w.document.querySelector('dialog').open,false);dom.window.close();
});
test('unavailable private bucket creates no metadata reservation',()=>fixture(async({call,metadata,objects})=>{
 objects.ready=async()=>{throw Error('bucket public or missing')};assert.equal((await call('1/photos','owner','POST',await image())).status,503);assert.equal((await metadata.list(1)).length,0);
}));
