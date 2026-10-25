import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
export function adminStore({database,request,directory}){
 const read=name=>{const file=path.join(directory,name+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[]};
 return {
  async member(userId){if(!userId)return false;const rows=database?await request('admin_memberships?user_id=eq.'+encodeURIComponent(userId)+'&active=eq.true&select=user_id&limit=1'):read('admin_memberships').filter(r=>r.user_id===userId&&r.active===true);return rows.length>0;},
  async recent(){if(database)return request('admin_audit_events?select=actor_id,action,target_hash,decision,correlation_id,outcome,http_status,created_at&order=id.desc&limit=50');const file=path.join(directory,'admin_audit_events.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).slice(-50).reverse().map(line=>JSON.parse(line)):[];},
  async audit(row){if(database){await request('admin_audit_events',{method:'POST',body:row,prefer:'return=minimal'});return;}
   fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'admin_audit_events.jsonl');const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 };
}
export async function prepareAdminAccess(req,res,{getUser,store,required=false}){
 const user=await getUser(req);req.adminUser=null;
 let member=false;
 if(user){try{member=await store.member(String(user.id));}catch(error){if(required)throw error;}}
 if(!user||!member){if(required){res.status(user?403:401).json({error:'An individually authorized administrator session is required.'});return false;}return true;}
 req.adminUser=user;
 const correlation=randomUUID(),action=req.method+' '+String(req.route?.path||'admin');
 const targetHash=createHash('sha256').update(JSON.stringify(req.params||{})).digest('hex');
 const decision=['approved','rejected'].includes(req.body?.status)?req.body.status:['active','disabled','clear'].includes(req.body?.mode)?req.body.mode:null;
 const base={decision,actor_id:String(user.id),action,target_hash:targetHash,correlation_id:correlation};
 // Durable intent BEFORE any privileged effect. No token/body/query/customer text is recorded.
 await store.audit({...base,outcome:'attempt',created_at:new Date().toISOString()});
 const end=res.end.bind(res);let ending=false;
 res.end=function(chunk,encoding,callback){if(ending)return res;ending=true;const status=res.statusCode;
  store.audit({...base,outcome:status<400?'success':'failure',http_status:status,created_at:new Date().toISOString()}).then(()=>end(chunk,encoding,callback)).catch(()=>{
   // Action may already have happened. Retained attempt permits operator reconciliation.
   res.statusCode=503;res.removeHeader('Content-Length');res.setHeader('Content-Type','application/json');end(JSON.stringify({error:'Admin audit completion unavailable. Do not blindly retry; reconcile the recorded attempt.'}));
  });return res;
 };
 return true;
}
