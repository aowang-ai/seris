/**
 * Seris system prompt assembly. Compose identity, current date, user memory
 * and a compact skill catalog; mode-specific text is defined below.
 */

export type PromptMode = 'default' | 'coding' | 'compact' | 'onboarding';

export interface SkillCatalogLine {
  name: string;
  description: string;
  priority?: number;
}

export interface SystemPromptOptions {
  mode?: PromptMode;
  /** Lean skill catalog (progressive disclosure — frontmatter only). */
  skillCatalog?: SkillCatalogLine[];
  /** Personalization memory snapshot (free-form text), if any. */
  personalization?: string;
  /** Override "now" (testing); defaults to real current date. */
  now?: Date;
}

const IDENTITY =
  'You are Seris, the assistant in a personal trading desktop application. Help users understand markets, inspect available data, and carry out their requested actions with the provided tools. Your name is Seris even when older messages use another assistant name. State data sources, uncertainty and unavailable capabilities; never present simulated results as real trades or balances.';

const CODING_ADDENDUM = [
  'For engineering work, inspect the relevant files and interfaces before editing.',
  'Keep changes small, follow project conventions, and verify the resulting behavior.',
  'Explain what changed and accurately report checks and unresolved errors.',
].join('\n');

const COMPACT_ADDENDUM = [
  'Summarize the older conversation so work can continue within the context limit.',
  'Keep user requirements, decisions, pending actions, identifiers, numbers and relevant tool results.',
  'Remove repetition while preserving recent context and unresolved questions.',
  'Return the summary without commentary.',
].join('\n');

const ONBOARDING_ADDENDUM = [
  'Help a new user start with an available feature: chat, market charts or monitoring.',
  'Suggest one specific next action and explain any credentials it needs.',
  'Describe prototype and simulated capabilities honestly.',
].join('\n');

/** Include the current UTC date in the prompt. */
function utcSegment(now: Date): string {
  return `Current date (UTC): ${now.toISOString().slice(0, 10)}; timezone: UTC.`;
}

/** Render the <skills> catalog block (name + description only). */
export function renderSkillsCatalog(skillCatalog: SkillCatalogLine[]): string {
  if (skillCatalog.length === 0) return '';
  const lines = skillCatalog.map(
    (s) => `- ${s.name}: ${s.description}`,
  );
  return ['<skills>', ...lines, '</skills>'].join('\n');
}

export function buildSystemPrompt(opts: SystemPromptOptions = {}): string {
  const mode: PromptMode = opts.mode ?? 'default';
  const now = opts.now ?? new Date();

  const parts: string[] = [IDENTITY, utcSegment(now)];
  if (mode === 'default' || mode === 'onboarding') {
    parts.push(
      'To show a price chart or accompany a requested price/trend analysis with a chart, resolve the exact instrument with market_search and call market_set_view. This also works from ordinary Chat without an attached Markets page. get_token_price and get_market_chart only read data; they never switch the UI. Only describe a view action after market_set_view succeeds, and say the chart is ready to view rather than claiming the user has seen it: the UI may defer a late action if the user navigated elsewhere.',
    );
  }

  if (opts.personalization && opts.personalization.trim() !== '') {
    parts.push(`<personalization>\n${opts.personalization.trim()}\n</personalization>`);
  }

  const catalog = renderSkillsCatalog(opts.skillCatalog ?? []);
  if (catalog) {
    parts.push(
      'You have the following skills. Call load_skill with the skill name to read its full instructions before using it; only a skill\'s summary is listed here.',
      catalog,
    );
  }

  switch (mode) {
    case 'coding':
      parts.push(CODING_ADDENDUM);
      break;
    case 'compact':
      parts.push(COMPACT_ADDENDUM);
      break;
    case 'onboarding':
      parts.push(ONBOARDING_ADDENDUM);
      break;
    case 'default':
      break;
  }

  return parts.join('\n\n');
}
