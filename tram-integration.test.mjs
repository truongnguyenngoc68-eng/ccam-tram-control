/**
 * @file Integration checks for Trạm's isolated upstream CCAM wrapper and
 * private metadata-only lifecycle bridge. All storage is temporary test data.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {startTramMonitor} from './tram-bootstrap.mjs';
import {jobHookEvents,sendJobLifecycle} from './tram-bridge.mjs';

test('isolated upstream serves Vietnamese shell, protects data, and ingests only explicit lifecycle metadata',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tram-ccam-test-')),tokenFile=path.join(dir,'token');
 const token=randomBytes(32).toString('hex');await writeFile(tokenFile,token);
 const monitor=await startTramMonitor({port:0,dataDir:path.join(dir,'data'),tokenFile});
 const baseURL='http://127.0.0.1:'+monitor.port;
 try{
  assert.equal((await fetch(baseURL+'/api/health')).status,200);
  assert.equal((await fetch(baseURL+'/api/sessions')).status,401);
  const authenticated=await fetch(baseURL+'/api/sessions',{headers:{'x-dashboard-token':token}});assert.equal(authenticated.status,200);
  const html=await(await fetch(baseURL+'/')).text();assert.match(html,/i18nextLng/);assert.match(html,/'vi'|"vi"/);assert.equal(html.includes(token),false);
  assert.equal((await fetch(baseURL+'/api/settings/install-hooks',{method:'POST',headers:{'x-dashboard-token':token,'Content-Type':'application/json'},body:'{}'})).status,403);
  const job={id:'test-tram-job',dir:path.join(dir,'job'),task:'PRIVATE TASK',output:'PRIVATE SOURCE'};
  const events=jobHookEvents(job,'start');assert.equal(events.length,2);assert.equal(JSON.stringify(events).includes('PRIVATE'),false);
  await sendJobLifecycle(job,'start',{baseURL,tokenFile});
  let sessions=[];for(let i=0;i<20;i++){const response=await fetch(baseURL+'/api/sessions',{headers:{'x-dashboard-token':token}});const value=await response.json();sessions=Array.isArray(value)?value:value.sessions||[];if(sessions.some(s=>s.id==='tram-test-tram-job'))break;await new Promise(resolve=>setTimeout(resolve,25))}
  assert.equal(sessions.some(s=>s.id==='tram-test-tram-job'),true);
  await sendJobLifecycle(job,'completed',{baseURL,tokenFile});
  const completed=await(await fetch(baseURL+'/api/sessions',{headers:{'x-dashboard-token':token}})).json();
  assert.equal((Array.isArray(completed)?completed:completed.sessions).find(s=>s.id==='tram-test-tram-job').status,'completed');
  await sendJobLifecycle({...job,id:'test-failure'},'start',{baseURL,tokenFile});
  await sendJobLifecycle({...job,id:'test-failure'},'failed',{baseURL,tokenFile});
  const failed=await(await fetch(baseURL+'/api/sessions',{headers:{'x-dashboard-token':token}})).json();
  assert.equal((Array.isArray(failed)?failed:failed.sessions).find(s=>s.id==='tram-test-failure').status,'error');
 }finally{await monitor.close()}
});
