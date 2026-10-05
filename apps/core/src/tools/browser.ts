/**
 * Domain: browser — REAL Playwright-driven headless Chromium.
 *
 * Shared browser state across tool calls within a gateway process: one
 * Browser with a separate context/Page for each session (created lazily).
 *
 * Every tool returns structured, JSON-serializable results. The accessibility
 * snapshot gives the model numbered refs ([1], [2], …) it can pass back to
 * browser_click / browser_type.
 */

import { defineTool, type HarnessTool } from './registry.js';
import { chromium, type Browser, type Page } from 'playwright-core';
import { toolContext } from '../runtime/toolContext.js';

/* --------------------------- shared browser state --------------------------- */

let launch: Promise<Browser> | null = null;
const pages = new Map<string, Promise<Page>>();
const watched = new WeakSet<AbortSignal>();
async function getPage(): Promise<Page> {
  const context = toolContext.getStore();
  context?.signal?.throwIfAborted();
  const id = context?.sessionId ?? 'standalone';
  const signal = context?.signal;
  if (signal && !watched.has(signal)) {
    watched.add(signal);
    signal.addEventListener('abort', () => {
      const p = pages.get(id); pages.delete(id);
      void p?.then(page => page.context().close()).catch(() => {});
    }, {once:true});
  }
  if (!launch) {
    const options = process.env.SERIS_BROWSER_PATH ? {executablePath:process.env.SERIS_BROWSER_PATH} : {channel:'chrome'};
    launch = chromium.launch({headless:true, ...options}).catch(e => { launch=null; throw new Error(`Browser unavailable. Install Chrome or set SERIS_BROWSER_PATH: ${e.message}`); });
  }
  if (!pages.has(id)) {
    const creating = launch.then(async browser => {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
      page.once('close', () => { if (pages.get(id) === creating) pages.delete(id); });
      return page;
    }).catch(e => { pages.delete(id); throw e; });
    pages.set(id,creating);
  }
  const page = await pages.get(id)!;
  signal?.throwIfAborted();
  return page;
}
export async function closeBrowser(): Promise<void> {
  const current=launch; launch=null; pages.clear();
  try { await (await current)?.close(); } catch { /* already closed */ }
}

/* --------------------------- accessibility snapshot --------------------------- */

interface SnapshotNode {
  ref: number;
  role: string;
  name: string;
  tag: string;
  text?: string;
}

/**
 * Build a compact, numbered interactive-element snapshot. Returns up to
 * `maxNodes` visible links/buttons/inputs with a stable ref the model can
 * reference in browser_click / browser_type.
 */
async function buildSnapshot(p: Page, maxNodes = 60): Promise<SnapshotNode[]> {
  return p.evaluate((limit) => {
    const nodes: Array<{ ref: number; role: string; name: string; tag: string; text?: string }> = [];
    const seen = new Set<Element>();
    const selectors = 'a[href], button, input, select, textarea, [role="button"], [role="link"]';
    const els = Array.from(document.querySelectorAll(selectors));
    let ref = 1;
    for (const el of els) {
      if (nodes.length >= limit || seen.has(el)) continue;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 3;
      if (!visible) continue;
      const tag = el.tagName.toLowerCase();
      let role = el.getAttribute('role') ?? (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? (el as HTMLInputElement).type || 'textbox' : tag);
      const name = (
        el.getAttribute('aria-label') ??
        (el as HTMLInputElement).placeholder ??
        (el.textContent ?? '')
      ).trim().slice(0, 80);
      // Tag the element with a data-ref so click/type can locate it later.
      el.setAttribute('data-seris-ref', String(ref));
      nodes.push({ ref, role, name, tag, text: (el.textContent ?? '').trim().slice(0, 120) || undefined });
      seen.add(el);
      ref++;
    }
    return nodes;
  }, maxNodes);
}

async function pageState(p: Page) {
  return {
    url: p.url(),
    title: await p.title().catch(() => ''),
  };
}

/* --------------------------------- tools --------------------------------- */

export const browserNavigateTool: HarnessTool = defineTool({
  name: 'browser_navigate',
  description:
    'Navigate the controlled browser to a URL and return the loaded page title, URL, and a numbered accessibility snapshot of interactive elements. Use the refs with browser_click / browser_type.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Fully-qualified URL to load.' },
      waitUntil: { type: 'string', description: 'load | domcontentloaded | networkidle (default load).' },
    },
    required: ['url'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Browser navigation requires an HTTP(S) URL');
    const p = await getPage();
    try {
      await p.goto(args.url, { waitUntil: args.waitUntil ?? 'load', timeout: 30000 });
    } catch (e) {
      return { error: `navigation failed: ${(e as Error).message}`, ...(await pageState(p)) };
    }
    return { real: true, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserSnapshotTool: HarnessTool = defineTool({
  name: 'browser_snapshot',
  description: 'Return the current page title, URL, and a fresh numbered accessibility snapshot (links, buttons, inputs).',
  category: 'browser',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const p = await getPage();
    return { real: true, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserClickTool: HarnessTool = defineTool({
  name: 'browser_click',
  description: 'Click an element by its ref number from browser_snapshot (or browser_navigate). Returns the new page state and snapshot.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: { ref: { type: 'number', description: 'Element ref from the snapshot.' } },
    required: ['ref'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const p = await getPage();
    const sel = `[data-seris-ref="${args.ref}"]`;
    const el = await p.$(sel);
    if (!el) return { error: `no element with ref ${args.ref} — take a fresh browser_snapshot`, ...(await pageState(p)) };
    try {
      await Promise.all([
        p.waitForLoadState('load', { timeout: 8000 }).catch(() => {}),
        el.click({ timeout: 5000 }),
      ]);
    } catch (e) {
      return { error: `click failed: ${(e as Error).message}`, ...(await pageState(p)) };
    }
    return { real: true, clicked: args.ref, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserTypeTool: HarnessTool = defineTool({
  name: 'browser_type',
  description: 'Type text into an input identified by snapshot ref. Optionally press Enter to submit.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'number', description: 'Input element ref from the snapshot.' },
      text: { type: 'string', description: 'Text to type.' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false).' },
    },
    required: ['ref', 'text'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const p = await getPage();
    const sel = `[data-seris-ref="${args.ref}"]`;
    const el = await p.$(sel);
    if (!el) return { error: `no element with ref ${args.ref}`, ...(await pageState(p)) };
    try {
      await el.fill(args.text);
      if (args.pressEnter) {
        await Promise.all([
          p.waitForLoadState('load', { timeout: 8000 }).catch(() => {}),
          el.press('Enter'),
        ]);
      }
    } catch (e) {
      return { error: `type failed: ${(e as Error).message}`, ...(await pageState(p)) };
    }
    return { real: true, typed: args.text.length, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserExtractTextTool: HarnessTool = defineTool({
  name: 'browser_extract_text',
  description: 'Extract the readable text content of the current page (or a CSS selector). Use to read article/page content after navigating.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to scope extraction (default: body).' },
      maxChars: { type: 'number', description: 'Max characters to return (default 4000).' },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const p = await getPage();
    const max = Math.min(args.maxChars ?? 4000, 20000);
    const text = await p.evaluate((opts) => {
      const root = opts.sel ? document.querySelector(opts.sel) : document.body;
      if (!root) return '';
      return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
    }, { sel: args.selector });
    return { real: true, ...(await pageState(p)), text: text.slice(0, max), truncated: text.length > max };
  },
});

export const browserScreenshotTool: HarnessTool = defineTool({
  name: 'browser_screenshot',
  description: 'Capture a screenshot of the current page (full page or viewport), returned as base64 PNG.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      fullPage: { type: 'boolean', description: 'Capture the full scrollable page (default false).' },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const p = await getPage();
    const buf = await p.screenshot({ fullPage: args.fullPage ?? false, type: 'png' });
    return { real: true, ...(await pageState(p)), pngBase64: buf.toString('base64'), bytes: buf.length };
  },
});

export const browserScrollTool: HarnessTool = defineTool({
  name: 'browser_scroll',
  description: 'Scroll the page up or down by one viewport (or to top/bottom). Returns a fresh snapshot.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', description: 'down | up | top | bottom (default down).' },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const p = await getPage();
    await p.evaluate((dir) => {
      if (dir === 'top') window.scrollTo(0, 0);
      else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
      else if (dir === 'up') window.scrollBy(0, -window.innerHeight);
      else window.scrollBy(0, window.innerHeight);
    }, args.direction ?? 'down');
    await p.waitForTimeout(300);
    return { real: true, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserBackTool: HarnessTool = defineTool({
  name: 'browser_back',
  description: 'Go back in browser history. Returns the new page state.',
  category: 'browser',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const p = await getPage();
    await p.goBack({ timeout: 8000 }).catch(() => null);
    return { real: true, ...(await pageState(p)), snapshot: await buildSnapshot(p) };
  },
});

export const browserTools: HarnessTool[] = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserExtractTextTool,
  browserScreenshotTool,
  browserScrollTool,
  browserBackTool,
];
