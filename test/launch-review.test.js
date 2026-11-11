import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
const file = name => fs.readFileSync(new URL('../public/'+name, import.meta.url),'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve,0));
for (const mode of ['closed-health-failed','timeout']) test('availability copy is not a dependency promise: '+mode, async()=>{
 const dom=new JSDOM(file('index.html')+'<button id="submitRepairBtn">Submit</button>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;const calls=[];
 w.AbortController=AbortController;w.fetch=async url=>{calls.push(url);if(url.endsWith('/api/health'))return {ok:false,status:503};if(mode==='timeout')throw new DOMException('timeout','AbortError');return {ok:true,json:async()=>({billingMode:'disabled',newQuotesAvailable:false})};};
 w.eval(file('availability.js'));await tick();assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/api/availability'));assert.equal(w.document.getElementById('submitRepairBtn').disabled,true);assert.doesNotMatch(w.document.body.textContent,/accounts.*remain available|Accounts are available now|You can create an account or sign in to your existing history/i);assert.match(w.document.getElementById('availabilityNotice').textContent,/depend on service availability/);dom.window.close();
});
for(const signup of [false,true]) test('shared auth ownership freezes mode and prevents duplicate '+(signup?'signup':'sign-in'),async()=>{
 const dom=new JSDOM(file('login.html'),{url:'https://fixture.invalid/login.html'+(signup?'?role=owner':''),runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=0,reject,warning;
 w.setTimeout=fn=>{warning=fn;return 1;};w.clearTimeout=()=>{};
 w.smrSupabaseReady=true;w.smrSupabase={auth:{[signup?'signUp':'signInWithPassword']:()=>{calls++;return new Promise((a,b)=>reject=b);}}};w.eval(file('auth.js'));
 for(const [id,value] of Object.entries({name:'Synthetic',email:'synthetic@example.invalid',password:'SyntheticPassword123'}))d.getElementById(id).value=value;
 const button=d.getElementById(signup?'signUpBtn':'signInBtn');button.click();button.click();d.getElementById('authForm').dispatchEvent(new w.Event('submit',{cancelable:true}));d.getElementById('authModeBtn').click();assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(d.querySelector('.auth-actions').getAttribute('aria-busy'),'true');assert.equal(d.getElementById('signupFields').hidden,!signup);
 warning();assert.match(d.getElementById('authStatus').textContent,/Do not submit again/);assert.equal(button.disabled,true);assert.equal(calls,1);
 reject(new TypeError('network lost'));await tick();assert.equal(button.disabled,false);assert.equal(d.querySelector('.auth-actions').getAttribute('aria-busy'),'false');assert.match(d.getElementById('authStatus').textContent,/No automatic retry/);assert.equal(calls,1);dom.window.close();
});
for(const kind of ['Owner','Mechanic']) test('hosted '+kind+' metadata wins over stale cache and supports explicit clearing',async()=>{
 const dom=new JSDOM('',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;let metadata={name:'New on another device',email:'',city:'',state:'',zip:'10701'};
 w.smrSupabaseReady=true;w.smrSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'fixture',email:'login@example.invalid',user_metadata:{name:'Stale session',city:'Old'}}}}}),getUser:async()=>({data:{user:{id:'fixture',email:'login@example.invalid',user_metadata:metadata}}})}};
 w.localStorage.setItem('smr_'+(kind==='Owner'?'owner':'mechanic')+'_profile_fixture',JSON.stringify({name:'Stale cache',email:'old@example.invalid',city:'Old',state:'NY'}));w.eval(file('app-auth.js'));
 let p=await w.smrAuth['get'+kind+'Profile']();assert.equal(p.name,metadata.name);for(const key of ['email','city','state'])assert.equal(p[key],'');metadata={name:'Second device update'};p=await w.smrAuth['get'+kind+'Profile']();assert.equal(p.name,metadata.name);assert.equal(p.email,'login@example.invalid');
 w.smrSupabase.auth.getUser=async()=>({error:Error('offline')});await assert.rejects(w.smrAuth['get'+kind+'Profile'](),/offline/);dom.window.close();
});
for(const page of ['owner-app.html','mechanic.html'])test('profile fields retain visible labels and associated live validation: '+page,()=>{
 const dom=new JSDOM(file(page)),d=dom.window.document;
 for(const input of d.querySelectorAll('input[id^="profile"],textarea[id^="profile"]')){assert.ok(input.labels.length,input.id);assert.ok(input.labels[0].textContent.trim());const status=d.getElementById(input.getAttribute('aria-describedby'));assert.ok(status,input.id);assert.equal(status.getAttribute('role'),'status');if(input.tagName==='INPUT')assert.ok(input.autocomplete);}
 dom.window.close();
});
test('feedback uses labelled native modal, focus restoration, and selected rating semantics',()=>{
 const dom=new JSDOM(file('owner-app.html'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document,dialog=d.getElementById('feedbackModal');
 assert.equal(dialog.tagName,'DIALOG');assert.ok(d.getElementById(dialog.getAttribute('aria-labelledby')));assert.ok(d.getElementById('feedbackNote').labels.length);
 dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};
 w.eval(file('owner-app.js').replace('boot();','')+';window.setTestRating = value => { pendingFeedbackStars=value; syncFeedbackRating(); };');
 const opener=d.getElementById('saveProfileBtn');opener.focus();w.openFeedbackModal({requestId:1});assert.equal(dialog.open,true);assert.equal(d.activeElement.dataset.star,'1');
 w.setTestRating(4);assert.equal(d.querySelectorAll('[data-star][aria-pressed="true"]').length,1);assert.equal(d.querySelector('[aria-pressed="true"]').dataset.star,'4');w.closeFeedbackModal();assert.equal(dialog.open,false);assert.equal(d.activeElement,opener);
 assert.ok(file('owner-app.js').includes("addEventListener('cancel', event => { event.preventDefault(); closeFeedbackModal(); })"));dom.window.close();
});

test('closed native feedback is hidden despite legacy shared modal styles',()=>{
 assert.ok(file('dashboard-design.css').includes('dialog.feedback-modal:not([open]) { display: none; }'));
 assert.ok(file('dashboard-design.css').includes('dialog.feedback-modal[open] { display: block; }'));
});
test('availability API copy never promises dependency readiness',async()=>{
 const { BILLING_UNAVAILABLE }=await import('../lib/billing-mode.js');
 assert.match(BILLING_UNAVAILABLE,/depend on service availability/);
 assert.doesNotMatch(BILLING_UNAVAILABLE,/remain available/);
});
test('local-only dev profiles retain existing persistence behavior',async()=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.localStorage.setItem('smr_session',JSON.stringify({id:'fixture',name:'Session name',role:'shop'}));w.eval(file('app-auth.js'));
 await w.smrAuth.saveOwnerProfile({name:'Saved owner',email:'owner@example.invalid'});assert.equal((await w.smrAuth.getOwnerProfile()).name,'Saved owner');
 await w.smrAuth.saveMechanicProfile({name:'Saved shop',zip:'10701',serviceRadiusMiles:25});assert.equal((await w.smrAuth.getMechanicProfile()).name,'Saved shop');dom.window.close();
});

for(const signup of [false,true]) test('auth settlement supports explicit retry and confirmation: '+signup,async()=>{
 const dom=new JSDOM(file('login.html'),{url:'https://fixture.invalid/login.html'+(signup?'?role=owner':''),runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=0;
 w.smrSupabaseReady=true;w.smrSupabase={auth:{[signup?'signUp':'signInWithPassword']:async()=>{calls++;if(calls===1)throw Object.assign(Error('Controlled failure'),{status:400});return signup?{data:{user:{id:'fixture'},session:null}}:{error:Object.assign(Error('Explicit retry response'),{status:400})};}}};w.eval(file('auth.js'));
 for(const [id,value] of Object.entries({name:'Synthetic',email:'synthetic@example.invalid',password:'SyntheticPassword123'}))d.getElementById(id).value=value;
 const button=d.getElementById(signup?'signUpBtn':'signInBtn');button.click();await tick();assert.equal(calls,1);assert.equal(button.disabled,false);assert.match(d.getElementById('authStatus').textContent,/Controlled failure/);
 button.click();await tick();assert.equal(calls,2);assert.equal(button.disabled,false);assert.match(d.getElementById('authStatus').textContent,signup?/Check your email to confirm/:/Explicit retry response/);dom.window.close();
});
for(const kind of ['Owner','Mechanic'])test('hosted save-clear-reload and identity separation: '+kind,async()=>{
 const dom=new JSDOM('',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;let user={id:'a',email:'a@example.invalid',user_metadata:{name:'Before',city:'Old'}};
 w.smrSupabaseReady=true;w.smrSupabase={auth:{getSession:async()=>({data:{session:user?{user}:null}}),getUser:async()=>({data:{user}}),updateUser:async({data})=>{user.user_metadata={...user.user_metadata,...data};return{};}}};w.eval(file('app-auth.js'));
 await w.smrAuth['save'+kind+'Profile']({name:'',city:'',zip:'10701',serviceRadiusMiles:25});assert.equal((await w.smrAuth['get'+kind+'Profile']()).name,'');assert.equal((await w.smrAuth['get'+kind+'Profile']()).city,'');
 user.user_metadata.city=null;assert.equal((await w.smrAuth['get'+kind+'Profile']()).city,null);
 user=null;assert.equal(await w.smrAuth['get'+kind+'Profile'](),null);user={id:'b',email:'b@example.invalid',user_metadata:{name:'Second user'}};assert.equal((await w.smrAuth['get'+kind+'Profile']()).name,'Second user');assert.equal((await w.smrAuth['get'+kind+'Profile']()).city,'');dom.window.close();
});

test('feedback blank rating, pending duplicate prevention and cancellation retain ownership',async()=>{
 const dom=new JSDOM(file('owner-app.html'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=0,reject;const alerts=[];
 w.DOMPurify=createDOMPurify(w);w.alert=text=>alerts.push(text);w.smrAuth={requireRole:async()=>({id:'owner'}),logoutToLogin:()=>{}};
 const dialog=d.getElementById('feedbackModal');dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};
 w.eval(file('owner-app.js').replace('  async function loadProfile() {','  return;\n  async function loadProfile() {')+';recordFeedback = () => { window.testCalls(); return new Promise((resolve,reject) => {window.testReject=reject;}); };');w.testCalls=()=>calls++;await tick();
 w.openFeedbackModal({requestId:301,bidId:1,mechanicId:'shop'});d.getElementById('feedbackSubmitBtn').click();assert.equal(calls,0);assert.match(alerts[0],/select a star/);
 d.querySelector('[data-star="4"]').click();d.getElementById('feedbackSubmitBtn').click();d.getElementById('feedbackSubmitBtn').click();assert.equal(calls,1);dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,true);assert.equal(d.getElementById('feedbackSubmitBtn').disabled,true);
 w.testReject(Error('controlled failure'));await tick();assert.equal(d.getElementById('feedbackSubmitBtn').disabled,false);assert.equal(calls,1);dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,false);dom.window.close();
});

test('recovery pending warning retains ownership and transport failure warns of possible delivery',async()=>{
 const dom=new JSDOM(file('login.html'),{url:'https://fixture.invalid/login.html',runScripts:'outside-only'}),w=dom.window,d=w.document;let calls=0,warning,reject;
 w.setTimeout=fn=>{warning=fn;return 1;};w.clearTimeout=()=>{};
 w.smrSupabaseReady=true;w.smrSupabase={auth:{resetPasswordForEmail:()=>{calls++;return new Promise((a,b)=>reject=b);}}};w.eval(file('auth.js'));d.getElementById('email').value='synthetic@example.invalid';
 const button=d.getElementById('forgotPasswordBtn');button.click();assert.match(d.getElementById('authStatus').textContent,/Requesting a recovery email/);button.click();d.getElementById('authModeBtn').click();assert.equal(calls,1);assert.equal(d.getElementById('authModeBtn').disabled,true);
 warning();assert.match(d.getElementById('authStatus').textContent,/may already have been sent/);assert.equal(button.disabled,true);assert.equal(calls,1);
 reject(new TypeError('network lost'));await tick();assert.equal(button.disabled,false);assert.match(d.getElementById('authStatus').textContent,/may already have been sent/);assert.match(d.getElementById('authStatus').textContent,/No automatic retry/);assert.equal(calls,1);dom.window.close();
});
for(const [page,script,kind] of [['owner-app.html','owner-app.js','Owner'],['mechanic.html','mechanic.js','Mechanic']])for(const stateCase of ['null','empty','absent'])test(kind+' actual state field preserves hosted '+stateCase,async()=>{
 const dom=new JSDOM(file(page),{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const metadata=stateCase==='absent'?{}:{state:stateCase==='null'?null:''};
 w.smrSupabaseReady=true;w.smrSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'fixture',user_metadata:{state:'OLD'}}}}}),getUser:async()=>({data:{user:{id:'fixture',user_metadata:metadata}}})}};
 w.localStorage.setItem('smr_'+(kind==='Owner'?'owner':'mechanic')+'_profile_fixture',JSON.stringify({state:'OLD'}));w.eval(file('app-auth.js'));
 w.profile=await w.smrAuth['get'+kind+'Profile']();const assignment=file(script).split(String.fromCharCode(10)).find(line=>line.includes("getElementById('profileState').value ="));assert.ok(assignment);w.eval(assignment);assert.equal(d.getElementById('profileState').value,stateCase==='absent'?'NY':'');dom.window.close();
});
