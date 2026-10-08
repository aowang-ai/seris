import { bundledExtensionsRoot } from './toolLoader.js';
import { loadExtensions } from '../extensions/loader.js';
import { SkillRegistry } from '../skills/registry.js';
import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import { ModelSettings } from './modelSettings.js';
import { ensureArtifactsDir, resolveSkillsRoot, installedSkillsRoot, installedExtensionsRoot, workspaceRoot } from './paths.js';
import { SerisRuntime } from './serisRuntime.js';
import { defineTool, ToolRegistry } from '../tools/registry.js';
import { getProactiveEngine } from '../proactive/engine.js';
import { ensureStrategyStorage } from '../strategy/files.js';

export interface CreateSerisRuntimeOptions { sessionsRoot: string; cwd?: string; modelSettings?: ModelSettings }
export async function createSerisRuntime(opts: CreateSerisRuntimeOptions): Promise<SerisRuntime> {
  ensureArtifactsDir();
  const modelSettings=opts.modelSettings??new ModelSettings();
  await modelSettings.init();
  const kernel=modelSettings.kernel;
  const tools=new ToolRegistry();
  const extensions=await loadExtensions(tools,[bundledExtensionsRoot,installedExtensionsRoot()]);
  await ensureStrategyStorage();
  const skills=await SkillRegistry.load(resolveSkillsRoot(),[installedSkillsRoot(),installedExtensionsRoot()]);
  tools.register(defineTool({name:'load_skill',description:'Load the full instructions of a skill from the catalog before using it.',category:'skills',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']},
    async execute(_id,params) { const skill=await skills.dispatch((params as {name:string}).name); if(!skill) throw new Error('Unknown skill'); return {name:skill.name,instructions:skill.body}; },
  }));
  const runtime=new SerisRuntime({modelSettings,models:kernel?.models,model:kernel?.model,tools,skills,
    shutdown:()=>extensions.stop(),
    goalApprovals: { list:()=>getProactiveEngine().listApprovals(), async decide(id, allowed) {
      const engine=getProactiveEngine();
      if(allowed) await engine.approve(id,{decidedBy:'user'}); else engine.reject(id,{decidedBy:'user'});
    } },
    buildSystemPrompt:async()=>buildSystemPrompt({mode:'default',skillCatalog:skills.catalog()}),sessionsRoot:opts.sessionsRoot,cwd:opts.cwd??workspaceRoot()});
  try { await runtime.init(); await extensions.start(); }
  catch (error) { await runtime.dispose(); throw error; }
  return runtime;
}
