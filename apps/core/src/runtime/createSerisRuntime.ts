import { buildRegistry } from './toolLoader.js';
import { SkillRegistry } from '../skills/registry.js';
import { buildSystemPrompt } from '../prompt/systemPrompt.js';
import { ModelSettings } from './modelSettings.js';
import { ensureArtifactsDir, resolveSkillsRoot, installedSkillsRoot, workspaceRoot } from './paths.js';
import { SerisRuntime } from './serisRuntime.js';
import { defineTool } from '../tools/registry.js';
import { getAutopilotEngine } from '../autopilot/engine.js';
import { ensureStrategyStorage } from '../strategy/files.js';

export interface CreateSerisRuntimeOptions { sessionsRoot: string; cwd?: string; modelSettings?: ModelSettings }
export async function createSerisRuntime(opts: CreateSerisRuntimeOptions): Promise<SerisRuntime> {
  ensureArtifactsDir();
  const modelSettings=opts.modelSettings??new ModelSettings();
  await modelSettings.init();
  const kernel=modelSettings.kernel;
  const tools=buildRegistry();
  await ensureStrategyStorage();
  const skills=await SkillRegistry.load(resolveSkillsRoot(),[installedSkillsRoot()]);
  tools.register(defineTool({name:'load_skill',description:'Load the full instructions of a skill from the catalog before using it.',category:'skills',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']},
    async execute(_id,params) { const skill=await skills.dispatch((params as {name:string}).name); if(!skill) throw new Error('Unknown skill'); return {name:skill.name,instructions:skill.body}; },
  }));
  const runtime=new SerisRuntime({modelSettings,models:kernel?.models,model:kernel?.model,tools,skills,
    buildSystemPrompt:async()=>buildSystemPrompt({mode:'default',skillCatalog:skills.catalog()}),sessionsRoot:opts.sessionsRoot,cwd:opts.cwd??workspaceRoot()});
  await runtime.init();
  getAutopilotEngine().start();
  return runtime;
}
