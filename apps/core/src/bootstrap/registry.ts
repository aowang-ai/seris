/**
 * Skill installation registry. Bundled templates can be searched offline,
 * installed into the user data directory, and loaded after a capability
 * rescan. Installation records identify the selected source and version.
 */

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { installedSkillsRoot } from '../runtime/paths.js';
import { fetchJson } from '../tools/registry.js';
import { parseSkillMarkdown, validateFrontmatter } from '../skills/frontmatter.js';

export interface SkillIndexEntry {
  name: string;
  description: string;
  source: string; // e.g. 'bundled', 'owner/repo', 'local:/abs/path'
  tools: string[];
  /** Where the SKILL.md body can be fetched from. */
  fetch?: 'bundled' | 'github' | 'local';
  /** For github: {owner, repo, path?}. For local: absolute dir. */
  ref?: { owner?: string; repo?: string; path?: string; dir?: string };
  version?: string;
}

interface VersionRecord {
  name: string;
  installedAt: number;
  install_source: string;
  note: string;
  version?: string;
}

/* --------------------------- bundled registry --------------------------- */
/* Small curated offline index so search works with zero network. In prod
   this would be backed by the skills.sh public registry API. */
const BUNDLED_INDEX: SkillIndexEntry[] = [
  {
    name: 'stock-analysis',
    description: 'Fundamental equity analysis: pull financials, ratios, and peer comps for a ticker.',
    source: 'bundled',
    tools: ['get_stock_snapshot', 'get_stock_history', 'get_batch_quotes'],
    fetch: 'bundled',
    version: '1.0.0',
  },
  {
    name: 'defi-yield',
    description: 'DeFi yield scanning: TVL-ranked pools, stablecoin yields, chain breakdowns.',
    source: 'bundled',
    tools: ['get_chain_tvl', 'get_trending_pools', 'get_stablecoin_supply'],
    fetch: 'bundled',
    version: '1.0.0',
  },
  {
    name: 'perp-risk',
    description: 'Perpetual position risk review: funding, OI, leverage, liquidation distance.',
    source: 'bundled',
    tools: ['get_perp_snapshot', 'get_perp_funding_history', 'get_perp_positions', 'list_perp_markets'],
    fetch: 'bundled',
    version: '1.0.0',
  },
  {
    name: 'research-report',
    description: 'Compose a full research report (docx + pdf) from live market data.',
    source: 'bundled',
    tools: ['get_token_price', 'get_crypto_news', 'docx_create', 'pdf_create'],
    fetch: 'bundled',
    version: '1.0.0',
  },
  {
    name: 'onchain-forensics',
    description: 'Trace on-chain transactions: status, value, fee, ENS labels for BTC & ETH.',
    source: 'bundled',
    tools: ['get_transaction_status', 'resolve_ens', 'get_eth_gas_price', 'get_btc_fees'],
    fetch: 'bundled',
    version: '1.0.0',
  },
];

/** Body templates for the bundled skills (installed verbatim on install). */
const BUNDLED_BODIES: Record<string, string> = {
  "stock-analysis": "# Stock analysis\n\nRead the supplied ticker with get_stock_snapshot and get_stock_history. Use get_batch_quotes for explicitly named comparables. Identify sources and dates, then explain price behavior and missing evidence. These tools alone do not supply complete financial statements or a valuation model.",
  "defi-yield": "# DeFi liquidity\n\nRead chain TVL, trending pools and stablecoin supply. Compare liquidity and activity using the returned units and dates. These tools do not establish available yield or its safety; do not invent APY or imply a deposit was executed.",
  "perp-risk": "# Perpetual position review\n\nRead venue snapshots and funding history. With the user-provided address, inspect public positions. Explain leverage, unrealized PnL, funding units and reported liquidation levels. Missing address data does not prove the user has no position.",
  "research-report": "# Market report\n\nGather the requested asset quote and relevant dated news. Write the requested report format using docx_create or pdf_create. Separate observations from conclusions, identify missing evidence and return the actual artifact link.",
  "onchain-forensics": "# Transaction inspection\n\nRead the transaction hash using get_transaction_status. Use resolve_ens only for supported addresses, and compare fees to current network fee data when relevant. Describe confirmed facts and pending status without inferring ownership or intent."
};

/* ------------------------------ the engine ------------------------------ */

export class BootstrapRegistry {
  private readonly skillsRoot: string;
  private readonly installedDir: string;

  constructor(skillsRoot: string) {
    this.skillsRoot = skillsRoot;
    this.installedDir = join(skillsRoot, 'installed');
  }

  /** Search the registry for skills matching a free-text query. */
  async search(query: string): Promise<SkillIndexEntry[]> {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const score = (e: SkillIndexEntry): number => {
      const hay = `${e.name} ${e.description}`.toLowerCase();
      return terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    };
    return BUNDLED_INDEX.map((e) => ({ e, s: score(e) }))
      .filter((x) => x.s > 0 || q === '')
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  }

  /** List what's already installed under skills/installed/. */
  async listInstalled(): Promise<Array<{ name: string; record?: VersionRecord }>> {
    if (!existsSync(this.installedDir)) return [];
    const names = await readdir(this.installedDir);
    const out: Array<{ name: string; record?: VersionRecord }> = [];
    for (const name of names) {
      const recPath = join(this.installedDir, name, '.install.json');
      if (existsSync(recPath)) {
        try {
          out.push({ name, record: JSON.parse(await readFile(recPath, 'utf8')) as VersionRecord });
          continue;
        } catch { /* fall through */ }
      }
      out.push({ name });
    }
    return out;
  }

  /**
   * Install a skill by registry source. Fetches the SKILL.md, validates its
   * frontmatter, writes it under installed/<name>/, and records provenance.
   */
  async install(source: string): Promise<{ installed: boolean; name: string; dir: string; error?: string }> {
    // Resolve the index entry
    const entry =
      BUNDLED_INDEX.find((e) => e.name === source) ??
      BUNDLED_INDEX.find((e) => e.source === source);
    if (!entry) {
      return { installed: false, name: source, dir: '', error: `No skill named/sourced "${source}" in the registry. Run search_skills first.` };
    }

    let body: string;
    if (entry.fetch === 'github' && entry.ref?.owner && entry.ref?.repo) {
      const path = entry.ref.path ?? 'SKILL.md';
      const url = `https://raw.githubusercontent.com/${entry.ref.owner}/${entry.ref.repo}/main/${path}`;
      const r = await fetchJson(url, { headers: { accept: 'text/plain' } });
      if (!r.ok) return { installed: false, name: entry.name, dir: '', error: `GitHub fetch failed: ${JSON.stringify(r.error)}` };
      body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    } else if (entry.fetch === 'local' && entry.ref?.dir) {
      body = await readFile(join(entry.ref.dir, 'SKILL.md'), 'utf8');
    } else {
      // bundled
      const text = BUNDLED_BODIES[entry.name];
      if (!text) return { installed: false, name: entry.name, dir: '', error: `Bundled body for "${entry.name}" missing.` };
      body = text;
    }

    // Compose the full SKILL.md with frontmatter derived from the index entry
    const frontmatter = [
      '---',
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      'metadata:',
      '  seris:',
      '    priority: 60',
      `    tool_names: [${entry.tools.join(', ')}]`,
      '---',
      '',
    ].join('\n');
    const full = frontmatter + (body.startsWith('#') ? '' : '# ') + body + '\n';

    // Validate before writing
    const { frontmatter: fm } = parseSkillMarkdown(full);
    const problems = validateFrontmatter(fm);
    if (problems.length > 0) {
      return { installed: false, name: entry.name, dir: '', error: `Invalid generated SKILL.md: ${problems.join('; ')}` };
    }

    const dir = join(this.installedDir, entry.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), full, 'utf8');
    const record: VersionRecord = {
      name: entry.name,
      installedAt: Date.now(),
      install_source: entry.source,
      note: `installed via ${entry.fetch} registry (${entry.source})`,
      version: entry.version,
    };
    await writeFile(join(dir, '.install.json'), JSON.stringify(record, null, 2), 'utf8');
    return { installed: true, name: entry.name, dir };
  }

  /** Uninstall an installed skill (removes its directory). */
  async uninstall(name: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Invalid skill name');
    const dir = join(this.installedDir, name);
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  }
}

let singleton: BootstrapRegistry | null = null;
export function getBootstrapRegistry(skillsRoot?: string): BootstrapRegistry {
  const root = skillsRoot ?? resolveSkillsRootFromAgent();
  if (!singleton || singleton['skillsRoot'] !== root) {
    singleton = new BootstrapRegistry(root);
  }
  return singleton;
}

function resolveSkillsRootFromAgent(): string { return installedSkillsRoot(); }
