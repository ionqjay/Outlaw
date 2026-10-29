import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
test('owner malformed contacts never overwrite saved profile; valid optional fields remain supported',async()=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.localStorage.setItem('smr_session',JSON.stringify({id:'fixture',role:'owner'}));
 w.eval(fs.readFileSync(new URL('../public/app-auth.js',import.meta.url),'utf8'));
 const valid={name:'Synthetic Owner',email:'owner@example.invalid',zip:'10701',state:'ny'};
 await w.smrAuth.saveOwnerProfile(valid);const saved=w.localStorage.getItem('smr_owner_profile_fixture');
 for(const invalid of [{email:'not-an-email'},{zip:'abc'},{state:'New York'},{name:'a'.repeat(121)}]){
 await assert.rejects(w.smrAuth.saveOwnerProfile({...valid,...invalid}));assert.equal(w.localStorage.getItem('smr_owner_profile_fixture'),saved);
 }
 assert.equal(JSON.parse(saved).state,'NY');await w.smrAuth.saveOwnerProfile({name:'Owner'});dom.window.close();
});
test('shop invalid ZIP and radius never persist',async()=>{
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;w.localStorage.setItem('smr_session',JSON.stringify({id:'fixture',role:'shop'}));w.eval(fs.readFileSync(new URL('../public/app-auth.js',import.meta.url),'utf8'));
 for(const profile of [{zip:'abc',serviceRadiusMiles:25},{zip:'10701',serviceRadiusMiles:101}])await assert.rejects(w.smrAuth.saveMechanicProfile(profile));
 assert.equal(w.localStorage.getItem('smr_mechanic_profile_fixture'),null);await w.smrAuth.saveMechanicProfile({zip:'10701',serviceRadiusMiles:25});assert.ok(w.localStorage.getItem('smr_mechanic_profile_fixture'));dom.window.close();
});
