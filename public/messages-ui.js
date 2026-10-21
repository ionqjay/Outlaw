(() => {
 const controls=new Map();
 window.smrMessages={button(id){const key=crypto.randomUUID();controls.set(key,String(id));if(controls.size>5000)controls.delete(controls.keys().next().value);return '<button type="button" class="btn btn-secondary" data-message-key="'+key+'">Messages</button>';}};
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:600px;width:90%;max-height:85vh;overflow:auto';
 const heading=document.createElement('h2');heading.textContent='Repair conversation';heading.id='repair-conversation-heading';dialog.setAttribute('aria-labelledby',heading.id);dialog.append(heading);
 const close=document.createElement('button');close.type='button';close.textContent='Close';dialog.append(close);
 const status=document.createElement('p');status.setAttribute('role','status');dialog.append(status);
 const list=document.createElement('ol');dialog.append(list);
 const older=document.createElement('button');older.type='button';older.textContent='Older messages';dialog.append(older);
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh';dialog.append(refresh);
 const form=document.createElement('form');const label=document.createElement('label');label.textContent='Message (no sensitive financial information)';
 const input=document.createElement('textarea');input.required=true;input.maxLength=2000;input.rows=4;input.style.width='100%';label.append(input);form.append(label);
 const send=document.createElement('button');send.type='submit';send.textContent='Send message';form.append(send);dialog.append(form);document.body.append(dialog);
 let bidId=null,before=null,generation=0,loadSequence=0,retry=null,busy=false;
 const base=(window.APP_CONFIG?.API_BASE||location.origin).replace(/\/$/,'');
 async function api(id,suffix='',body){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(base+'/api/bids/'+id+'/messages'+suffix,{signal:controller.signal,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...await window.smrAuth.getAuthHeaders()},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load messages.');return data;}finally{clearTimeout(timer);}}
 async function load(append=false){const current=generation,sequence=++loadSequence,id=bidId;older.disabled=true;refresh.disabled=true;
  try{const data=await api(id,append&&before?'?before='+before:'');if(current!==generation||sequence!==loadSequence)return;
   heading.textContent='Request #'+(data.conversation?.requestId||'?')+' · Quote #'+id+' · '+(data.conversation?.providerName||'Provider');
   if(!append)list.replaceChildren();
   for(const message of data.messages){const item=document.createElement('li');item.style.whiteSpace='pre-wrap';item.textContent=(message.mine?'You':message.senderRole==='owner'?'Owner':'Provider')+' — '+message.createdAt+'\n'+message.body;list.append(item);}
   before=data.nextBefore;older.hidden=!before;status.textContent=data.messages.length?'Newest messages first.':'No messages yet.';
  }catch(error){if(current===generation&&sequence===loadSequence)status.textContent=error.message;}finally{if(current===generation&&sequence===loadSequence){older.disabled=false;refresh.disabled=false;}}
 }
 document.addEventListener('click',event=>{const button=event.target.closest('[data-message-key]');if(!button||busy)return;const id=controls.get(button.dataset.messageKey);if(!id||!/^[1-9]\d*$/.test(id))return;generation++;bidId=id;before=null;retry=null;input.value='';list.replaceChildren();status.textContent='Loading…';dialog.showModal();void load();});
 close.addEventListener('click',()=>{if(!busy){generation++;dialog.close();}});
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else generation++;});
 older.addEventListener('click',()=>load(true));refresh.addEventListener('click',()=>load());
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!bidId||!input.value.trim())return;busy=true;send.disabled=true;input.disabled=true;close.disabled=true;
  const text=input.value.trim();
  try{if(!retry||retry.body!==text)retry={body:text,clientMessageId:crypto.randomUUID().replaceAll('-','')};await api(bidId,'',retry);retry=null;input.value='';await load();}catch(error){status.textContent=error.message;}finally{busy=false;send.disabled=false;input.disabled=false;close.disabled=false;}
 });
})();
