/** Runtime tool catalog: only implemented capabilities ship in the release. */

import { ToolRegistry, type HarnessTool } from '../tools/registry.js';
import { marketDataTools } from '../tools/market-data.js';
import { marketExtendedTools } from '../tools/market-extended.js';
import { dataSourceTools } from '../tools/data-sources.js';
import { defiAdvancedTools } from '../tools/defi-advanced.js';
import { hyperliquidTools } from '../tools/hyperliquid.js';
import { onchainMarketTools } from '../tools/onchain-market.js';
import { allArtifactTools } from '../tools/artifact/index.js';
import { autopilotTools } from '../tools/autopilot.js';
import { proactiveTools } from '../tools/proactive.js';
import { memoryTools } from '../tools/memory.js';
import { browserTools } from '../tools/browser.js';
import { execTools } from '../tools/exec.js';
import { marketsTools } from '../tools/markets.js';
import { strategiesTools } from '../tools/strategies.js';

export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const all = [
    ...marketDataTools,
    ...marketExtendedTools,
    ...dataSourceTools,
    ...defiAdvancedTools,
    ...hyperliquidTools,
    ...onchainMarketTools,
    ...allArtifactTools,
    ...autopilotTools,
    ...proactiveTools,
    ...memoryTools,
    ...browserTools,
    ...execTools,
    ...marketsTools,
    ...strategiesTools,
  ] as HarnessTool[];
  registry.registerAll(all);
  return registry;
}
