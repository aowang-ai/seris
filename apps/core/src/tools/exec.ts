import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineTool, type HarnessTool } from './registry.js';
import { runProcess, executionEnv } from './process.js';
import { workspaceRoot as defaultWorkspace } from '../runtime/paths.js';
import { toolContext, toolSignal } from '../runtime/toolContext.js';

const workspaceRoot = () => path.resolve(toolContext.getStore()?.workspace ?? defaultWorkspace());
export const executeCodeTool: HarnessTool = defineTool({
  name: 'execute_code', category: 'workspace',
  description: 'Run local JavaScript after user approval. Filesystem access is restricted to the task workspace and temporary code directory. Returns stdout, stderr and exit code.',
  parameters: {type:'object',properties:{code:{type:'string'},language:{type:'string',enum:['javascript','js','node']},timeoutMs:{type:'number'}},required:['code']},
  async execute(_id: string, params: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const args = params as {code:string;language?:string;timeoutMs?:number};
    if (!args.code?.trim()) throw new Error('code is required');
    if (!['javascript','js','node'].includes(args.language ?? 'javascript')) throw new Error('Only JavaScript is supported');
    const root = workspaceRoot(); await mkdir(root,{recursive:true});
    const dir = await realpath(await mkdtemp(path.join(tmpdir(),'seris-exec-')));
    const started = Date.now();
    try {
      const cwd = await realpath(root);
      const file = path.join(dir,'snippet.mjs'); await writeFile(file,args.code);
      const result = await runProcess(process.execPath, ['--permission', `--allow-fs-read=${cwd}`, `--allow-fs-read=${dir}`, `--allow-fs-write=${cwd}`, `--allow-fs-write=${dir}`, file], {
        cwd, env:executionEnv(dir), timeoutMs:Math.min(Math.max(args.timeoutMs??10000,100),60000), signal,
      });
      return {runtime:'node-local',exitCode:result.code,timedOut:result.timedOut,stdout:result.stdout,stderr:result.stderr,durationMs:Date.now()-started};
    } finally { await rm(dir,{recursive:true,force:true}); }
  },
});
export const terminalTool: HarnessTool = defineTool({
  name:'terminal',category:'workspace',description:'Run a local shell command after user approval. This is a full shell, with credentials removed from its environment.',
  parameters:{type:'object',properties:{command:{type:'string'},cwd:{type:'string'},timeoutMs:{type:'number'}},required:['command']},
  async execute(_id:string,params:unknown,signal?:AbortSignal) {
    signal?.throwIfAborted();
    const args=params as {command:string;cwd?:string;timeoutMs?:number};
    if (!args.command?.trim()) throw new Error('command is required');
    const root=workspaceRoot(); await mkdir(root,{recursive:true});
    const cwd=await realpath(path.resolve(root,args.cwd??'.'));
    const relative=path.relative(await realpath(root),cwd);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)) throw new Error('cwd must stay inside the task workspace');
    const started=Date.now();
    const isWindows=process.platform==='win32';
    const result=await runProcess(isWindows?(process.env.COMSPEC??'cmd.exe'):'/bin/sh',isWindows?['/d','/s','/c',args.command]:['-c',args.command],{
      cwd,env:executionEnv(cwd),timeoutMs:Math.min(Math.max(args.timeoutMs??15000,100),120000),signal,
    });
    return {runtime:'exec-local',exitCode:result.code,timedOut:result.timedOut,cwd,stdout:result.stdout,stderr:result.stderr,durationMs:Date.now()-started};
  },
});

// ---------------------------------------------------------------------------
// computer — structured placeholder. PRODUCTION: computer-use desktop driver
// (screenshot capture, synthetic input events) over the same action surface.
// ---------------------------------------------------------------------------

const COMPUTER_ACTIONS = [
  "screenshot",
  "left_click",
  "right_click",
  "double_click",
  "type",
  "key",
  "scroll",
  "move",
  "cursor_position",
] as const;
type ComputerAction = (typeof COMPUTER_ACTIONS)[number];

export const computerTool: HarnessTool = defineTool({
  name: "computer",
  description:
    "Control the desktop: take screenshots, click, type, press keys, scroll, move the cursor. THIS IS A STRUCTURED PLACEHOLDER — local builds cannot see or drive the user's desktop; the production wiring point connects a computer-use driver (screen capture + synthetic input events) and echoes its results through the same action/result shape.",
  category: "browser",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...COMPUTER_ACTIONS], description: "Desktop action to perform." },
      coordinate: {
        type: "array",
        items: { type: "number" },
        description: "[x, y] screen coordinate for click/scroll/move actions.",
      },
      text: { type: "string", description: "Text for the type action." },
      key: { type: "string", description: "Key name for the key action (e.g. \"Return\", \"Tab\", \"ctrl+c\")." },
      scrollDirection: { type: "string", enum: ["up", "down", "left", "right"] },
      scrollAmount: { type: "number", minimum: 1, maximum: 10, default: 3 },
    },
    required: ["action"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const action = (args.action as ComputerAction | undefined) ?? "screenshot";
    if (!COMPUTER_ACTIONS.includes(action)) {
      return { error: { kind: "input", message: `action must be one of ${COMPUTER_ACTIONS.join(", ")}` } };
    }
    // PRODUCTION (computer-use): dispatch `action` to the desktop driver and
    // return its observation (screenshot PNG as data URI, cursor state). The
    // placeholder below keeps the exact result envelope so skills can be authored
    // against it before the driver is wired in.
    return {
      placeholder: true,
      reason:
        "local build ships no desktop driver; production wiring point: computer-use driver (screen capture + synthetic input events)",
      action,
      args: {
        coordinate: args.coordinate ?? null,
        text: args.text ?? null,
        key: args.key ?? null,
        scrollDirection: args.scrollDirection ?? null,
        scrollAmount: args.scrollAmount ?? null,
      },
      observation: action === "screenshot" ? { image: null, width: null, height: null } : null,
    };
  },
});

// ---------------------------------------------------------------------------
// web_search — real DuckDuckGo HTML endpoint; offline stub as fallback.
// ---------------------------------------------------------------------------

const DDG_HTML = "https://html.duckduckgo.com/html/";

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Parse the DDG HTML results page — result links are <a class="result__a">. */
function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe =
    /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g;
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && hits.length < limit) {
    let url = strip(m[1]);
    // DDG wraps outbound links: /l/?kh=...&uddg=<urlencoded target>
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    hits.push({ title: strip(m[2]), url, snippet: "" });
  }
  let i = 0;
  while ((m = snippetRe.exec(html)) && i < hits.length) {
    hits[i].snippet = strip(m[1] ?? m[2] ?? "");
    i++;
  }
  return hits;
}

export const webSearchTool: HarnessTool = defineTool({
  name: "web_search",
  description:
    "Search the web and return ranked results (title, url, snippet). Uses the DuckDuckGo HTML endpoint when the network is reachable; degrades to an offline stub (clearly marked) when it is not.",
  category: "browser",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      limit: { type: "number", default: 8, minimum: 1, maximum: 30 },
    },
    required: ["query"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const query = (args.query as string | undefined) ?? "";
    const limit = Math.min(Math.max((args.limit as number | undefined) ?? 8, 1), 30);
    if (!query.trim()) {
      return { error: { kind: "input", message: "query is required" } };
    }
    const requestSignal = toolSignal(5000, signal);
    try {
      const res = await fetch(DDG_HTML, {
        method: "POST",
        signal: requestSignal,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "seris/0.1 (+offline-alpha)",
          "accept": "text/html",
        },
        body: new URLSearchParams({ q: query }).toString(),
      });
      if (!res.ok) {
        return {
          stub: true,
          reason: `duckduckgo html endpoint returned HTTP ${res.status}; offline stub`,
          source: "duckduckgo-html",
          query,
          results: [],
        };
      }
      const html = await res.text();
      const results = parseDdgHtml(html, limit);
      return {
        stub: results.length === 0,
        reason:
          results.length === 0
            ? "no parseable results returned (endpoint layout may have changed); offline stub"
            : undefined,
        source: "duckduckgo-html",
        query,
        results,
      };
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      return {
        stub: true,
        reason: aborted
          ? "search request timed out; offline stub"
          : `network unavailable (${String((err as Error)?.message ?? err)}); offline stub`,
        source: "duckduckgo-html",
        query,
        results: [],
      };
    }
  },
});

export const execTools: HarnessTool[] = [
  executeCodeTool,
  terminalTool,
  webSearchTool,
];
