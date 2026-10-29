import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';import createDOMPurify from 'dompurify';
test('canonical API shop type and completed repair render honestly across owner cards',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../public/owner-app.html',import.meta.url),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.DOMPurify=createDOMPurify(w);w.smrPhotos={button:()=>''};w.smrMessages={button:()=>''};w.smrWorkflow={button:()=>''};
 const source=fs.readFileSync(new URL('../public/owner-app.js',import.meta.url),'utf8').replace('boot();','');
 w.eval(source+`
 repairsCache=[{id:301,status:'completed',title:'Fixture repair',dispatch_summary:{totalBids:1}}];
 bidsByRequest=new Map([[301,[{id:1,request_id:301,mechanic_id:'shop',mechanic_name:'Fixture Garage',amount:375,eta_hours:24,status:'accepted',notes:'Clean API notes without legacy tags',provider:{type:'shop',businessName:'Fixture Garage'}}]]]);
 selectedRequestId=301;renderRequests();renderBids();
 `);
 assert.match(w.document.getElementById('ownerRequests').textContent,/Repair completed/);
 assert.doesNotMatch(w.document.getElementById('ownerRequests').textContent,/Quotes are arriving/);
 assert.equal(w.document.querySelectorAll('.provider-chip').length,2);
 for(const chip of w.document.querySelectorAll('.provider-chip'))assert.equal(chip.textContent,'Registered Repair Shop');
 assert.equal(w.document.querySelector('[data-accept]'),null);dom.window.close();
});
