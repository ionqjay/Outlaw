import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

test('maintenance subprocess is fail-closed across methods and raw paths', async () => {
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',RENDER_GIT_COMMIT:'bridge-test-build'},stdio:['ignore','pipe','pipe']});
 try {
  const started=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.once('data',x=>{clearTimeout(timer);resolve(JSON.parse(String(x)));});child.once('exit',()=>reject(Error('early exit')));});
  assert.equal(started.maintenance,true); assert.equal(started.build,'bridge-test-build');
  const request=(method,path,extra='')=>new Promise((resolve,reject)=>{const socket=net.connect(started.port,'127.0.0.1');let data='';socket.setTimeout(3000,()=>socket.destroy(Error('timeout')));socket.on('connect',()=>socket.write(method+' '+path+' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n'+extra+'\r\n'));socket.on('data',x=>data+=x);socket.on('end',()=>resolve(data));socket.on('error',reject);});
  let checked=0;
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','TRACE','CONNECT']) {
   for(const path of ['/api/health','/api/health?probe=1','/','/api/checkout','/api/repairs','/api/health/','//api/health','/x/../api/health','/%61pi/health','/api/health%3f','/%ZZ','http://localhost/api/health']) {
    const response=await request(method,path);const ready=['GET','HEAD'].includes(method)&&['/api/health','/api/health?probe=1'].includes(path);
    assert.match(response,new RegExp('^HTTP/1.1 '+(ready?200:503)));assert.match(response,/cache-control: no-store/i);assert.match(response,/retry-after: 120/i);
    if(method==='HEAD')assert.equal(response.split('\r\n\r\n')[1],'');
    if(ready&&method==='GET'){const body=JSON.parse(response.split('\r\n\r\n')[1].split('\r\n')[1]);assert.equal(body.maintenance,true);assert.equal(body.build,'bridge-test-build');}
    checked++;
   }
  }
  assert.match(await request('POST','/api/checkout','Expect: 100-continue\r\nContent-Length: 10\r\n'),new RegExp('^HTTP/1.1 503'));
  assert.match(await request('GET','/','Upgrade: websocket\r\n'),new RegExp('^HTTP/1.1 503'));
  console.log('Verified '+checked+' method/path cases plus expect/upgrade; no original app imports.');
 }finally{child.kill('SIGTERM');}
});
