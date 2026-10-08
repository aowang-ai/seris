import { defineTool, type HarnessTool, type ToolRegistry } from '../tools/registry.js';

const words = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.toLowerCase().replaceAll('_', ' '))]
  .filter(part => part.isWordLike).map(part => part.segment);

/** Run-local selection, persisted per chat. Never mutates the shared registry. */
export class ActiveTools {
  private active: Set<string>;
  private allowed: Set<string>;
  private search: HarnessTool;
  constructor(private registry: ToolRegistry, saved: string[], allowList: string[] | undefined,
    persist: (names: string[]) => Promise<void>) {
    this.allowed = new Set(allowList ?? [...registry.names(), 'tool_search']);
    this.active = new Set((allowList ?? [...registry.list().filter(tool => tool.defaultActive !== false).map(tool => tool.name), ...saved])
      .filter(name => this.allowed.has(name) && registry.has(name)));
    this.search = defineTool({ name: 'tool_search', category: 'misc', approval: 'none',
      description: 'Find and enable tools for this chat. Search by exact tool name or English/Chinese capability keywords. Loaded tools become callable on your next turn. Search again with offset to see more matches; discovery does not grant permission.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['query'] },
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        const { query, offset = 0 } = args as { query: string; offset?: number };
        const terms = words(query);
        if (!terms.length) throw new Error('Provide a tool name or capability to search');
        const matches = registry.list().filter(tool => this.allowed.has(tool.name)).map(tool => {
          const name = new Set(words(tool.name));
          const description = new Set(words(`${tool.description} ${tool.category} ${tool.searchTerms ?? ''}`));
          const score = (tool.name === query.trim() ? 100 : 0) + terms.reduce((sum, term) => sum + (name.has(term) ? 5 : description.has(term) ? 1 : 0), 0);
          return { tool, score };
        }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
        const selected = matches.slice(offset, offset + 8).map(match => match.tool);
        const added = selected.filter(tool => !this.active.has(tool.name)).map(tool => tool.name);
        if (added.length) {
          await persist(added);
          for (const name of added) this.active.add(name);
        }
        return { tools: selected.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
          total: matches.length, nextOffset: offset + selected.length < matches.length ? offset + selected.length : null,
          ...(matches.length ? {} : { hint: 'Try an exact tool name from a skill, or English keywords such as strategy, memory, browser, funding, news, alert, document.' }) };
      },
    });
  }
  list(): HarnessTool[] {
    const tools = this.registry.toolSetByNames([...this.active]);
    if (this.allowed.has('tool_search')) tools.push(this.search);
    return tools;
  }
  get(name: string): HarnessTool | undefined { return this.list().find(tool => tool.name === name); }
}
