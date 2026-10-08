# Extending Seris

Seris uses pi-agent-core for the model/tool loop and pi-durable for conversations.
Its extension host registers native pi tools without introducing a second agent
loop, session store, or plugin dependency manager. This is a Seris interface, not
the full pi CLI `ExtensionAPI`.

## Add a capability

Add a TypeScript module under `apps/core/src/extensions/builtin/`. The normal core
build compiles it; the application discovers its JavaScript output at startup.
Export a function accepting `ExtensionAPI` from `../loader.js` and call
`api.registerTool(...)`. No edit to the runtime or gateway is required.

For a locally installed extension, use `<dataRoot>/extensions/<name>/index.mjs`
(ESM `index.js` also works). Add `SKILL.md` beside it only when the capability
needs workflow instructions. Restart Seris after installing or changing code.
These are trusted local executable modules: install only code you intend to run
under your account. Seris does not scan the task workspace for executable plugins.

```js
export default function (api) {
  api.registerTool({
    name: 'example_status',
    category: 'misc',
    description: 'Read this extension’s availability.',
    searchTerms: 'example status 示例 状态',
    approval: 'none',
    parameters: { type: 'object', properties: {} },
    async execute(callId, params, signal) {
      signal?.throwIfAborted();
      return { available: true };
    },
  });
}
```

The host accepts plain JSON results or pi `{ content, details }` results. Pass
the supplied abort signal to network/process operations. Extensions default to
`approval: 'ask'` and `defaultActive: false`; declare `approval: 'none'` explicitly
for tools that should follow Seris's ungated-action policy. These declarations
belong to trusted code, never to model-generated arguments. The chat's existing
Ask/Allow all choice remains authoritative at execution time.

## Discovery and instructions

The default model tool set is `tool_search`, `load_skill`, `market_search`,
`get_market_context`, `get_market_candles`, and `market_set_view`. Extensions may
opt in to default visibility with `defaultActive: true` when justified.

`tool_search` searches registered tools by name, description, category and optional
search terms. It enables matching tools for the next model turn in the same run.
Results are paginated; there is no task or model-turn cap. Selections are saved in
a separate `seris.tools` conversation document, restored on restart and isolated
between chats. An explicit host allowlist bounds both discovery and execution.

Skills supply instructions. `load_skill` never enables a tool or changes an
approval policy. Existing `metadata.seris.tool_names` remains readable as advisory
metadata for older skills; it is not an activation mechanism.

## Lifetime and memory

Use `api.onStart()` and `api.onStop()` for application-scoped resources. Factories
only register tools and lifecycle callbacks. Start services after registration;
close them in reverse order after active runs have been cancelled and settled.
Do not close a shared resource at the end of a single chat.

Memory remains always on. `AgentMemory.prepareContext` retrieves learned examples
before a run; `recordOutcome` preserves the existing successful-run harvesting
policy. Layered memory tools remain discoverable, and existing memory files and
conversation metadata keep their formats. Memory-policy changes are separate
from this extension refactor.

## Why the existing pi runtime remains

The v1.0.2 `pi-coding-agent` SDK combines extension loading with its ModelRuntime,
SessionManager, settings and terminal-facing dependencies. Seris already owns
native credentials, desktop events and pi-durable conversations. Switching now
would require a separate history migration or two authoritative session stores.
Keep the existing pi loop and use its `prepareNextTurn` hook to update tools
before pi generates the next declarations. Revisit AgentSession only when the
adapter removes more maintenance than it adds; do not run two agent loops.
