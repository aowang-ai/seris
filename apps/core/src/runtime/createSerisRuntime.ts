import { buildRegistry } from './toolLoader.js';
import { SkillRegistry } from '../skills/registry.js';
import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import { ModelSettings } from './modelSettings.js';
import { ensureArtifactsDir, resolveSkillsRoot, installedSkillsRoot, workspaceRoot } from './paths.js';
import { SerisRuntime } from './serisRuntime.js';
import { defineTool } from '../tools/registry.js';
import { setCapabilitiesReloadHook } from '../tools/bootstrap.js';
import { getAutopilotEngine } from '../autopilot/engine.js';
import { toolContext } from './toolContext.js';
import { requiresApproval } from './approvals.js';
import { setBenchmarkRunner } from '../tools/benchmark.js';

export interface CreateSerisRuntimeOptions { sessionsRoot: string; cwd?: string; modelSettings?: ModelSettings }
export async function createSerisRuntime(opts: CreateSerisRuntimeOptions): Promise<SerisRuntime> {
  ensureArtifactsDir();
  const modelSettings=opts.modelSettings??new ModelSettings();
  await modelSettings.init();
  const kernel=modelSettings.kernel;
  const tools=buildRegistry();
  const skills=await SkillRegistry.load(resolveSkillsRoot(),[installedSkillsRoot()]);
  setCapabilitiesReloadHook(async()=> { await skills.reload([installedSkillsRoot()]); return {skills:skills.size}; });
  tools.register(defineTool({name:'load_skill',description:'Load the full instructions of a skill from the catalog before using it.',category:'skills',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']},
    async execute(_id,params) { const skill=await skills.dispatch((params as {name:string}).name); if(!skill) throw new Error('Unknown skill'); return {name:skill.name,instructions:skill.body}; },
  }));
  const runtime=new SerisRuntime({modelSettings,models:kernel?.models,model:kernel?.model,tools,skills,
    buildSystemPrompt:async()=>buildSystemPrompt({mode:'default',skillCatalog:skills.catalog()}),sessionsRoot:opts.sessionsRoot,cwd:opts.cwd??workspaceRoot()});
  await runtime.init();
  getAutopilotEngine().start();
  setBenchmarkRunner(async prompt=> {
    const s=await runtime.createSession(); const start=Date.now(); const toolCalls:string[]=[];
    const un=runtime.onEvent(e=> {if(e.sessionId===s.id && e.type==='tool-start') toolCalls.push(e.toolName!);});
    try {
      const signal=toolContext.getStore()?.signal; signal?.throwIfAborted();
      const run=runtime.startPrompt(s.id,prompt,{toolAllowList:tools.names().filter(n=>n!=='run_benchmark'&&!requiresApproval(n)),maxSteps:8});
      const cancel=()=>run.abort(); signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();
      try { await run.done; } finally { signal?.removeEventListener('abort',cancel); }
      const state=runtime.runState(s.id); if(state?.status!=='completed') throw new Error(state?.error??'Benchmark failed');
      const history=await runtime.sessionHistory(s.id);
      return {answer:history.filter(m=>m.role==='assistant').map(m=>m.text).join('\n'),toolCalls,durationMs:Date.now()-start};
    } finally {un();}
  });
  return runtime;
}
