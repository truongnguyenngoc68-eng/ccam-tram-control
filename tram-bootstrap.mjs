/**
 * @file Isolated Trạm launcher for the actual upstream CCAM application. Uses
 * upstream Express, SQLite and WebSocket modules without global registration,
 * transcript discovery, background import, hook installation or CLI linking.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';

export async function startTramMonitor({port=4820,dataDir,tokenFile}={}){
 const root=path.dirname(fileURLToPath(import.meta.url));
 const isolated=path.resolve(dataDir||process.env.DASHBOARD_DATA_DIR||path.join(root,'.tram-ccam'));
 const secretFile=tokenFile||process.env.DASHBOARD_TOKEN_FILE;
 if(!secretFile)throw Error('A server-only DASHBOARD_TOKEN_FILE is required.');
 const token=(await readFile(secretFile,'utf8')).trim();
 if(token.length<32)throw Error('Monitor token must contain at least 32 characters.');
 await mkdir(isolated,{recursive:true});
 process.env.DASHBOARD_DATA_DIR=isolated;
 process.env.DASHBOARD_TOKEN_FILE=path.resolve(secretFile);
 process.env.DASHBOARD_HOOK_TOKEN_FILE=path.resolve(secretFile);
 process.env.DASHBOARD_HOST='127.0.0.1';
 process.env.DASHBOARD_ENV_PATH=path.join(isolated,'monitor.env');
 process.env.CLAUDE_HOME=path.join(isolated,'claude-home');
 process.env.DASHBOARD_CODEX_HOME=path.join(isolated,'codex-home');
 process.env.DASHBOARD_TOKEN_REPAIR='0';
 process.env.NODE_ENV='production';
 const require=createRequire(import.meta.url);
 const express=require('express');
 const {createApp}=require('./server/index.js');
 const {initWebSocket,closeWebSocket}=require('./server/websocket.js');
 const app=express();
 // Trạm owns execution and account settings. This embedding is deliberately
 // observational; only the authenticated private job-event bridge may write.
 app.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.path!=='/api/tram/lifecycle')return res.status(403).json({error:{code:'TRAM_READ_ONLY',message:'This Trạm monitor is read-only. Manage jobs and settings from Trạm.'}});
  next();
 });
 app.use('/api/tram/lifecycle',express.json({limit:'16kb'}));
 app.post('/api/tram/lifecycle',(req,res)=>{
  const supplied=Buffer.from(String(req.headers['x-ccam-hook-token']||'')),expected=Buffer.from(token);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return res.status(401).json({error:{code:'EUNAUTHORIZED',message:'Invalid lifecycle token'}});
  const {job,phase}=req.body||{};
  if(!job||typeof job.id!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(job.id)||!['start','completed','failed','cancelled'].includes(phase))return res.status(400).json({error:{code:'INVALID_INPUT',message:'Invalid job lifecycle'}});
  const {ingestCodexHook}=require('./server/lib/codex-ingest.js');
  const {db,stmts}=require('./server/db.js');
  const {broadcast}=require('./server/websocket.js');
  const sessionId='tram-'+job.id;
  const data={session_id:sessionId,timestamp:new Date().toISOString(),model_provider:'openai',...(typeof job.dir==='string'?{cwd:job.dir.slice(0,2048)}:{}),...(typeof job.model==='string'?{model:job.model.slice(0,100)}:{})};
  for(const type of phase==='start'?['SessionStart','UserPromptSubmit']:['Stop','SessionEnd']){
   const result=ingestCodexHook(null,type,data);
   if(result?.session){broadcast(result.created?'session_created':'session_updated',result.session);if(result.agent)broadcast(result.created?'agent_created':'agent_updated',result.agent);for(const event of result.events||[])broadcast('new_event',event)}
  }
  if(phase==='failed'){
   const endedAt=new Date().toISOString();
   stmts.updateSession.run(null,'error',endedAt,null,sessionId);
   stmts.updateAgent.run(null,'error',null,null,endedAt,null,'codex:'+sessionId);
  }
  db.prepare("UPDATE sessions SET metadata=json_set(COALESCE(metadata,'{}'),'$.tram_state',?) WHERE id=?").run(phase,sessionId);
  const session=stmts.getSession.get(sessionId),agent=stmts.getAgent.get('codex:'+sessionId);
  if(session)broadcast('session_updated',session);if(agent)broadcast('agent_updated',agent);
  res.json({accepted:true});
 });
 app.use(createApp());
 const clientDist=path.join(root,'client','dist');
 app.use(express.static(clientDist,{index:false}));
 const shell=await readFile(path.join(clientDist,'index.html'),'utf8');
 const defaults='<script>try{if(!localStorage.getItem("i18nextLng"))localStorage.setItem("i18nextLng","vi");localStorage.setItem("provider-onboarding-shown-v2","1");if(!localStorage.getItem("ccam-data-scope"))localStorage.setItem("ccam-data-scope",JSON.stringify({mode:"local",selected:[],provider:"codex"}));document.documentElement.lang="vi";}catch{}</script>';
 app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:{code:'ENOTFOUND',message:'API route not found'}});
  res.setHeader('Cache-Control','no-store');
  res.type('html').send(shell.replace('<head>','<head>'+defaults));
 });
 const server=http.createServer(app);
 initWebSocket(server);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {server,port:server.address().port,dataDir:isolated,close:()=>new Promise(resolve=>{closeWebSocket();server.close(resolve)})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const monitor=await startTramMonitor({port:Number(process.env.DASHBOARD_PORT||4820)});
 console.log(`Trạm CCAM upstream monitor listening on loopback port ${monitor.port}; Vietnamese default; isolated data; background imports disabled.`);
 const close=()=>monitor.close().then(()=>process.exit(0));
 process.on('SIGINT',close);process.on('SIGTERM',close);
}
