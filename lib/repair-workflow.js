export function repairTransition(repair,bids,actor,action,now=new Date().toISOString(),expectedRevision) {
 const owner=String(repair.owner_id)===String(actor.id),provider=bids.some(b=>Number(b.request_id)===Number(repair.id)&&b.status==='accepted'&&String(b.mechanic_id)===String(actor.id));
 const ownerAction=['complete','cancel','continue-work'].includes(action);
 if(ownerAction?(!owner&&!actor.admin):!provider)throw Object.assign(Error('Only the authorized repair participant can perform this action.'),{status:403});
 if(expectedRevision!==undefined&&expectedRevision!==Number(repair.workflow_revision||0))throw Object.assign(Error('Repair changed. Refresh before retrying.'),{status:409});
 const next={...repair};let changed=false;
 if(action==='start-work'){
  if(repair.status==='in_progress')return {repair:next,changed:false};
  if(repair.status!=='accepted')throw Object.assign(Error('Only an accepted job can be started.'),{status:409});
  next.status='in_progress';changed=true;
 }else if(action==='request-completion'){
  if(repair.status!=='in_progress')throw Object.assign(Error('Start work before requesting completion.'),{status:409});
  if(repair.completion_requested_at)return {repair:next,changed:false};
  next.completion_requested_at=now;changed=true;
 }else if(action==='complete'){
  if(repair.status==='completed')return {repair:next,changed:false};
  if(!['accepted','in_progress'].includes(repair.status))throw Object.assign(Error('Only an accepted or in-progress repair can be confirmed complete.'),{status:409});
  next.status='completed';changed=true;
 }else if(action==='continue-work'){
  if(repair.status!=='in_progress')throw Object.assign(Error('Repair is not in progress.'),{status:409});
  if(!repair.completion_requested_at)return {repair:next,changed:false};
  next.completion_requested_at=null;changed=true;
 }else if(action==='cancel'){
  if(repair.status==='cancelled')return {repair:next,changed:false};
  if(repair.status!=='open')throw Object.assign(Error('Only open requests can be cancelled. Contact support for an active job.'),{status:409});
  next.status='cancelled';changed=true;
 }else throw Object.assign(Error('Unknown workflow action.'),{status:400});
 next.workflow_revision=Number(repair.workflow_revision||0)+1;
 return {repair:next,changed,event:{action,actor_id:String(actor.id),from_status:repair.status,to_status:next.status,created_at:now}};
}
