/**
 * CodeBlock — readonly syntax-highlighted source for approval cards and
 * chat. Lazy-loads the Shiki highlighter and the requested language on
 * first use, then caches the HTML per (code, lang, theme).
 *
 * The highlighter is a long-lived singleton per Shiki's own guidance.
 * Theme follows the document's current color scheme (github-light for
 * light mode, github-dark-default for dark mode) so the code matches the
 * surrounding UI without inline styles.
 */

import { useEffect, useState, type JSX } from 'react';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import tsLang from 'shiki/langs/typescript.mjs';
import mdLang from 'shiki/langs/markdown.mjs';
import lightTheme from 'shiki/themes/github-light.mjs';
import darkTheme from 'shiki/themes/github-dark-default.mjs';

let highlighterPromise: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [lightTheme, darkTheme],
      langs: [tsLang, mdLang],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const htmlCache = new Map<string, Promise<string>>();

function theme(): 'github-light' | 'github-dark-default' {
  if (typeof document === 'undefined') return 'github-light';
  return document.documentElement.dataset.theme === 'dark' ? 'github-dark-default' : 'github-light';
}

async function highlight(code: string, lang: string): Promise<string> {
  const key = `${theme()}|${lang}|${code.length}|${code.slice(0, 64)}|${code.slice(-64)}`;
  let p = htmlCache.get(key);
  if (!p) {
    p = highlighter().then((h) => h.codeToHtml(code, { lang, theme: theme() }));
    htmlCache.set(key, p);
  }
  return p;
}

export function CodeBlock(props: { code: string; language?: string; maxHeight?: number }): JSX.Element {
  const { code, language = 'typescript', maxHeight = 380 } = props;
  const [html, setHtml] = useState<string>('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    highlight(code, language)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code, language]);

  if (failed || !html) {
    return (
      <pre style={{ maxHeight, overflow: 'auto' }}><code>{code}</code></pre>
    );
  }
  return (
    <div
      className="codeblock"
      style={{ maxHeight, overflow: 'auto' }}
      // Shiki generates trusted markup; the input is code from the local
      // agent, not remote user content.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
