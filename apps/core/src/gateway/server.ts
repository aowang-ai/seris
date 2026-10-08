import { realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { SerisRuntime } from '../runtime/serisRuntime.js';
import { mintBearerToken, verifyBearer, type BearerToken } from './token.js';
import { EventHub } from './events.js';
import { isApprovalMode, parsePrompt, PROTOCOL_VERSION } from '../protocol.js';
import { providerCatalog } from '../runtime/streamFactory.js';
import { detectLocalModels } from '../runtime/modelDiscovery.js';
import { getProactiveEngine } from '../proactive/engine.js';
import { getAutopilotEngine } from '../autopilot/engine.js';
import { marketRoute } from './markets.js';
import { getMarketService, type MarketService } from '../markets/service.js';

export interface GatewayOptions {runtime:SerisRuntime;staticRoot?:string;port?:number;devOrigin?:string;desktop?:boolean;markets?:MarketService}
export interface GatewayHandle {url:string;token:BearerToken;launchUrl:string;port:number;hub:EventHub;close():Promise<void>}
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
function sendJson(res:ServerResponse,status:number,data:unknown):void {
  if(res.headersSent)return void res.end();
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));
}
async function readBody(req:IncomingMessage):Promise<any>{
  const chunks:Buffer[]=[];let bytes=0;
  for await(const c of req){bytes+=c.length;if(bytes>1024*1024)throw new Error('Request body too large');chunks.push(c);}
  try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{throw new Error('Invalid JSON body');}
}
export async function startGateway(opts:GatewayOptions):Promise<GatewayHandle>{
  const {runtime}=opts;const token=mintBearerToken();const hub=new EventHub();const un=runtime.onEvent(e=>hub.publish(e));
  const ticket=randomBytes(24).toString('base64url');let ticketUsed=false;
  const cookieName='seris_session';
  const authed=(req:IncomingMessage)=>verifyBearer(req.headers.authorization,token)||req.headers.cookie?.split(';').some(c=>c.trim()===`${cookieName}=${token}`)===true;
  const started=Date.now();let origin='';
  const server=createServer((req,res)=>{void handle(req,res).catch(e=>sendJson(res,400,{error:e instanceof Error?e.message:String(e)}));});
  async function handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
    const host=req.headers.host??'';
    if(!/^((127\.0\.0\.1|localhost):\d+|\[::1\]:\d+)$/.test(host)||new URL(`http://${host}`).port!==new URL(origin).port){sendJson(res,403,{error:'Invalid Host'});return;}
    const requestOrigin=req.headers.origin;
    if(requestOrigin&&requestOrigin!==origin&&requestOrigin!==opts.devOrigin&&!(opts.desktop&&['tauri://localhost','http://tauri.localhost','https://tauri.localhost'].includes(requestOrigin))){sendJson(res,403,{error:'Origin not allowed'});return;}
    if(requestOrigin&&requestOrigin!==origin){res.setHeader('access-control-allow-origin',requestOrigin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-credentials','true');}
    res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
    const url=new URL(req.url??'/',origin),path=url.pathname,method=req.method??'GET';
    if(method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, last-event-id'});res.end();return;}
    if(path==='/healthz'){sendJson(res,200,{ok:true,...hub.cursor(),state:runtime.configured?'ready':'needs-config',credentials:{storage:runtime.modelConfig().credentialStorage,available:!runtime.modelConfig().credentialError}});return;}
    // One-use shell bootstrap. It sets an HttpOnly cookie; no bearer is put in HTML or SSE URLs.
    if(path==='/api/bootstrap'&&method==='POST'){
      const body=await readBody(req);
      if(ticketUsed||body.ticket!==ticket){sendJson(res,401,{error:'Invalid or used startup ticket'});return;}
      ticketUsed=true;res.setHeader('set-cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      sendJson(res,200,{ok:true,token});return;
    }
    if(path.startsWith('/api/')&&!authed(req)){sendJson(res,401,{error:'Authentication required'});return;}
    if(path==='/api/events'&&method==='GET'){
      const value=url.searchParams.get('after')??req.headers['last-event-id'];
      const since=value===null||value===undefined?undefined:Number(value);
      if(since!==undefined&&(!Number.isSafeInteger(since)||since<0)){sendJson(res,400,{error:'Invalid cursor'});return;}
      hub.subscribe(res,since,url.searchParams.get('epoch')??undefined);return;
    }
    if(path==='/api/app-info'){sendJson(res,200,{name:'Seris',product:'personal trading workbench',protocolVersion:PROTOCOL_VERSION});return;}
    if(path.startsWith('/api/markets/')){sendJson(res,200,await marketRoute(path,method,url,()=>readBody(req),opts.markets));return;}
    if(path.startsWith('/api/strategies/')){
      const {strategyRoute}=await import('./strategies.js');
      sendJson(res,200,await strategyRoute(path,method,url,()=>readBody(req)));return;
    }
    if(path==='/api/config'&&method==='GET'){sendJson(res,200,runtime.modelConfig());return;}
    if(path==='/api/config/providers'&&method==='GET'){sendJson(res,200,providerCatalog());return;}
    if(path==='/api/config/local-models'&&method==='GET'){sendJson(res,200,await detectLocalModels());return;}
    if(path==='/api/config/discover'&&method==='POST'){sendJson(res,200,await runtime.discoverModels(await readBody(req)));return;}
    if(method==='POST'&&['/api/config/connections','/api/config/select','/api/config/remove','/api/config/test'].includes(path)){
      const body=await readBody(req);
      const action=path.endsWith('/connections')?'save':path.endsWith('/select')?'select':path.endsWith('/remove')?'remove':'test';
      sendJson(res,200,await runtime.updateModelSettings(action,action==='save'||action==='select'?body:body.id));return;
    }
    if(path==='/api/approvals'&&method==='GET'){sendJson(res,200,{tools:runtime.approvals.list(),goals:getProactiveEngine().listApprovals()});return;}
    if(path==='/api/approvals'&&method==='POST'){
      const body=await readBody(req);
      if(typeof body.id!=='string'||!['approve','reject'].includes(body.decision)||!['tool','goal'].includes(body.kind))throw new Error('Invalid approval decision');
      if(body.kind==='tool'){
        if(typeof body.runId!=='string')throw new Error('runId is required');
        runtime.approvals.decide(body.id,body.runId,body.decision==='approve');
      }else{
        const engine=getProactiveEngine();
        if(body.decision==='approve')await engine.approve(body.id,{decidedBy:'user'});else engine.reject(body.id,{decidedBy:'user'});
      }
      sendJson(res,200,{ok:true});return;
    }
    if(path==='/api/sessions'&&method==='GET'){sendJson(res,200,await runtime.listSessions());return;}
    if(path==='/api/sessions'&&method==='POST'){sendJson(res,201,await runtime.createSession());return;}
    const m=/^\/api\/sessions\/([A-Za-z0-9_-]+)\/(history|snapshot|prompt|abort|approval-mode)$/.exec(path);
    if(m){
      const [,id,action]=m;
      if(action==='history'&&method==='GET'){sendJson(res,200,await runtime.sessionHistory(id));return;}
      if(action==='snapshot'&&method==='GET'){sendJson(res,200,await runtime.snapshot(id,()=>hub.cursor()));return;}
      if(action==='approval-mode'&&method==='POST'){
        const body=await readBody(req);
        if(!isApprovalMode(body.mode))throw new Error('Invalid approval mode');
        sendJson(res,200,await runtime.setApprovalMode(id,body.mode));return;
      }
      if(action==='prompt'&&method==='POST'){
        if(!runtime.configured){sendJson(res,409,{error:'Configure the model first'});return;}
        const body=parsePrompt(await readBody(req));
        await runtime.sessionHistory(id); // reject unknown sessions before accepting
        try{const run=runtime.startPrompt(id,body.text,{requestId:body.requestId,...(body.marketContext?{marketContext:(opts.markets??getMarketService()).capture(body.marketContext)}:{})});sendJson(res,202,{accepted:true,sessionId:id,runId:run.id});}
        catch(e){sendJson(res,409,{error:e instanceof Error?e.message:String(e)});}return;
      }
      if(action==='abort'&&method==='POST'){runtime.abort(id);sendJson(res,200,{aborted:true});return;}
    }
    if(path.startsWith('/api/')){sendJson(res,404,{error:'No such route'});return;}
    if(method!=='GET'||!opts.staticRoot){sendJson(res,404,{error:'Not found'});return;}
    const root=resolve(opts.staticRoot);
    const file=resolve(root,`.${decodeURIComponent(path==='/'?'/index.html':path)}`);
    const rel=relative(root,file);
    if(rel==='..'||rel.startsWith('../')||isAbsolute(rel)){sendJson(res,403,{error:'Forbidden path'});return;}
    let target=file;
    try{if(!(await stat(target)).isFile())target=join(root,'index.html');}catch{target=join(root,'index.html');}
    // Static HTML is public but carries no credentials. API access still needs bootstrap or bearer.
    const nonce=randomBytes(16).toString('base64');
    let content=await readFile(target);
    if(extname(target)==='.html'){
      const script=`<script nonce="${nonce}">const u=new URL(location.href);window.__SERIS_TICKET__=u.searchParams.get('ticket');u.searchParams.delete('ticket');history.replaceState(null,'',u);</script>`;
      content=Buffer.from(content.toString('utf8').replace('</head>',`${script}</head>`));
      res.setHeader('content-security-policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
    }
    res.writeHead(200,{'content-type':MIME[extname(target)]??'application/octet-stream','cache-control':'no-store'});res.end(content);
  }
  const port=await new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(opts.port??0,'127.0.0.1',()=>{const addr=server.address();if(addr&&typeof addr==='object')resolve(addr.port);else reject(new Error('No listen address'));});});
  origin=`http://127.0.0.1:${port}`;
  return {url:origin,token,launchUrl:`${origin}/?ticket=${ticket}`,port,hub,close:()=>new Promise(resolve=>{un();hub.close();server.close(()=>resolve());server.closeAllConnections();})};
}
const direct=process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href;
if(direct){
  const {createSerisRuntime}=await import('../runtime/createSerisRuntime.js');
  const {dataRoot,workspaceRoot}=await import('../runtime/paths.js');
  const here=fileURLToPath(new URL('.',import.meta.url));
  const staticRoot=process.env.SERIS_STATIC_ROOT?.trim()||join(here,'..','..','..','desktop-ui','dist');
  const runtime=await createSerisRuntime({sessionsRoot:join(dataRoot(),'sessions'),cwd:workspaceRoot()});
  const gw=await startGateway({runtime,staticRoot,port:Number(process.env.SERIS_PORT??0),devOrigin:process.env.SERIS_DEV_ORIGIN,desktop:process.env.SERIS_MANAGED==='1'});
  process.stdout.write(`seris ready at ${process.env.SERIS_MANAGED==='1'?JSON.stringify({url:gw.url,token:gw.token}):gw.launchUrl}\n`);
  let closing=false;
  const shutdown=async()=>{
    if(closing)return;closing=true;const deadline=setTimeout(()=>process.exit(1),5000);deadline.unref();
    getAutopilotEngine().stop();await runtime.dispose();await gw.close();process.exit(0);
  };
  process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
  // Parent closes stdin on exit. This works on platforms without POSIX signals too.
  if(process.env.SERIS_MANAGED==='1'){process.stdin.resume();process.stdin.on('end',()=>void shutdown());}
}
