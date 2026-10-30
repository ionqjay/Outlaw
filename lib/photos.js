import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
export const PHOTO_LIMIT=5, PHOTO_BYTES=5*1024*1024;
export async function normalizePhoto(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>PHOTO_BYTES)throw Error('Image must be at most 5 MB.');
 const signature=bytes.subarray(0,12);
 const raster=(signature[0]===255&&signature[1]===216&&signature[2]===255)||signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(signature.toString('ascii',0,4)==='RIFF'&&signature.toString('ascii',8,12)==='WEBP');
 if(!raster)throw Error('Unsupported raster signature');
 const image=sharp(bytes,{limitInputPixels:16000000,failOn:'warning'}),meta=await image.metadata();
 if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)!==1)throw Error('Use a single JPEG, PNG or WebP image.');
 // Decode/re-encode; metadata is removed by default, no passthrough or SVG.
 return image.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer();
}
export function photoObjects({database,url,key,bucket,directory}){
 const client=database?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}}):null;
 const valid=id=>{if(!/^[a-f0-9-]{36}\.jpg$/.test(id))throw Error('Invalid object key');return id;};
 async function privateBucket(){if(!bucket||!/^[a-z0-9_-]{1,63}$/.test(bucket))throw Error('Private photo bucket not configured');const {data,error}=await client.storage.getBucket(bucket);if(error||!data||data.public!==false)throw Error('Photo storage must be private');return client.storage.from(bucket);}
 return {
  async ready({signal}={} ){
   if(!client)return;
   if(!signal){await privateBucket();return;}
   // SDK getBucket has no per-call signal. Read the same metadata endpoint directly
   // for readiness only; keep upload/download/delete behavior unchanged.
   if(!bucket||!/^[a-z0-9_-]{1,63}$/.test(bucket))throw Error('Private photo bucket not configured');
   const response=await fetch((url.endsWith('/')?url.slice(0,-1):url)+'/storage/v1/bucket/'+encodeURIComponent(bucket),{
    headers:{apikey:key,Authorization:'Bearer '+key},
    signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])
   });
   if(!response.ok)throw Error('Photo storage unavailable');
   const data=await response.json();
   if(!data||data.public!==false)throw Error('Photo storage must be private');
  },
  async put(id,bytes){valid(id);if(client){const b=await privateBucket();const {error}=await b.upload(id,bytes,{contentType:'image/jpeg',upsert:false});if(error)throw error;}else{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,id),bytes,{flag:'wx'});}},
  async get(id){valid(id);if(client){const b=await privateBucket();const {data,error}=await b.download(id);if(error)throw error;return Buffer.from(await data.arrayBuffer());}return fs.readFileSync(path.join(directory,id));},
  async remove(id){valid(id);if(client){const b=await privateBucket();const {error}=await b.remove([id]);if(error)throw error;}else{try{fs.unlinkSync(path.join(directory,id));}catch(e){if(e.code!=='ENOENT')throw e;}}}
 };
}
export function photoMetadata({database,request,directory}){
 const file=path.join(directory,'repair_photos.json');const rows=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 const save=data=>{fs.mkdirSync(directory,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);};
 return {
  async list(repairId){return database?request('repair_photos?repair_id=eq.'+repairId+'&select=*&order=created_at.asc&limit=5'):rows().filter(r=>r.repair_id===repairId);},
  async reserve(repairId,ownerId){const id=randomUUID();if(database){const result=await request('rpc/reserve_repair_photo',{method:'POST',body:{p_repair_id:repairId,p_owner_id:ownerId,p_id:id}});return result[0];}const data=rows();if(data.filter(r=>r.repair_id===repairId).length>=PHOTO_LIMIT)throw Error('Photo limit reached');const row={id,repair_id:repairId,object_key:id+'.jpg',state:'pending',created_at:new Date().toISOString()};data.push(row);save(data);return row;},
  async state(id,state){if(database)return request('repair_photos?id=eq.'+id,{method:'PATCH',body:{state},prefer:'return=minimal'});const data=rows();const row=data.find(r=>r.id===id);if(row){row.state=state;save(data);}},
  async remove(id){if(database)return request('repair_photos?id=eq.'+id,{method:'DELETE',prefer:'return=minimal'});save(rows().filter(r=>r.id!==id));}
 };
}
export function registerPhotos({route,requireUser,getRepair,canView,metadata,objects}){
 async function access(req,res,ownerOnly=false){const user=await requireUser(req,res,['owner','mechanic','shop']);if(!user)return null;
 const id=Number(req.params.id);if(!/^[1-9]\d*$/.test(req.params.id)||!Number.isSafeInteger(id)){res.status(400).json({error:'Invalid request ID'});return null;}
 const repair=await getRepair(id);const owner=repair&&String(repair.owner_id)===String(user.id);
 if(!repair||(!owner&&(ownerOnly||!await canView(user,repair)))){res.status(404).json({error:'Photos not found'});return null;}return {user,repair,owner};}
 route('get','/api/repairs/:id/photos',async(req,res)=>{const a=await access(req,res);if(!a)return;const rows=await metadata.list(Number(a.repair.id));res.json({ok:true,canUpload:a.owner,photos:rows.filter(r=>a.owner||r.state==='ready').map(r=>({id:r.id,state:r.state}))});});
 route('get','/api/repairs/:id/photos/:photoId/content',async(req,res)=>{const a=await access(req,res);if(!a)return;const row=(await metadata.list(Number(a.repair.id))).find(r=>r.id===req.params.photoId&&r.state==='ready');if(!row)return res.status(404).json({error:'Photo not found'});const bytes=await objects.get(row.object_key);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','image/jpeg');res.setHeader('X-Content-Type-Options','nosniff');res.send(bytes);});
 // Authorization runs BEFORE reading an upload body.
 route('post','/api/repairs/:id/photos',async(req,res,next)=>{const a=await access(req,res,true);if(!a)return;req.photoAccess=a;next();},express.raw({type:['image/jpeg','image/png','image/webp'],limit:PHOTO_BYTES}),async(req,res)=>{
 let bytes;try{bytes=await normalizePhoto(req.body);}catch{return res.status(400).json({error:'Use a valid JPEG, PNG or WebP, at most 5 MB and 16 megapixels.'});}
 const a=req.photoAccess;try{await objects.ready();}catch{return res.status(503).json({error:'Private photo storage is unavailable.'});}let row;try{row=await metadata.reserve(Number(a.repair.id),String(a.user.id));}catch{return res.status(409).json({error:'Photo capacity unavailable; remove an existing photo or retry.'});}
 try{await objects.put(row.object_key,bytes);await metadata.state(row.id,'ready');res.json({ok:true,id:row.id});}catch{/* Ambiguous timed-out writes can commit later: retain reservation for delayed cleanup. */res.status(503).json({error:'Photo upload failed. Refresh photos and remove any pending item before retrying.'});}
 });
 route('delete','/api/repairs/:id/photos/:photoId',async(req,res)=>{const a=await access(req,res,true);if(!a)return;const row=(await metadata.list(Number(a.repair.id))).find(r=>r.id===req.params.photoId);if(!row)return res.status(404).json({error:'Photo not found'});if(row.state==='pending'&&Date.now()-Date.parse(row.created_at)<600000)return res.status(409).json({error:'Upload may still be running. Retry cleanup after 10 minutes.'});await metadata.state(row.id,'deleting');await objects.remove(row.object_key);await metadata.remove(row.id);res.json({ok:true});});
}
