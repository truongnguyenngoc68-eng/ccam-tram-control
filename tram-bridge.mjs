/**
 * @file Private lifecycle bridge from explicitly selected Trạm jobs into the
 * actual upstream Codex hook ingestion API. No native hooks are installed and
 * no prompt, attachment or generated source content is forwarded by default.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import {readFile} from 'node:fs/promises';

export function jobHookEvents(job,phase){
 if(!job||typeof job.id!=='string'||!job.id||!['start','completed','failed','cancelled'].includes(phase))throw Error('Invalid Trạm job lifecycle event.');
 const data={session_id:'tram-'+job.id,cwd:typeof job.dir==='string'?job.dir:undefined,model:typeof job.model==='string'?job.model:undefined,model_provider:'openai',timestamp:new Date().toISOString()};
 return (phase==='start'?['SessionStart','UserPromptSubmit']:phase==='failed'?['PostToolUseFailure','SessionEnd']:['Stop','SessionEnd']).map(hook_type=>({hook_type,data:{...data,...(phase==='failed'?{error:'Trạm job did not complete'}:{})}}));
}

export async function sendJobLifecycle(job,phase,{baseURL='http://127.0.0.1:4820',tokenFile=process.env.DASHBOARD_TOKEN_FILE,fetchImpl=fetch}={}){
 const endpoint=new URL(baseURL);
 if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('Monitor bridge must target loopback HTTP.');
 if(!tokenFile)throw Error('A server-only monitor token file is required.');
 const token=(await readFile(tokenFile,'utf8')).trim();
 jobHookEvents(job,phase);
 const response=await fetchImpl(new URL('/api/tram/lifecycle',endpoint),{method:'POST',headers:{'Content-Type':'application/json','x-ccam-hook-token':token},body:JSON.stringify({phase,job:{id:job.id,dir:job.dir,model:job.model}}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('Monitor lifecycle delivery failed.');
 return {accepted:true};
}
