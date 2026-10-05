import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { AssistantMessageEventStream } = await import('@earendil-works/pi-ai');
const {SerisRuntime}=await import('../dist/runtime/serisRuntime.js');
const {ToolRegistry,defineTool,fetchJson}=await import('../dist/tools/registry.js');
const {toolContext}=await import('../dist/runtime/toolContext.js');
const {startGateway}=await import('../dist/gateway/server.js');
const {EventHub}=await import('../dist/gateway/events.js');
const {compactIfNeeded}=await import('../dist/compaction/compactor.js');
const {terminalTool,executeCodeTool}=await import('../dist/tools/exec.js');
const {createSerisRuntime}=await import('../dist/runtime/createSerisRuntime.js');
const {MemoryStore}=await import('../dist/memory/store.js');
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const model={id:'fixture',provider:'fixture',api:'anthropic-messages',contextWindow:200000,maxTokens:8192};
const message=(content,stopReason='stop')=>({role:'assistant',content,api:'anthropic-messages',provider:'fixture',model:'fixture',usage,stopReason,timestamp:Date.now()});
const models=(responses)=>({streamSimple(){const s=new AssistantMessageEventStream();const m=responses.shift()??message([{type:'text',text:'Done'}]);s.push(m.stopReason==='error'?{type:'error',reason:'error',error:m}:{type:'done',reason:m.stopReason,message:m});return s;}});
async function fixture(t,responses=[],tools=new ToolRegistry()){
 const dir=await mkdtemp(join(tmpdir(),'seris-test-'));process.env.SERIS_DATA_DIR=dir;process.env.SERIS_WORKSPACE=join(dir,'workspace');
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const deps={models:models(responses),model,tools,skills:{},buildSystemPrompt:async()=> 'Fixture',sessionsRoot:join(dir,'sessions'),cwd:join(dir,'workspace')};
 const runtime=new SerisRuntime(deps);await runtime.init();t.after(()=>runtime.dispose());
 return {dir,runtime,deps};
}
const toolCall=(name='fixture_read')=>message([{type:'toolCall',id:'call-1',name,arguments:{}}],'toolUse');
const eventually=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out waiting for condition');};

test('full transcript, stable IDs, request idempotency and reload',async t=>{
 let executions=0;const tools=new ToolRegistry().register(defineTool({name:'fixture_read',category:'market-data',description:'fixture',parameters:{type:'object',properties:{}},execute(){executions++;return {observation:'value'};}}));
 const {runtime,deps}=await fixture(t,[toolCall(),message([{type:'text',text:'Final'}])],tools);const session=await runtime.createSession();
 const events=[];runtime.onEvent(e=>events.push(e));
 await runtime.prompt(session.id,'Read',{requestId:'request-0001'});assert.equal(executions,1);
 const history=await runtime.sessionHistory(session.id);assert.deepEqual(history.map(m=>m.role),['user','assistant','tool','assistant']);assert.equal(history[2].toolCallId,'call-1');
 assert.deepEqual(history.map(m=>m.id),events.filter(e=>e.type==='message').map(e=>e.message.id));
 await runtime.prompt(session.id,'Read',{requestId:'request-0001'});assert.equal(executions,1);
 assert.throws(()=>runtime.startPrompt(session.id,'Other',{requestId:'request-0001'}),/different prompt/);
 const restored=new SerisRuntime(deps);await restored.init();t.after(()=>restored.dispose());assert.deepEqual(await restored.sessionHistory(session.id),history);
 assert.equal(restored.runState(session.id).status,'completed');
});
test('pi 1.x JSONL store preserves paginated history, chat isolation and metadata across reopen',async t=>{
 const {dir}=await fixture(t);
 const {SessionStore}=await import('../dist/runtime/sessionStore.js');
 const path=join(dir,'paged-sessions');const store=await SessionStore.open(path);t.after(()=>store.close());
 const sessions=await Promise.all(Array.from({length:105},()=>store.create()));
 assert.equal(new Set(sessions.map(s=>s.id)).size,105);
 const selected=sessions[0];const texts=Array.from({length:105},(_,i)=>`Message ${i}`);
 await Promise.all(texts.map((content,i)=>store.append(selected.id,{role:'user',content,timestamp:i,serisId:`message-${i}`})));
 await store.append(sessions[1].id,{role:'user',content:'Other chat',timestamp:1});
 await store.setName(selected.id,'Paged conversation');
 await assert.rejects(store.entries('missing'),/Unknown session/);
 await assert.rejects(store.entries('99999999'),/Unknown session/);
 await assert.rejects(store.append('01',{role:'user',content:'Invalid alias',timestamp:1}),/Unknown session/);
 await store.close();
 const reopened=await SessionStore.open(path);t.after(()=>reopened.close());
 const listed=await reopened.list();assert.equal(listed.length,105);
 const meta=listed.find(s=>s.id===selected.id);assert.equal(meta.name,'Paged conversation');
 assert.equal(meta.createdAt,selected.createdAt);assert.ok(meta.modifiedAt>=selected.modifiedAt);
 const entries=await reopened.entries(selected.id);assert.deepEqual(entries.map(e=>e.message.content),texts);
 assert.deepEqual(entries.map(e=>e.message.serisId),texts.map((_,i)=>`message-${i}`));
 assert.deepEqual((await reopened.entries(sessions[1].id)).map(e=>e.message.content),['Other chat']);
 const created=await reopened.create();assert.ok(!sessions.some(s=>s.id===created.id),'IDs must remain unique after reopening');
});
test('provider errors and context failures have failed terminal state',async t=>{
 const {runtime,deps}=await fixture(t,[{...message([],'error'),errorMessage:'provider failed'}]);const session=await runtime.createSession();const events=[];runtime.onEvent(e=>events.push(e));await runtime.prompt(session.id,'Fail');
 assert.equal(runtime.runState(session.id).status,'failed');assert.equal(events.at(-1).error,'provider failed');assert.equal((await runtime.sessionHistory(session.id))[0].text,'Fail');
 deps.model={...model,contextWindow:100};await runtime.prompt(session.id,'Too large');assert.match(runtime.runState(session.id).error,/context budget/);
});
test('approval cannot execute before UI decision, binds run and cancels',async t=>{
 let executions=0;const tools=new ToolRegistry().register(defineTool({name:'terminal',category:'workspace',description:'fixture',parameters:{type:'object',properties:{}},execute(){executions++;return {ok:true};}}));
 const {runtime}=await fixture(t,[toolCall('terminal'),message([{type:'text',text:'Done'}]),toolCall('terminal')],tools);const session=await runtime.createSession();
 const run=runtime.startPrompt(session.id,'Execute',{requestId:'approve-001'});await eventually(()=>runtime.approvals.list().length===1);const pending=runtime.approvals.list()[0];assert.equal(executions,0);
 assert.throws(()=>runtime.approvals.decide(pending.id,'wrong',true),/another run/);
 runtime.approvals.decide(pending.id,run.id,true);await run.done;assert.equal(executions,1);assert.equal(runtime.approvals.list().length,0);
 const cancelled=runtime.startPrompt(session.id,'Cancel',{requestId:'approve-002'});await eventually(()=>runtime.approvals.list().length===1);cancelled.abort();await cancelled.done;
 assert.equal(executions,1);assert.equal(runtime.runState(session.id).status,'cancelled');assert.equal(runtime.approvals.list().length,0);
});
test('bundled skills only advertise tools provided by the runtime', async () => {
 const {buildRegistry}=await import('../dist/runtime/toolLoader.js');
 const {SkillRegistry}=await import('../dist/skills/registry.js');
 const {fileURLToPath}=await import('node:url');
 const tools=buildRegistry();
 const skills=await SkillRegistry.load(fileURLToPath(new URL('../skills/',import.meta.url)));
 assert.ok(skills.size>0);
 for(const skill of skills.catalog()) {
  for(const name of skill.toolNames) assert.ok(tools.has(name),`${skill.name} advertises missing tool ${name}`);
 }
});
test('Seris wallet tool names retain UI approval before returning simulated transfers', async t => {
 const {buildRegistry}=await import('../dist/runtime/toolLoader.js');
 const tools=buildRegistry();
 const names=['seris_wallet_fund_perp','seris_wallet_withdraw_to_spot'];
 const responses=names.flatMap(name=>[message([{type:'toolCall',id:name,name,arguments:{walletId:'perp_wallet_main',amountUsd:10}}],'toolUse'),message([{type:'text',text:'Simulated only'}])]);
 const {runtime}=await fixture(t,responses,tools);
 const session=await runtime.createSession();
 for(const name of names) {
  const run=runtime.startPrompt(session.id,'Preview a simulated transfer');
  await eventually(()=>runtime.approvals.list().length===1);
  const approval=runtime.approvals.list()[0];
  assert.equal(approval.toolName,name);
  assert.equal(runtime.runState(session.id).status,'awaiting-approval');
  const before=await runtime.sessionHistory(session.id);
  assert.equal(before.some(m=>m.role==='tool' && m.toolCallId===name && !m.pending),false);
  runtime.approvals.decide(approval.id,run.id,true);
  await run.done;
  assert.equal(runtime.runState(session.id).status,'completed');
  const result=(await runtime.sessionHistory(session.id)).find(m=>m.role==='tool' && m.toolCallId===name);
  assert.equal(JSON.parse(result.text).simulatedReceipt.status,'simulated');
 }
});
test('repeated old request does not return or cancel a newer run',async t=>{
 const tools=new ToolRegistry().register(defineTool({name:'terminal',category:'workspace',description:'fixture',parameters:{type:'object',properties:{}},execute:()=>({ok:true})}));
 const {runtime}=await fixture(t,[message([{type:'text',text:'first'}]),toolCall('terminal')],tools);const s=await runtime.createSession();const now=Date.now();
 const accept=(text,requestId)=>{const clock=Date.now;Date.now=()=>now;try{return runtime.startPrompt(s.id,text,{requestId});}finally{Date.now=clock;}};
 await accept('First','old-id-001').done;
 const current=accept('Second','new-id-001');await eventually(()=>runtime.approvals.list().length===1);const old=runtime.startPrompt(s.id,'First',{requestId:'old-id-001'});assert.equal(old.id,'old-id-001');old.abort();assert.equal(runtime.runState(s.id).status,'awaiting-approval');current.abort();await current.done;
});
test('service restart marks unfinished runs interrupted',async t=>{
 const {runtime,deps,dir}=await fixture(t);const s=await runtime.createSession();await writeFile(join(dir,'.data','runs.json'),JSON.stringify({orphan:{id:'orphan',sessionId:s.id,status:'running',startedAt:1}}));const restored=new SerisRuntime(deps);await restored.init();t.after(()=>restored.dispose());assert.equal(restored.runState(s.id).status,'interrupted');
});
class Response extends EventEmitter {
 frames=[];destroyed=false;blocked=false;
 writeHead(){} write(s){this.frames.push(s);return !this.blocked;}destroy(){this.destroyed=true;this.emit('close');}end(){this.emit('close');}
}
test('SSE announces ring gaps and epochs, bounds slow client output',()=>{
 const hub=new EventHub();for(let i=0;i<4100;i++)hub.publish({type:'turn-end',runId:'run',sessionId:'s'});
 for(const [seq,epoch,type] of [[1,hub.epoch,'resync-required'],[4100,'old','resync-required'],[4099,hub.epoch,'stream-ready']]){const res=new Response();hub.subscribe(res,seq,epoch);assert.match(res.frames[0],new RegExp(type));if(type==='stream-ready')assert.match(res.frames[1],/id: 4100/);res.end();}
 const slow=new Response();slow.blocked=true;hub.subscribe(slow);for(let i=0;i<110;i++)hub.publish({type:'text-delta',runId:'r',sessionId:'s',messageId:'m',delta:'x'.repeat(12000)});assert.equal(slow.destroyed,true);hub.close();
});
const raw=(url,headers={})=>new Promise((resolve,reject)=>{const req=request(url,{headers},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
test('gateway host/origin/auth/bootstrap and atomic snapshots',async t=>{
 const {runtime,dir}=await fixture(t);const staticRoot=join(dir,'spa');await mkdir(staticRoot);await writeFile(join(staticRoot,'index.html'),'<html><head></head><body>fixture</body></html>');
 const gw=await startGateway({runtime,staticRoot,devOrigin:'http://localhost:5173'});t.after(()=>gw.close());const headers={authorization:`Bearer ${gw.token}`,'content-type':'application/json'};
 assert.equal((await raw(gw.url+'/',{host:'audit.invalid'})).status,403);
 assert.equal((await raw(gw.url+'/api/sessions',{...headers,origin:'https://evil.invalid'})).status,403);
 const page=await raw(gw.url+'/');assert.equal(page.status,200);assert.equal(page.body.includes(gw.token),false);assert.ok(page.headers['content-security-policy']);
 assert.equal((await fetch(gw.url+'/api/sessions?token='+gw.token)).status,401);
 const ticket=new URL(gw.launchUrl).searchParams.get('ticket');const boot=await fetch(gw.url+'/api/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});assert.equal(boot.status,200);assert.match(boot.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal((await fetch(gw.url+'/api/bootstrap',{method:'POST',headers,body:JSON.stringify({ticket})})).status,401);
 const s=await (await fetch(gw.url+'/api/sessions',{method:'POST',headers})).json();
 assert.equal((await fetch(`${gw.url}/api/sessions/${s.id}/prompt`,{method:'POST',headers,body:JSON.stringify({text:'No ID'})})).status,400);
 const accepted=await fetch(`${gw.url}/api/sessions/${s.id}/prompt`,{method:'POST',headers,body:JSON.stringify({text:'Hello',requestId:'gateway-001'})});assert.equal(accepted.status,202);await eventually(()=>runtime.runState(s.id)?.status==='completed');
 const snapshot=await (await fetch(`${gw.url}/api/sessions/${s.id}/snapshot`,{headers})).json();assert.equal(snapshot.epoch,gw.hub.epoch);assert.equal(snapshot.seq,gw.hub.lastSeq);assert.equal(snapshot.run.status,'completed');assert.equal(snapshot.messages.length,2);
 assert.equal((await raw(gw.url+'/%E0%A4%A')).status,400);
});
test('empty configuration boots, key fallback and live installed skill reload',async t=>{
 const {dir}=await fixture(t);delete process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_AUTH_TOKEN;process.env.ANTHROPIC_BASE_URL='';process.env.ANTHROPIC_MODEL='';process.env.ANTHROPIC_DEFAULT_SONNET_MODEL='';
 const runtime=await createSerisRuntime({sessionsRoot:join(dir,'config-sessions')});t.after(()=>runtime.dispose());assert.equal(runtime.configured,false);
 const {ModelSettings}=await import('../dist/runtime/modelSettings.js');const settings=new ModelSettings(join(dir,'env-models.json'),undefined,{ANTHROPIC_API_KEY:' fixture-key '});await settings.init();assert.equal(settings.config().configured,true);
 const {SkillRegistry}=await import('../dist/skills/registry.js');const skills=await SkillRegistry.load(join(dir,'builtins'),[join(dir,'skills')]);await mkdir(join(dir,'skills/installed/fixture'),{recursive:true});await writeFile(join(dir,'skills/installed/fixture/SKILL.md'),'---\nname: fixture\ndescription: Test\n---\nUnique instructions');await skills.reload([join(dir,'skills')]);assert.equal((await skills.dispatch('fixture')).body.trim(),'Unique instructions');
 const {proactiveApprovalsTool}=await import('../dist/tools/proactive.js');assert.equal(proactiveApprovalsTool.parameters.properties.decision,undefined);
});
test('compaction reload preserves summary, budget, and complete tool pairs',async t=>{
 await fixture(t);const ms=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:`RAW-${i}-`+'x'.repeat(400),timestamp:i}));
 const first=await compactIfNeeded({sessionId:'compact',messages:ms,windowTokens:700,keepRecentTurns:2});const second=await compactIfNeeded({sessionId:'compact',messages:ms,windowTokens:700,keepRecentTurns:2});assert.deepEqual(second.messages,first.messages);assert.equal(second.boundary,first.boundary);assert.ok(second.tokensEstimated<=700);assert.match(second.messages[0].content,/Earlier context/);
 const toolMs=[...ms.slice(0,12),{role:'user',content:'Ask',timestamp:30},toolCall(),{role:'toolResult',toolCallId:'call-1',toolName:'fixture_read',content:[{type:'text',text:'x'.repeat(2000)}],isError:false,timestamp:31},...ms.slice(16)];const result=await compactIfNeeded({sessionId:'pairs',messages:toolMs,windowTokens:800,keepRecentTurns:2});assert.notEqual(result.boundary,14);
 await assert.rejects(compactIfNeeded({sessionId:'too-large',messages:[{role:'user',content:'x'.repeat(9000),timestamp:1}],windowTokens:100,keepRecentTurns:1}),/Recent messages/);
});
test('execution cancels, strips keys, rejects cwd escape and restricts code filesystem',async t=>{
 const {dir}=await fixture(t);const abort=new AbortController();abort.abort();await assert.rejects(terminalTool.execute('cancel',{command:'printf SHOULD_NOT_RUN'},abort.signal));
 process.env.FIXTURE_SECRET='must-not-inherit';const env=await terminalTool.execute('env',{command:'printenv FIXTURE_SECRET || true'});assert.equal(env.details.stdout,'');delete process.env.FIXTURE_SECRET;
 await assert.rejects(terminalTool.execute('escape',{command:'pwd',cwd:dir}),/inside the task workspace/);
 const signal=new AbortController();const started=Date.now();const running=terminalTool.execute('long',{command:'sleep 30 & wait'},signal.signal);setTimeout(()=>signal.abort(),100);await assert.rejects(running);assert.ok(Date.now()-started<2000);
 const secret=join(dir,'outside.txt');await writeFile(secret,'outside');const code=await executeCodeTool.execute('fs',{code:`import fs from 'node:fs';console.log(fs.readFileSync(${JSON.stringify(secret)},'utf8'));`});assert.notEqual(code.details.exitCode,0);assert.match(code.details.stderr,/ERR_ACCESS_DENIED/);
 const good=await executeCodeTool.execute('ok',{code:"import fs from 'node:fs';fs.writeFileSync('result.txt','ok');console.log('done')"});assert.equal(good.details.exitCode,0);assert.equal(await readFile(join(dir,'workspace/result.txt'),'utf8'),'ok');
});
test('network tools inherit cancellation and unopened memory flush does not overwrite',async t=>{
 const {dir}=await fixture(t);const server=createServer((_req,res)=>setTimeout(()=>res.end('{}'),2000));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const abort=new AbortController();const began=Date.now();const pending=toolContext.run({sessionId:'s',workspace:dir,signal:abort.signal},()=>fetchJson(`http://127.0.0.1:${server.address().port}`));setTimeout(()=>abort.abort(),50);assert.equal((await pending).ok,false);assert.ok(Date.now()-began<1000);
 const file=join(dir,'memory.json');await writeFile(file,'existing');await new MemoryStore(file).flush();assert.equal(await readFile(file,'utf8'),'existing');
});
test('UI reducer matches tool IDs and settled messages reject duplicate deltas',async()=>{
 const ts=require('typescript');
 const source=await readFile(new URL('../../desktop-ui/src/chatState.ts',import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;const {applyChatEvent}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 let state=[];for(const id of ['a','b'])state=applyChatEvent(state,{type:'tool-start',sessionId:'s',runId:'r',toolCallId:id,toolName:'tool'});state=applyChatEvent(state,{type:'tool-end',sessionId:'s',runId:'r',toolCallId:'a',toolName:'tool',isError:true});assert.equal(state[0].pending,false);assert.equal(state[1].pending,true);
 state=applyChatEvent(state,{type:'message',sessionId:'s',runId:'r',message:{id:'m',role:'assistant',text:'Final'}});state=applyChatEvent(state,{type:'text-delta',sessionId:'s',runId:'r',messageId:'m',delta:'duplicate'});assert.equal(state.at(-1).text,'Final');
});

test('UI alone decides proactive approvals and stale plan approvals fail closed',async t=>{
 await fixture(t);const {getProactiveEngine}=await import('../dist/proactive/engine.js');const {proactiveApprovalsTool}=await import('../dist/tools/proactive.js');const engine=getProactiveEngine();const goal=engine.create({title:'Fixture',mandate:'No-op',tags:[],config:{}});engine.plan(goal.id,[{id:'step',kind:'trade.spot',title:'No-op',input:{amount:1}}]);const blocked=await engine.act(goal.id);
 await assert.rejects(proactiveApprovalsTool.execute('model',{approvalId:blocked.approval.id,decision:'approve'}),/user interface/);assert.equal(engine.getGoal(goal.id).plan[0].status,'awaiting_approval');
 engine.plan(goal.id,[{id:'step',kind:'trade.spot',title:'Changed',input:{amount:100}}]);await assert.rejects(engine.approve(blocked.approval.id),/already rejected/);
 const newApproval=await engine.act(goal.id);engine.pause(goal.id);await assert.rejects(engine.approve(newApproval.approval.id),/active plan/);
});
test('pending tools survive snapshot while awaiting approval',async t=>{
 const tools=new ToolRegistry().register(defineTool({name:'terminal',category:'workspace',description:'fixture',parameters:{type:'object',properties:{}},execute:()=>({ok:true})}));const {runtime}=await fixture(t,[toolCall('terminal')],tools);const s=await runtime.createSession();const run=runtime.startPrompt(s.id,'Wait',{requestId:'snapshot-001'});await eventually(()=>runtime.approvals.list().length===1);const snapshot=await runtime.snapshot(s.id,()=>({epoch:'fixture',seq:1}));assert.equal(snapshot.messages.find(m=>m.role==='tool').pending,true);assert.equal(snapshot.messages.find(m=>m.role==='tool').toolCallId,'call-1');run.abort();await run.done;
});
test('skill uninstall rejects traversal and reload updates the actual composition root',async t=>{
 const {dir}=await fixture(t);const {getBootstrapRegistry}=await import('../dist/bootstrap/registry.js');const {installSkillTool,reloadCapabilitiesTool}=await import('../dist/tools/bootstrap.js');const registry=getBootstrapRegistry(join(dir,'skills'));await assert.rejects(registry.uninstall('../..'),/Invalid skill name/);
 const runtime=await createSerisRuntime({sessionsRoot:join(dir,'skill-sessions')});t.after(()=>runtime.dispose());
 const found=await registry.search('');assert.ok(found.length);const installed=await installSkillTool.execute('install',{source:found[0].name});assert.equal(installed.details.installed,true);await reloadCapabilitiesTool.execute('reload',{});
 // Use the registry owned by the live runtime, rather than a new scanner.
 const loaded=await runtime.deps.tools.get('load_skill').execute('load',{name:found[0].name});assert.ok(loaded.details.instructions.length>0);
});

test('browser contexts are owned by sessions and cancellation affects only its page',async t=>{
 const {dir}=await fixture(t);const {browserNavigateTool,browserSnapshotTool,browserClickTool,browserTypeTool,closeBrowser}=await import('../dist/tools/browser.js');t.after(()=>closeBrowser());
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<title>${req.url}</title><input aria-label="Draft" oninput="document.title=this.value"><button onclick="document.title='Clicked'">Local fixture</button>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
 const a=new AbortController(),b=new AbortController();const execute=(id,signal,tool,args)=>toolContext.run({sessionId:id,workspace:dir,signal},()=>tool.execute('browser-test',args,signal));
 try {await execute('a',a.signal,browserNavigateTool,{url:base+'/a'});}catch(e){if(String(e).includes('Browser unavailable')){t.skip('Install Chrome or set SERIS_BROWSER_PATH to test browser tools');return;}throw e;}
 await execute('b',b.signal,browserNavigateTool,{url:base+'/b'});assert.equal((await execute('a',a.signal,browserSnapshotTool,{})).details.title,'/a');assert.equal((await execute('b',b.signal,browserSnapshotTool,{})).details.title,'/b');
 const snapshot=(await execute('a',a.signal,browserSnapshotTool,{})).details.snapshot;
 const input=snapshot.find(node=>node.name==='Draft');
 const button=snapshot.find(node=>node.name==='Local fixture');
 assert.equal((await execute('a',a.signal,browserTypeTool,{ref:input.ref,text:'Draft saved'})).details.title,'Draft saved');
 assert.equal((await execute('a',a.signal,browserClickTool,{ref:button.ref})).details.title,'Clicked');
 a.abort();await assert.rejects(execute('a',a.signal,browserSnapshotTool,{}));assert.equal((await execute('b',b.signal,browserSnapshotTool,{})).details.title,'/b');await assert.rejects(execute('b',b.signal,browserNavigateTool,{url:'file:///etc/passwd'}),/HTTP\(S\)/);
});

test('local execution reaps background children when the parent finishes',async t=>{
 if(process.platform==='win32'){t.skip('POSIX process group regression');return;}
 const {dir}=await fixture(t);const {runProcess}=await import('../dist/tools/process.js');const began=Date.now();const result=await runProcess('/bin/sh',['-c','sleep 30 & echo parent-finished'],{cwd:dir,env:{PATH:process.env.PATH},timeoutMs:10000});assert.ok(Date.now()-began<2000);assert.equal(result.timedOut,false);assert.match(result.stdout,/parent-finished/);
});


test('Seris identity reaches the model in every mode and survives legacy chat history', async t => {
 const {buildSystemPrompt}=await import('../dist/prompt/systemPrompt.js');
 for(const mode of ['default','coding','compact','onboarding']) {
  const system=buildSystemPrompt({mode});
  assert.match(system,/^You are Seris,/);
  assert.doesNotMatch(system,/You are Minara/);
 }
 const {runtime,deps}=await fixture(t,[message([{type:'text',text:'I am Minara.'}]),message([{type:'text',text:'Hello'}])]);
 deps.buildSystemPrompt=async()=>buildSystemPrompt();
 const captured=[];
 const stream=deps.models.streamSimple;
 deps.models.streamSimple=(model,context,...rest)=>{
  captured.push(structuredClone(context));
  return stream(model,context,...rest);
 };
 const session=await runtime.createSession();
 await runtime.prompt(session.id,'Hello');
 await runtime.prompt(session.id,'Who are you?');
 assert.equal(captured.length,2);
 for(const context of captured) {
  const system=context.messages.find(m=>m.role==='system')?.content;
  assert.match(system,/^You are Seris,/);
  assert.match(system,/Your name is Seris even when older messages use another assistant name/);
 }
 assert.ok(captured[1].messages.some(m=>m.role==='assistant' && m.content.some(c=>c.type==='text' && c.text==='I am Minara.')));
 assert.equal((await runtime.sessionHistory(session.id))[1].text,'I am Minara.','historical replies remain intact');
});

test('session titles generate once in the background, emit metadata and persist without entering the transcript',async t=>{
 const {runtime,deps}=await fixture(t,[message([{type:'text',text:'BTC funding differs across venues.'}]),message([{type:'text',text:'Follow-up'}])]);
 let resolveTitle;const pending=new Promise(resolve=>{resolveTitle=resolve;});const requests=[];
 deps.models.completeSimple=async(model,context,options)=>{requests.push({model,context,options});return pending;};
 const session=await runtime.createSession();assert.equal(session.name,'New chat');
 const events=[];runtime.onEvent(e=>events.push(e));
 await runtime.prompt(session.id,'Compare BTC funding on Hyperliquid and Binance');
 assert.equal(runtime.runState(session.id).status,'completed','main answer finishes before title');
 assert.equal(requests.length,1);assert.equal(requests[0].model,deps.model);
 assert.equal(requests[0].context.tools,undefined);assert.equal(requests[0].options.maxTokens,128);
 assert.match(requests[0].context.systemPrompt,/language of the user's question/);
 assert.equal(JSON.parse(requests[0].context.messages[0].content).answer,'BTC funding differs across venues.');
 const before=await runtime.sessionHistory(session.id);
 resolveTitle(message([{type:'text',text:'"BTC Funding Across Exchanges"'}]));
 await eventually(()=>events.some(e=>e.type==='session-updated'&&e.session.name==='BTC Funding Across Exchanges'));
 assert.equal((await runtime.listSessions())[0].name,'BTC Funding Across Exchanges');
 assert.deepEqual(await runtime.sessionHistory(session.id),before);
 await runtime.prompt(session.id,'Explain further');assert.equal(requests.length,1);
 const restored=new SerisRuntime(deps);await restored.init();t.after(()=>restored.dispose());
 assert.equal((await restored.listSessions())[0].name,'BTC Funding Across Exchanges');
 const {isChatEvent}=await import('../dist/protocol.js');
 assert.ok(events.filter(e=>e.type==='session-updated').every(isChatEvent));
 assert.equal(isChatEvent({type:'session-updated',sessionId:session.id,runId:'x',session:{...session,id:'wrong'}}),false);
});

test('title errors, invalid results and shutdown keep the first-message fallback and cannot corrupt a run',async t=>{
 const {runtime,deps}=await fixture(t);
 deps.models.completeSimple=async()=>{throw new Error('Title service unavailable');};
 const s=await runtime.createSession();await runtime.prompt(s.id,'分析 BTC 的近期走势');
 assert.equal(runtime.runState(s.id).status,'completed');assert.equal((await runtime.listSessions())[0].name,'分析 BTC 的近期走势');
 deps.models.completeSimple=async()=>message([{type:'text',text:'A title\nExtra explanation'}]);
 const invalid=await runtime.createSession();await runtime.prompt(invalid.id,'Invalid title fallback');
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal((await runtime.listSessions()).find(s=>s.id===invalid.id).name,'Invalid title fallback');
 let signal;deps.models.completeSimple=async(_model,_context,options)=>{signal=options.signal;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(message([{type:'text',text:'Too late'}])),{once:true}));};
 const pending=await runtime.createSession();await runtime.prompt(pending.id,'Keep this title after shutdown');
 await runtime.dispose();assert.equal(signal.aborted,true);
 const restored=new SerisRuntime(deps);await restored.init();t.after(()=>restored.dispose());
 assert.equal((await restored.listSessions()).find(s=>s.id===pending.id).name,'Keep this title after shutdown');
});

test('saved titles are respected and a late generated title cannot overwrite a renamed chat',async t=>{
 const {runtime,deps}=await fixture(t);const session=await runtime.createSession();
 await runtime.prompt(session.id,'解释 NVDA 的近期表现');const history=await runtime.sessionHistory(session.id);
 let titles=0;deps.models.completeSimple=async()=>{titles++;return message([{type:'text',text:'NVDA 近期表现'}]);};
 assert.equal((await runtime.listSessions())[0].name,'解释 NVDA 的近期表现');assert.equal(titles,0,'listing chats must not issue model requests');
 assert.deepEqual(await runtime.sessionHistory(session.id),history);
 await runtime.store.setName(session.id,'My saved conversation');
 await runtime.prompt(session.id,'Follow-up');assert.equal(titles,0);assert.equal((await runtime.listSessions())[0].name,'My saved conversation');
 let resolveTitle;deps.models.completeSimple=()=>new Promise(resolve=>{resolveTitle=resolve;});
 const renamed=await runtime.createSession();await runtime.prompt(renamed.id,'Analyze BTC');
 await runtime.store.setName(renamed.id,'My BTC notes');
 resolveTitle(message([{type:'text',text:'Generated BTC title'}]));
 await eventually(()=>runtime.titleTasks.size===0);
 assert.equal((await runtime.listSessions()).find(s=>s.id===renamed.id).name,'My BTC notes');
});

test('title generation uses the configured provider with a short output budget and no thinking or tools',async t=>{
 let payload;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;payload=JSON.parse(body);
  const frames=[
   {type:'message_start',message:{id:'title-fixture',type:'message',role:'assistant',content:[],model:'fixture',stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
   {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'BTC 资金费率分析'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}},
   {type:'message_stop'},
  ];
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(frames.map(data=>`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const {buildKernel}=await import('../dist/runtime/streamFactory.js');const {generateSessionTitle}=await import('../dist/runtime/sessionTitle.js');
 const kernel=buildKernel({id:'fixture',name:'Fixture',provider:'anthropic-compatible',baseUrl:`http://127.0.0.1:${server.address().port}`,modelId:'fixture',requiresKey:true,contextWindow:200000,maxTokens:8192,reasoning:true},'fixture-not-real-key');
 assert.equal(await generateSessionTitle(kernel.models,kernel.model,'分析 BTC 资金费率','Rates changed',AbortSignal.timeout(2000)),'BTC 资金费率分析');
 assert.equal(payload.max_tokens,128);assert.equal(payload.tools,undefined);assert.deepEqual(payload.thinking,{type:'disabled'});assert.equal(payload.messages.length,1);
});

test('pi 1.x Anthropic-compatible transport streams a tool round through the runtime and saves its result',async t=>{
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push(JSON.parse(body));
  const first=requests.length===1;
  const frames=[
   {type:'message_start',message:{id:`fixture-${requests.length}`,type:'message',role:'assistant',content:[],model:'fixture',stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
   {type:'content_block_start',index:0,content_block:first?{type:'tool_use',id:'transport-call',name:'fixture_read',input:{}}:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:first?{type:'input_json_delta',partial_json:'{"value":7}'}:{type:'text_delta',text:'Tool said 7'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:first?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}},
   {type:'message_stop'},
  ];
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(frames.map(data=>`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 let executions=0;
 const tools=new ToolRegistry().register(defineTool({name:'fixture_read',category:'market-data',description:'Read fixture',parameters:{type:'object',properties:{value:{type:'number'}},required:['value']},execute(_id,args){executions++;return {value:args.value};}}));
 const {runtime,deps}=await fixture(t,[],tools);
 const {buildKernel}=await import('../dist/runtime/streamFactory.js');
 const kernel=buildKernel({id:'fixture',name:'Fixture',provider:'anthropic-compatible',baseUrl:`http://127.0.0.1:${server.address().port}`,modelId:'fixture',requiresKey:true,contextWindow:200000,maxTokens:8192,reasoning:true},'fixture-not-real-key');
 Object.assign(deps,{models:kernel.models,model:kernel.model});
 deps.models.completeSimple=async()=>message([{type:'text',text:'Fixture tool analysis'}]);
 const events=[];runtime.onEvent(e=>events.push(e));
 const session=await runtime.createSession();await runtime.prompt(session.id,'Read the fixture');
 assert.equal(runtime.runState(session.id).status,'completed',runtime.runState(session.id).error);
 assert.equal(executions,1);assert.equal(requests.length,2);
 assert.equal(requests[0].tools[0].name,'fixture_read');
 const result=requests[1].messages.flatMap(m=>m.content).find(block=>block.type==='tool_result');
 assert.equal(result.tool_use_id,'transport-call');assert.match(JSON.stringify(result.content),/value.*7/);
 assert.equal(events.filter(e=>e.type==='text-delta').map(e=>e.delta).join(''),'Tool said 7');
 const history=await runtime.sessionHistory(session.id);
 assert.deepEqual(history.map(m=>m.role),['user','assistant','tool','assistant']);
 assert.equal(history[2].toolCallId,'transport-call');assert.equal(history.at(-1).text,'Tool said 7');
});
