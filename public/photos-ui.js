(() => {
 const keys=new Map();window.smrPhotos={button(id){const key=crypto.randomUUID();keys.set(key,String(id));if(keys.size>5000)keys.delete(keys.keys().next().value);return '<button type="button" class="btn btn-secondary" data-photo-key="'+key+'">Photos</button>';}};
 const dialog=document.createElement('dialog');dialog.style.cssText='width:90%;max-width:650px;max-height:85vh;overflow:auto';
 const title=document.createElement('h2');title.id='repair-photo-title';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);
 const close=document.createElement('button');close.textContent='Close';dialog.append(close);
 const status=document.createElement('p');status.setAttribute('role','status');dialog.append(status);
 const gallery=document.createElement('div');dialog.append(gallery);
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','Choose repair photo');dialog.append(input);
 const upload=document.createElement('button');upload.textContent='Upload photo (maximum 5 MB, 5 photos)';dialog.append(upload);document.body.append(dialog);
 let repair=null,generation=0,urls=[],busy=false;
 function clear(){for(const url of urls)URL.revokeObjectURL(url);urls=[];gallery.replaceChildren();}
 async function api(path,options={}){const headers=await window.smrAuth.getAuthHeaders();const response=await fetch((window.APP_CONFIG?.API_BASE||location.origin)+'/api/repairs/'+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});if(!response.ok){const data=await response.json();throw Error(data.error||'Photo request failed');}return response;}
 async function load(){const current=++generation,id=repair;clear();status.textContent='Loading photos…';try{const data=await(await api(id+'/photos')).json();if(current!==generation)return;input.hidden=upload.hidden=!data.canUpload;
 for(const photo of data.photos){const card=document.createElement('div');gallery.append(card);if(photo.state==='ready'){try{const response=await api(id+'/photos/'+photo.id+'/content');const blob=await response.blob();if(current!==generation)return;const url=URL.createObjectURL(blob);urls.push(url);const img=document.createElement('img');img.src=url;img.alt='Repair photo';img.style.maxWidth='100%';card.append(img);}catch(e){if(current!==generation)return;card.textContent='Image unavailable. Owners may remove it and retry.';}}else{card.textContent='Upload cleanup required: '+photo.state;}
 if(data.canUpload){const remove=document.createElement('button');remove.textContent='Delete photo';remove.addEventListener('click',async()=>{if(busy)return;busy=true;try{const before=generation;await api(id+'/photos/'+photo.id,{method:'DELETE'});if(before===generation&&dialog.open)await load();}catch(e){status.textContent=e.message;}finally{busy=false;}});card.append(remove);}}
 status.textContent='Photos are private to authorized repair participants. Avoid personal documents.';
 }catch(e){if(current===generation)status.textContent=e.message;}}
 document.addEventListener('click',e=>{const button=e.target.closest('[data-photo-key]');const id=button&&keys.get(button.dataset.photoKey);if(!id||busy)return;repair=id;title.textContent='Photos for request #'+id;input.value='';input.hidden=upload.hidden=true;dialog.showModal();void load();});
 function clearPrivate(){generation++;clear();repair=null;dialog.close();}
 window.smrSupabase?.auth?.onAuthStateChange((event)=>{if(['SIGNED_OUT','SIGNED_IN','USER_UPDATED'].includes(event))clearPrivate();});
 window.addEventListener('storage',event=>{if(event.key==='smr_session'||event.key?.includes('auth-token'))clearPrivate();});
 close.addEventListener('click',()=>{generation++;clear();dialog.close();});dialog.addEventListener('cancel',()=>{generation++;clear();});
 upload.addEventListener('click',async()=>{const file=input.files[0];if(busy||!file)return;if(file.size>5*1024*1024){status.textContent='Maximum image size is 5 MB.';return;}busy=true;upload.disabled=true;const id=repair;try{await api(id+'/photos',{method:'POST',headers:{'Content-Type':file.type},body:file});input.value='';if(repair===id&&dialog.open)await load();}catch(e){status.textContent=e.message;}finally{busy=false;upload.disabled=false;}});
})();
