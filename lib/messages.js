import fs from 'node:fs';
import path from 'node:path';
import { boundedText } from './request-security.js';
export function messageStore({database,request,directory}) {
 const file=path.join(directory,'repair_messages.json');
 const rows=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 return {
  async list(bidId,before,limit){
   if(database){const q=new URLSearchParams({select:'id,bid_id,sender_id,sender_role,body,created_at',bid_id:'eq.'+bidId,order:'id.desc',limit:String(limit)});if(before)q.set('id','lt.'+before);return request('repair_messages?'+q);}
   return rows().filter(r=>r.bid_id===bidId&&(!before||r.id<before)).sort((a,b)=>b.id-a.id).slice(0,limit);
  },
  async save(row){
   if(database){await request('repair_messages?on_conflict=bid_id,sender_id,client_message_id',{method:'POST',body:row,prefer:'resolution=ignore-duplicates,return=minimal'});return;}
   // Synchronous critical section: local retries/concurrent submits cannot duplicate IDs.
   const data=rows();if(data.some(r=>r.bid_id===row.bid_id&&r.sender_id===row.sender_id&&r.client_message_id===row.client_message_id))return;
   data.push({...row,id:Math.max(0,...data.map(r=>r.id))+1,created_at:new Date().toISOString()});
   fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2));
  }
 };
}
export function registerMessages({route,requireUser,getBid,getRepair,store}) {
 async function participant(req,res){
  const user=await requireUser(req,res,['owner','mechanic','shop']);if(!user)return null;
  if(!/^[1-9]\d*$/.test(req.params.id)||!Number.isSafeInteger(Number(req.params.id))){res.status(400).json({error:'Invalid quote ID.'});return null;}
  const bid=await getBid(Number(req.params.id));const repair=bid?await getRepair(bid.request_id):null;
  const owner=repair&&String(repair.owner_id)===String(user.id);
  if(!repair||(!owner&&String(bid.mechanic_id)!==String(user.id))){res.status(404).json({error:'Conversation not found.'});return null;}
  return {user,bid,role:owner?'owner':'provider'};
 }
 route('get','/api/bids/:id/messages',async(req,res)=>{
  const p=await participant(req,res);if(!p)return;
  const limit=req.query.limit===undefined?30:Number(req.query.limit),before=req.query.before===undefined?null:Number(req.query.before);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||(before!==null&&(!Number.isSafeInteger(before)||before<1)))return res.status(400).json({error:'Invalid message page.'});
  const rows=await store.list(Number(p.bid.id),before,limit+1);
  const page=rows.slice(0,limit);
  res.json({ok:true,conversation:{bidId:p.bid.id,requestId:p.bid.request_id,providerName:p.bid.mechanic_name||'Provider'},messages:page.map(r=>({id:r.id,body:r.body,senderRole:r.sender_role,mine:String(r.sender_id)===String(p.user.id),createdAt:r.created_at})),nextBefore:rows.length>limit?page.at(-1).id:null});
 });
 route('post','/api/bids/:id/messages',async(req,res)=>{
  const p=await participant(req,res);if(!p)return;
  const {body,clientMessageId}=req.body||{};
  if(!boundedText(body,1,2000)||typeof clientMessageId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(clientMessageId))return res.status(400).json({error:'Enter a message of 1–2000 characters and a valid retry token.'});
  await store.save({bid_id:Number(p.bid.id),sender_id:String(p.user.id),sender_role:p.role,body:body.trim(),client_message_id:clientMessageId});
  res.json({ok:true});
 });
}
