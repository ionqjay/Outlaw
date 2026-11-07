import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const file=n=>readFileSync(new URL('../public/'+n,import.meta.url),'utf8');
for(const role of ['', 'owner','shop'])test('focused account journey: '+(role||'sign in'),()=>{
 const dom=new JSDOM(file('login.html'),{url:'https://fixture.invalid/login.html'+(role?'?role='+role:''),runScripts:'outside-only'});
 const w=dom.window,d=w.document;w.smrSupabaseReady=true;w.eval(file('auth.js'));
 assert.equal(d.getElementById('signupFields').hidden,!role);
 assert.equal(d.getElementById('signInBtn').hidden,!!role);
 assert.equal(d.getElementById('signUpBtn').hidden,!role);
 assert.equal(d.getElementById('specialtiesWrap').style.display,role==='shop'?'block':'none');
 assert.equal(d.getElementById('shopApplicationHint').hidden,role!=='shop');
 assert.equal(d.getElementById('password').autocomplete,role?'new-password':'current-password');
 d.getElementById('authForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.match(d.getElementById('authStatus').textContent,role?/Name, email, and password/:/Email and password/);
 d.getElementById('password').value='not-retained-on-mode-change';d.getElementById('authModeBtn').click();
 assert.equal(d.getElementById('password').value,'');
 assert.equal(d.getElementById('signupFields').hidden,!!role);
 assert.equal(d.activeElement.id,role?'email':'name');dom.window.close();
});
test('landing has one availability notice and concise owner journey',async()=>{
 const dom=new JSDOM(file('index.html'),{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({billingMode:'disabled'})});w.AbortController=AbortController;w.eval(file('availability.js'));await new Promise(r=>setTimeout(r,0));
 assert.equal(w.document.querySelectorAll('#availabilityNotice').length,1);
 assert.equal(w.document.querySelectorAll('#how li').length,3);
 assert.ok(w.document.querySelector('#owners'));assert.match(w.document.getElementById('availabilityNotice').textContent,/not open yet/);dom.window.close();
});
test('displayed shop plan is consistently 29.99 without changing billing entitlement code',()=>{
 for(const n of ['pricing.html','mechanic.html','mechanic.js']){assert.ok(file(n).includes('$29.99'));assert.ok(!file(n).includes('$99'));}
 assert.match(file('pricing.html'),/month/);assert.match(file('pricing.html'),/No subscription starts today/);
});
