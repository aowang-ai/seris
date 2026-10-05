/** benchmarkTool — run the self-evaluation suite. */
import { defineTool, type HarnessTool } from './registry.js';
import { runBenchmark, DEFAULT_SCENARIOS, type ScenarioRunner } from '../benchmark/runner.js';

/** The runner needs to execute prompts through the same agent loop the
 * chat endpoint uses. Runtime injects it via setBenchmarkRunner. */
let runner: ScenarioRunner | null = null;
export function setBenchmarkRunner(r: ScenarioRunner): void { runner = r; }

export const runBenchmarkTool: HarnessTool = defineTool({
  name: 'run_benchmark',
  description: 'Run the self-evaluation suite: N scenarios through the live agent, graded on expectations + tool coverage. Returns per-scenario pass/fail + avg score. Use to verify the agent still works after a change.',
  category: 'skills',
  parameters: { type: 'object', properties: {
    category: { type: 'string', description: 'Optional: only run scenarios in this category.' },
  } },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    if (!runner) return { error: { kind: 'unavailable', message: 'Benchmark runner not wired to the agent loop.' } };
    // Tolerant filter: only filter when the value EXACTLY names a known
    // category or scenario id — anything else (including '{}', 'all', prose)
    // means "run everything".
    const raw = (args.category ?? '').trim().toLowerCase();
    const knownValues = new Set([
      ...DEFAULT_SCENARIOS.map((s) => s.category),
      ...DEFAULT_SCENARIOS.map((s) => s.id),
    ]);
    const scenarios = knownValues.has(raw)
      ? DEFAULT_SCENARIOS.filter((s) => s.category === raw || s.id === raw)
      : DEFAULT_SCENARIOS;
    const report = await runBenchmark(runner, scenarios);
    return {
      real: true,
      totalScenarios: report.totalScenarios,
      passed: report.passed,
      failed: report.failed,
      avgScore: Math.round(report.avgScore),
      results: report.results.map((r) => ({
        id: r.id, passed: r.passed, score: r.score,
        toolsCalled: r.toolCalls, missingTools: r.missingTools,
        unmetExpectations: r.expectationsMet.filter((e) => !e.met).map((e) => e.expectation),
      })),
    };
  },
});

export const benchmarkTools: HarnessTool[] = [runBenchmarkTool];
