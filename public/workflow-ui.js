(() => {
 const controls=new Map();
 const labels={'start-work':'Start work','request-completion':'Request owner completion confirmation','complete':'Confirm repair completed','continue-work':'Work is not complete yet'};
 window.smrWorkflow={button(id,action,revision=0){if(!labels[action])return '';const key=crypto.randomUUID();controls.set(key,{id:Number(id),action,revision:Number(revision)});if(controls.size>5000)controls.delete(controls.keys().next().value);return '<button type="button" class="btn btn-secondary" data-workflow-key="'+key+'">'+labels[action]+'</button>';}};
 document.addEventListener('click',async event=>{const button=event.target.closest('[data-workflow-key]');const item=button&&controls.get(button.dataset.workflowKey);if(!item||button.disabled)return;
  const prompt=item.action==='complete'?'Confirm that the repair work is completed? This does not charge or refund any payment.':item.action==='continue-work'?'Tell the shop work is not complete yet?':'Update request #'+item.id+': '+labels[item.action]+'?';
  if(!confirm(prompt))return;button.disabled=true;
  try{const response=await fetch((window.APP_CONFIG?.API_BASE||location.origin).trim().replace(/\/$/,'')+'/api/repairs/'+item.id+'/'+item.action,{method:'POST',headers:{'Content-Type':'application/json',...await window.smrAuth.getAuthHeaders()},body:JSON.stringify({expectedRevision:item.revision}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not update repair.');window.dispatchEvent(new CustomEvent('smr-workflow-updated',{detail:{repairId:item.id}}));}catch(error){alert(error.message);button.disabled=false;}
 });
})();
