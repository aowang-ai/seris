/**
 * strategy/runner.ts — event-driven single-instrument backtest engine.
 *
 * Bar-by-bar semantics, designed to be honest about the three classic
 * look-ahead traps:
 *
 *  1. Signals come from bars the strategy has actually seen.
 *     `onCandle` is called with `candles[0..i]` (inclusive of the just-
 *     closed bar). The strategy cannot peek at `candles[i+1]`.
 *  2. Fills happen on the NEXT bar's open, not on the bar that produced
 *     the signal. A strategy that emits `enter-long` on bar i is filled
 *     at `candles[i+1].open`. This is the standard "signal on close,
 *     execute on next open" convention Freqtrade popularized.
 *  3. Stop-loss and take-profit are checked against each bar's high/low,
 *     independent of the strategy's signal. If a bar's low crosses the
 *     stop, the position closes at the stop price — even if the strategy
 *     returned `hold` that bar. Stops take precedence over take-profits
 *     when both cross on the same bar (conservative).
 *
 * Market orders only. Fees are a flat bps rate on notional; slippage is
 * another flat bps added against the trader (worse fill for buys, better
 * for sells omitted — we always model the worst case for buys).
 */

import type {
  BacktestMarket,
  Candle,
  Context,
  Fill,
  OpenPosition,
  ParamValues,
  Signal,
  Strategy,
  Timeframe,
} from './types.js';

export interface BacktestOptions {
  strategy: Strategy;
  candles: Candle[];
  /** Actual candle interval; defaults to the strategy's preferred interval. */
  timeframe?: Timeframe;
  params?: Partial<ParamValues>;
  initialCash: number;
  /** Taker fee in basis points, applied on notional. Default 5 (0.05%). */
  feeBps?: number;
  /** Slippage in basis points applied on top of the price, against the trader. Default 5. */
  slippageBps?: number;
  /** If true, force-close any open position at the last bar's close. Default true. */
  closeAtEnd?: boolean;
  /** Progress callback for long runs. */
  onProgress?: (done: number, total: number) => void;
}

export interface EquityPoint {
  time: number;
  equity: number;
  cash: number;
  positionValue: number;
  price: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  /** Annualized using the actual bar spacing, assuming continuous compounding. */
  annualizedReturn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  /** Null means profit with no losing trades (an unbounded ratio). */
  profitFactor: number | null;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  /** Total fees paid, quote currency. */
  totalFees: number;
  totalBars: number;
  /** Bars between first and last candle. */
  durationDays: number;
}

export interface BacktestResult {
  market?: BacktestMarket;
  strategyName: string;
  params: ParamValues;
  timeframe: Timeframe;
  initialCash: number;
  finalEquity: number;
  candles: number;
  /** The full candle series used by the run. Persisted alongside the result so the UI can render the chart without re-fetching. */
  candleSeries: Candle[];
  fills: Fill[];
  equity: EquityPoint[];
  stopTrail?: { time: number; value: number }[];
  metrics: BacktestMetrics;
}

interface State {
  cash: number;
  position: OpenPosition | null;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  fills: Fill[];
}

const MS_PER_DAY = 86_400_000;

/** Resolve effective params: declared defaults plus overrides, then clamped/typed. */
export function resolveParams(strategy: Strategy, overrides: Partial<ParamValues> = {}): ParamValues {
  for (const key of Object.keys(overrides)) {
    if (!(key in strategy.params)) {
      throw new Error(`param "${key}" not declared by strategy "${strategy.name}"`);
    }
  }
  const out: ParamValues = {};
  for (const [key, spec] of Object.entries(strategy.params)) {
    const raw = overrides[key] ?? spec.default;
    if (spec.type === 'int' || spec.type === 'float') {
      let n = typeof raw === 'string' ? Number(raw) : (raw as number);
      if (!Number.isFinite(n)) throw new Error(`param "${key}": expected number, got ${JSON.stringify(raw)}`);
      if (spec.type === 'int') n = Math.trunc(n);
      if (spec.min !== undefined && n < spec.min) n = spec.min;
      if (spec.max !== undefined && n > spec.max) n = spec.max;
      out[key] = n;
    } else if (spec.type === 'boolean') {
      out[key] = typeof raw === 'string' ? raw === 'true' || raw === '1' : Boolean(raw);
    } else {
      out[key] = String(raw);
    }
  }
  return out;
}

function applySlippage(price: number, side: 'buy' | 'sell', bps: number): number {
  const f = bps / 10_000;
  return side === 'buy' ? price * (1 + f) : price * (1 - f);
}

function snapshotContext(state: State, barIndex: number): Context {
  return {
    cash: state.cash,
    position: state.position,
    stopPrice: state.stopPrice,
    takeProfitPrice: state.takeProfitPrice,
    fills: state.fills,
    barIndex,
  };
}

function closePosition(
  state: State,
  price: number,
  time: number,
  reason: string,
  via: Fill['via'],
  feeBps: number,
): void {
  const pos = state.position;
  if (!pos) return;
  const notional = pos.size * price;
  const fee = (notional * feeBps) / 10_000;
  if (pos.side === 'long') {
    // Return the proceeds
    state.cash += notional - fee;
  } else {
    // Short: we deposited the sale proceeds at entry (state.cash += entryNotional - entryFee).
    // Now we buy back at the covering price plus fee. PnL cash-flows through `cash` only.
    state.cash -= notional + fee;
  }
  state.fills.push({
    time,
    side: pos.side === 'long' ? 'sell' : 'buy',
    size: pos.size,
    price,
    fee,
    reason,
    via,
    signedDelta: pos.side === 'long' ? -pos.size : pos.size,
  });
  state.position = null;
  state.stopPrice = null;
  state.takeProfitPrice = null;
}

function openPosition(
  state: State,
  side: 'long' | 'short',
  notional: number,
  price: number,
  time: number,
  reason: string,
  feeBps: number,
): void {
  if (state.position) return; // already in a position; engine ignores re-entries
  if (notional <= 0) return;
  const size = notional / price;
  const fee = (notional * feeBps) / 10_000;
  if (side === 'long') {
    if (notional + fee > state.cash + 1e-9) return; // insufficient funds
    state.cash -= notional + fee;
    state.position = { side, size, entryPrice: price, signedSize: size, openedAt: time };
  } else {
    // Short: proceeds arrive in cash; the obligation to buy back lives in `position`.
    state.cash += notional - fee;
    state.position = { side, size, entryPrice: price, signedSize: -size, openedAt: time };
  }
  state.fills.push({
    time,
    side: side === 'long' ? 'buy' : 'sell',
    size,
    price,
    fee,
    reason,
    via: 'signal',
    signedDelta: side === 'long' ? size : -size,
  });
}

function markToMarket(state: State, price: number, time: number): EquityPoint {
  const pos = state.position;
  let positionValue = 0;
  let equity = state.cash;
  if (pos) {
    if (pos.side === 'long') {
      positionValue = pos.size * price;
      equity = state.cash + positionValue;
    } else {
      // Short: we deposited entryNotional at entry. The cost to close now is
      // pos.size * price. Equity = cash (incl. deposit) − cost-to-close.
      positionValue = -pos.size * price;
      equity = state.cash - pos.size * price;
    }
  }
  return { time, equity, cash: state.cash, positionValue, price };
}

function checkStopTp(state: State, barDebug: Candle): { hit: 'stop' | 'take-profit' | null; price?: number } {
  const pos = state.position;
  if (!pos) return { hit: null };
  const { high, low } = barDebug;
  if (pos.side === 'long') {
    if (state.stopPrice !== null && low <= state.stopPrice) return { hit: 'stop', price: state.stopPrice };
    if (state.takeProfitPrice !== null && high >= state.takeProfitPrice) return { hit: 'take-profit', price: state.takeProfitPrice };
  } else {
    if (state.stopPrice !== null && high >= state.stopPrice) return { hit: 'stop', price: state.stopPrice };
    if (state.takeProfitPrice !== null && low <= state.takeProfitPrice) return { hit: 'take-profit', price: state.takeProfitPrice };
  }
  return { hit: null };
}

export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const { strategy, candles, initialCash } = opts;
  if (!candles.length) throw new Error('runBacktest: empty candles');
  const params = resolveParams(strategy, opts.params);
  const feeBps = opts.feeBps ?? 5;
  const slippageBps = opts.slippageBps ?? 5;
  const closeAtEnd = opts.closeAtEnd ?? true;
  const warmup = Math.max(0, Math.trunc(strategy.warmup(params)));
  if (candles.length <= warmup) {
    throw new Error(`runBacktest: only ${candles.length} candles, strategy needs > ${warmup}`);
  }

  const state: State = {
    cash: initialCash,
    position: null,
    stopPrice: null,
    takeProfitPrice: null,
    fills: [],
  };
  const equity: EquityPoint[] = [];
  const stopTrail: { time: number; value: number }[] = [];
  let pending: Signal = { kind: 'hold' };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    // Apply only the previous closed bar's signal, at this bar's open.
    // Future fills must not affect an earlier bar's account snapshot.
    switch (pending.kind) {
      case 'enter-long':
      case 'enter-short': {
        if (state.position) break;
        const side = pending.kind === 'enter-long' ? 'long' : 'short';
        const price = applySlippage(bar.open, side === 'long' ? 'buy' : 'sell', slippageBps);
        openPosition(state, side, Math.max(0, pending.notional), price, bar.time, pending.reason, feeBps);
        if (state.position && pending.stopPrice !== undefined) state.stopPrice = pending.stopPrice;
        if (state.position && pending.takeProfitPrice !== undefined) state.takeProfitPrice = pending.takeProfitPrice;
        break;
      }
      case 'exit': {
        if (state.position) {
          const side = state.position.side === 'long' ? 'sell' : 'buy';
          closePosition(state, applySlippage(bar.open, side, slippageBps), bar.time, pending.reason, 'signal', feeBps);
        }
        break;
      }
      case 'adjust-stop':
        if (state.position) state.stopPrice = pending.stopPrice;
        break;
      case 'adjust-take-profit':
        if (state.position) state.takeProfitPrice = pending.takeProfitPrice;
        break;
    }
    if (state.position && state.stopPrice !== null) stopTrail.push({ time: bar.time, value: state.stopPrice });

    // Stops and take-profits also apply to a position opened on this bar.
    const trigger = checkStopTp(state, bar);
    if (trigger.hit && trigger.price !== undefined && state.position) {
      const rawPrice = trigger.price;
      const side = state.position.side === 'long' ? 'sell' : 'buy';
      const price = applySlippage(rawPrice, side, slippageBps);
      closePosition(state, price, bar.time, trigger.hit === 'stop' ? 'stop-loss hit' : 'take-profit hit', trigger.hit, feeBps);
    }

    // 2. Strategy call (skip until warmup complete)
    let signal: Signal = { kind: 'hold' };
    if (i + 1 > warmup) {
      const slice = candles.slice(0, i + 1);
      signal = strategy.onCandle(slice, snapshotContext(state, i), params) ?? { kind: 'hold' };
    }

    pending = signal;

    equity.push(markToMarket(state, bar.close, bar.time));
    opts.onProgress?.(i + 1, candles.length);
  }

  if (closeAtEnd && state.position) {
    const last = candles[candles.length - 1];
    const side = state.position.side === 'long' ? 'sell' : 'buy';
    const price = applySlippage(last.close, side, slippageBps);
    closePosition(state, price, last.time, 'end of backtest', 'end', feeBps);
    // Update final equity after the close
    equity[equity.length - 1] = markToMarket(state, last.close, last.time);
  }

  const timeframe = opts.timeframe ?? strategy.timeframe;
  const metrics = computeMetrics(equity, state.fills, initialCash, timeframe);
  return {
    strategyName: strategy.name,
    params,
    timeframe,
    initialCash,
    finalEquity: equity.length ? equity[equity.length - 1].equity : initialCash,
    candles: candles.length,
    candleSeries: candles,
    fills: state.fills,
    equity,
    stopTrail,
    metrics,
  };
}

function computeMetrics(equity: EquityPoint[], fills: Fill[], initialCash: number, timeframe: Timeframe): BacktestMetrics {
  const totalBars = equity.length;
  const first = equity[0], last = equity[equity.length - 1];
  const finalEquity = last?.equity ?? initialCash;
  const durationDays = totalBars > 1 ? (last.time - first.time) / MS_PER_DAY : 0;
  const totalReturn = initialCash > 0 ? finalEquity / initialCash - 1 : 0;
  const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : 0;

  // Per-bar returns for volatility-based ratios
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) rets.push(equity[i].equity / prev - 1);
  }
  const barsPerYear = barsPerYearFor(timeframe);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0;
  const std = Math.sqrt(variance);
  const downside = rets.filter((r) => r < 0);
  const downsideVar = downside.length ? downside.reduce((s, r) => s + r * r, 0) / downside.length : 0;
  const downsideStd = Math.sqrt(downsideVar);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(barsPerYear) : 0;
  const sortino = downsideStd > 0 ? (mean / downsideStd) * Math.sqrt(barsPerYear) : 0;

  // Max drawdown on equity curve
  let peak = initialCash, maxDd = 0;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  // Trade stats: pair each entry fill with its matching exit fill
  const roundTrips = roundTripStats(fills);
  const winRate = roundTrips.count > 0 ? roundTrips.wins / roundTrips.count : 0;
  const profitFactor = roundTrips.grossLoss > 0 ? roundTrips.grossWin / roundTrips.grossLoss : roundTrips.grossWin > 0 ? null : 0;
  const totalFees = fills.reduce((s, f) => s + f.fee, 0);

  return {
    totalReturn,
    annualizedReturn,
    sharpe,
    sortino,
    maxDrawdown: maxDd,
    winRate,
    profitFactor,
    tradeCount: roundTrips.count,
    winningTrades: roundTrips.wins,
    losingTrades: roundTrips.losses,
    avgWin: roundTrips.wins > 0 ? roundTrips.grossWin / roundTrips.wins : 0,
    avgLoss: roundTrips.losses > 0 ? roundTrips.grossLoss / roundTrips.losses : 0,
    totalFees,
    totalBars,
    durationDays,
  };
}

function roundTripStats(fills: Fill[]) {
  // The engine holds one position and always closes it in full (no scaling).
  // Sum signed cash flows so short entries and covers count exactly as longs.
  let entry: Fill | null = null;
  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0, count = 0;
  for (const fill of fills) {
    if (!entry) { entry = fill; continue; }
    const pnl = -entry.signedDelta * entry.price - entry.fee
      - fill.signedDelta * fill.price - fill.fee;
    count++;
    if (pnl > 0) { wins++; grossWin += pnl; }
    else if (pnl < 0) { losses++; grossLoss -= pnl; }
    entry = null;
  }
  return { wins, losses, count, grossWin, grossLoss };
}

function barsPerYearFor(timeframe: Timeframe): number {
  const barsPerDay: Record<Timeframe, number> = {
    '1m': 1440, '3m': 480, '5m': 288, '15m': 96, '30m': 48,
    '1h': 24, '2h': 12, '4h': 6, '6h': 4, '8h': 3, '12h': 2,
    '1d': 1, '3d': 1 / 3, '1w': 1 / 7, '1M': 12 / 365,
  };
  return barsPerDay[timeframe] * 365;
}
