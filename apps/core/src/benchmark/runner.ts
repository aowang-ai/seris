/**
 * benchmark/runner.ts — self-evaluation.
 * Run scenarios through the live agent, grade with a rubric, emit a report.
 */

export interface BenchmarkScenario {
  id: string;
  category: string;
  prompt: string;
  expectations: string[];
  expectedTools?: string[];
}

export interface ScenarioResult {
  id: string;
  category: string;
  prompt: string;
  answer: string;
  toolCalls: string[];
  expectationsMet: Array<{ expectation: string; met: boolean }>;
  expectedTools: string[];
  missingTools: string[];
  durationMs: number;
  score: number;
  passed: boolean;
}

export interface BenchmarkReport {
  runAt: number;
  totalScenarios: number;
  passed: number;
  failed: number;
  avgScore: number;
  results: ScenarioResult[];
}

export type ScenarioRunner = (prompt: string) => Promise<{ answer: string; toolCalls: string[]; durationMs: number }>;

export const DEFAULT_SCENARIOS: BenchmarkScenario[] = [
  { id: 'price-btc', category: 'market', prompt: 'What is the current price of Bitcoin?',
    expectations: ['has a numeric BTC price', 'mentions 24h change or source'], expectedTools: ['get_token_price'] },
  { id: 'perp-snapshot', category: 'perps', prompt: 'Give me the BTC perpetual snapshot on Hyperliquid.',
    expectations: ['has the mark price', 'mentions funding or open interest'], expectedTools: ['get_perp_snapshot'] },
  { id: 'fear-greed', category: 'sentiment', prompt: 'What is the crypto fear and greed index?',
    expectations: ['has a 0-100 value', 'gives a fear/greed interpretation'], expectedTools: ['get_fear_greed'] },
  { id: 'stock-quote', category: 'stocks', prompt: 'What is the Apple stock price?',
    expectations: ['has a numeric price', 'mentions exchange or currency'], expectedTools: ['get_stock_snapshot'] },
];

function heuristicCheck(expectation: string, answer: string, toolCalls: string[]): boolean {
  const e = expectation.toLowerCase();
  const a = answer;
  // precise/specific branches first so generic keywords don't shadow them
  if (e.includes('numeric') && e.includes('price')) return /[0-9][0-9,]{2,}(\.[0-9]+)?/.test(a);
  if (e.includes('0-100')) return /\b([0-9]{1,2}|100)\b/.test(a);
  if (e.includes('mark price')) return /mark|price|\$/.test(a);
  if (e.includes('funding') || e.includes('open interest')) return /funding|open interest|oi/i.test(a);
  if (e.includes('fear') || e.includes('greed')) return /fear|greed|neutral|extreme/i.test(a);
  if (e.includes('exchange') || e.includes('currency')) return /nasdaq|nms|usd|exchange|nyse|apple|quote|stock/i.test(a);
  if (e.includes('24h') || /\bchange\b/.test(e) || e.includes('source')) return /24h|\bchange\b|%|coingecko|hyperliquid|yahoo|source/i.test(a);
  return a.length > 60;
}

export function gradeScenario(sc: BenchmarkScenario, res: { answer: string; toolCalls: string[]; durationMs: number }): ScenarioResult {
  const expectationsMet = sc.expectations.map((e) => ({ expectation: e, met: heuristicCheck(e, res.answer, res.toolCalls) }));
  const expected = sc.expectedTools ?? [];
  const missing = expected.filter((t) => !res.toolCalls.includes(t));
  const eScore = sc.expectations.length ? (expectationsMet.filter((x) => x.met).length / sc.expectations.length) * 70 : 70;
  const tScore = expected.length ? ((expected.length - missing.length) / expected.length) * 30 : 30;
  const score = Math.round(eScore + tScore);
  return { id: sc.id, category: sc.category, prompt: sc.prompt, answer: res.answer, toolCalls: res.toolCalls,
    expectationsMet, expectedTools: expected, missingTools: missing, durationMs: res.durationMs, score, passed: score >= 70 };
}

export async function runBenchmark(run: ScenarioRunner, scenarios: BenchmarkScenario[] = DEFAULT_SCENARIOS): Promise<BenchmarkReport> {
  const results: ScenarioResult[] = [];
  for (const sc of scenarios) {
    const start = Date.now();
    try {
      const res = await run(sc.prompt);
      results.push(gradeScenario(sc, { ...res, durationMs: Date.now() - start }));
    } catch (e) {
      results.push({ id: sc.id, category: sc.category, prompt: sc.prompt, answer: 'ERROR: ' + (e as Error).message,
        toolCalls: [], expectationsMet: [], expectedTools: sc.expectedTools ?? [], missingTools: sc.expectedTools ?? [],
        durationMs: Date.now() - start, score: 0, passed: false });
    }
  }
  const passed = results.filter((r) => r.passed).length;
  return { runAt: Date.now(), totalScenarios: results.length, passed, failed: results.length - passed,
    avgScore: results.reduce((s, r) => s + r.score, 0) / (results.length || 1), results };
}
