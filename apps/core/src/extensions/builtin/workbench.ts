import type { HarnessTool } from '../../tools/registry.js';
import type { Extension } from '../loader.js';
import { marketDataTools } from '../../tools/market-data.js';
import { marketExtendedTools } from '../../tools/market-extended.js';
import { dataSourceTools } from '../../tools/data-sources.js';
import { defiAdvancedTools } from '../../tools/defi-advanced.js';
import { hyperliquidTools } from '../../tools/hyperliquid.js';
import { onchainMarketTools } from '../../tools/onchain-market.js';
import { allArtifactTools } from '../../tools/artifact/index.js';
import { autopilotTools } from '../../tools/autopilot.js';
import { proactiveTools } from '../../tools/proactive.js';
import { memoryTools } from '../../tools/memory.js';
import { browserTools } from '../../tools/browser.js';
import { execTools } from '../../tools/exec.js';
import { marketsTools } from '../../tools/markets.js';
import { strategiesTools } from '../../tools/strategies.js';

import { getAutopilotEngine } from '../../autopilot/engine.js';
import { closeBrowser } from '../../tools/browser.js';

const extension: Extension = api => {
  const tools = [
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
  const defaults = new Set(['market_search', 'get_market_context', 'get_market_candles', 'market_set_view']);
  const keywords: Record<string, string> = {
    'market-data': '行情 价格 股票 币 数据 基本面 新闻 链上', perps: '永续 合约 资金费率 持仓',
    strategies: '策略 回测 保存 历史', memory: '记忆 经验 偏好', browser: '浏览器 网页 搜索',
    artifact: '文档 表格 幻灯片 文件', autopilot: '提醒 监控 主动 任务', workspace: '代码 终端 命令',
  };
  for (const tool of tools) api.registerTool({ ...tool, defaultActive: defaults.has(tool.name), searchTerms: keywords[tool.category] });
  api.onStart(() => { getAutopilotEngine().start(); });
  api.onStop(() => { getAutopilotEngine().stop(); });
  api.onStop(closeBrowser);
};
export default extension;
