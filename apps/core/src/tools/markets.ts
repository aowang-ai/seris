import { randomUUID, createHash } from 'node:crypto';
import { defineTool, type HarnessTool } from './registry.js';
import { toolContext } from '../runtime/toolContext.js';
import { getMarketService, type MarketService } from '../markets/service.js';
import {
  parseInterval,
  contextLabel,
  type MarketAction,
} from '../markets/types.js';

function current() {
  const context = toolContext.getStore();
  if (!context?.marketContext)
    throw new Error(
      'No Markets page context attached. Ask for an instrument or attach the chart.',
    );
  return context;
}
const parameters = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: 'object', properties, required });
const instrumentId = {
  type: 'string',
  description:
    'Exact instrument ID from Markets context or market_search. Do not infer a venue from a ticker.',
};
export function createMarketsTools(
  resolveService: () => MarketService = getMarketService,
): HarnessTool[] {
  function instrument(args: any) {
    return args.instrumentId
      ? resolveService().instrument(args.instrumentId)
      : current().marketContext!.instrument;
  }
  return [
    defineTool({
      name: 'market_search',
      category: 'market-data',
      description:
        'Find crypto perpetuals/spot and US stocks/ETFs. Returns exact instrument IDs.',
      parameters: parameters({ query: { type: 'string' } }, ['query']),
      execute: async (_id, args: any) => ({
        instruments: await resolveService().provider.search(
          String(args.query).slice(0, 80),
        ),
      }),
    }),
    defineTool({
      name: 'get_market_context',
      category: 'market-data',
      description:
        'Read the frozen Markets page context for this request, including chart range, quote time and source. Later view tools update this run context only.',
      parameters: parameters(),
      execute: () => ({ context: current().marketContext }),
    }),
    defineTool({
      name: 'get_market_candles',
      category: 'market-data',
      description:
        'Read real OHLCV for the attached chart snapshot and selected/visible interval, or fetch an explicitly named instrument/period. The frozen chart is not replaced with current prices.',
      parameters: parameters({
        instrumentId,
        interval: { type: 'string', enum: ['15m', '1h', '4h', '1d', '1w'] },
      }),
      async execute(_id, args: any) {
        const service = resolveService(),
          context = toolContext.getStore()?.marketContext;
        const chart =
          !args.instrumentId && !args.interval && context
            ? service.snapshot(context.dataRef)
            : await service.chart(
                instrument(args),
                parseInterval(args.interval ?? context?.interval ?? '1d'),
              );
        const range =
          !args.instrumentId && !args.interval
            ? (context?.selectedRange ?? context?.visibleRange)
            : undefined;
        const candles = range
          ? chart.candles.filter(
              (c) => c.time >= range.from && c.time <= range.to,
            )
          : chart.candles;
        return {
          dataRef: chart.id,
          instrument: chart.instrument,
          interval: chart.interval,
          source: chart.source,
          fetchedAt: chart.fetchedAt,
          adjustment: chart.adjustment,
          range,
          candles,
          summary: candles.length
            ? {
                count: candles.length,
                firstClose: candles[0].close,
                lastClose: candles.at(-1)!.close,
                high: Math.max(...candles.map((c) => c.high)),
                low: Math.min(...candles.map((c) => c.low)),
                changePct: (candles.at(-1)!.close / candles[0].close - 1) * 100,
              }
            : null,
        };
      },
    }),
    defineTool({
      name: 'get_market_news',
      category: 'market-data',
      description:
        'Read dated, linked news for a crypto asset or US stock/ETF. Current news must not be presented as known during a historical chart interval.',
      parameters: parameters({ instrumentId }),
      execute: async (_id, args: any) => ({
        instrument: instrument(args),
        news: await resolveService().news(instrument(args)),
      }),
    }),
    defineTool({
      name: 'get_stock_fundamentals',
      category: 'market-data',
      description:
        'Read official Longbridge company information, valuation metrics and filing references. Missing fields remain unavailable; do not invent revenue or earnings.',
      parameters: parameters({ instrumentId }),
      execute: async (_id, args: any) =>
        resolveService().fundamentals(instrument(args)),
    }),
    defineTool({
      name: 'market_set_view',
      category: 'market-data',
      description:
        'Open a price chart in Markets from Chat, or change the attached instrument/interval. Without page context, pass an exact instrumentId from market_search. Returns typed UI action and updates this run context after real chart data loads. UI may defer applying if the user switched views.',
      parameters: parameters({
        instrumentId,
        interval: { type: 'string', enum: ['15m', '1h', '4h', '1d', '1w'] },
      }),
      async execute(_id, args: any) {
        const execution = toolContext.getStore();
        if (!execution) throw new Error('No active chat run');
        const old = execution.marketContext,
          service = resolveService();
        if (!old && !args.instrumentId)
          throw new Error(
            'No chart attached. Call market_search and pass instrumentId to open a chart from Chat.',
          );
        const chart = await service.chart(
          instrument(args),
          parseInterval(args.interval ?? old?.interval ?? '1d'),
        );
        execution.signal?.throwIfAborted();
        const id = randomUUID(),
          context = service.capture({ viewId: id, dataRef: chart.id });
        execution.marketContext = context;
        const marketAction: MarketAction = {
          id,
          kind: 'view',
          ...(old ? { originViewId: old.viewId } : {}),
          context,
          label: `查看 ${contextLabel(context)}`,
        };
        return {
          status: 'chart_data_ready',
          marketAction,
          note: 'The page applies this only if the original view is still active; otherwise the user can open it.',
        };
      },
    }),
    defineTool({
      name: 'market_price_line',
      category: 'market-data',
      description:
        'Offer a labelled observation price line on the current chart. This is a chart annotation, not an order; the user chooses to display it.',
      parameters: parameters(
        { price: { type: 'number' }, label: { type: 'string' } },
        ['price', 'label'],
      ),
      execute(_id, args: any) {
        if (!Number.isFinite(args.price) || args.price <= 0)
          throw new Error('Invalid price');
        const context = current().marketContext!;
        return {
          marketAction: {
            id: randomUUID(),
            kind: 'price-line',
            originViewId: context.viewId,
            context,
            price: args.price,
            label: String(args.label).slice(0, 80),
          } satisfies MarketAction,
        };
      },
    }),
    defineTool({
      name: 'market_watchlist',
      category: 'market-data',
      description:
        'Read the real persistent watchlist, or add/remove an exact instrument on user request.',
      parameters: parameters({
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        instrumentId,
      }),
      execute(_id, args: any) {
        const s = resolveService();
        if (args.action === 'add')
          return { watchlist: s.add(instrument(args)) };
        if (args.action === 'remove')
          return { watchlist: s.remove(instrument(args).id) };
        return { watchlist: s.watchlist() };
      },
    }),
    defineTool({
      name: 'market_alert',
      category: 'autopilot',
      description:
        'Create a real persisted price/change/funding alert, list alerts, or pause/resume/close one. Clearly specified requests may execute directly. Thresholds are price in USD (USDT for Binance spot) or percentage (funding per hour). Monitoring runs while the app is running; once defaults true.',
      parameters: parameters({
        action: {
          type: 'string',
          enum: ['create', 'list', 'pause', 'resume', 'close'],
        },
        id: { type: 'string' },
        instrumentId,
        metric: {
          type: 'string',
          enum: ['price', 'changePct', 'fundingHourlyPct'],
        },
        direction: { type: 'string', enum: ['above', 'below'] },
        threshold: { type: 'number' },
        once: { type: 'boolean' },
      }),
      execute(callId, args: any) {
        const s = resolveService();
        if (args.action === 'create') {
          const c = toolContext.getStore();
          return {
            alert: s.createAlert(
              { ...args, instrument: instrument(args) },
              createHash('sha256')
                .update(`${c?.runId ?? 'manual'}:${callId}`)
                .digest('hex'),
            ),
          };
        }
        if (['pause', 'resume', 'close'].includes(args.action))
          return {
            alert: s.setAlert(
              args.id,
              args.action === 'resume'
                ? 'active'
                : args.action === 'pause'
                  ? 'paused'
                  : 'closed',
            ),
          };
        return { alerts: s.alerts(), notifications: s.notifications() };
      },
    }),
  ].map((tool) =>
    tool.name === 'market_set_view'
      ? { ...tool, executionMode: 'sequential' as const }
      : tool,
  );
}
export const marketsTools = createMarketsTools();
