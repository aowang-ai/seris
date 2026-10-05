/**
 * strategy/types.ts — pure-function strategy contract.
 *
 * A Strategy is a plain object with declarative metadata plus an onCandle
 * function. There is no class, no `this`, no instance state. All account
 * state (cash, position, current stop/take-profit) lives in the engine and
 * is passed in via the Context snapshot.
 *
 * Signals are data, not side effects. The engine inspects the returned
 * Signal and decides what to fill. This keeps strategies easy for an LLM
 * to author — write a function, return an object — and easy for the type
 * system to validate.
 */

/** Single OHLCV candle in chronological order. */
export interface Candle {
  /** Unix milliseconds, inclusive. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

export type PositionSide = 'long' | 'short';

export interface OpenPosition {
  side: PositionSide;
  /** Absolute quantity of the base asset. */
  size: number;
  /** Average entry price. */
  entryPrice: number;
  /** Signed quantity: positive for long, negative for short. */
  signedSize: number;
  /** Unix ms when the position was opened. */
  openedAt: number;
}

/** Frozen snapshot of account state given to the strategy. */
export interface Context {
  /** Free cash available to allocate (quote currency). */
  cash: number;
  /** Currently open position, or null when flat. */
  position: OpenPosition | null;
  /** Active stop-loss price set by the last enter or adjust signal. */
  stopPrice: number | null;
  /** Active take-profit price, when the strategy set one. */
  takeProfitPrice: number | null;
  /** All fills so far in this run, in chronological order. */
  fills: ReadonlyArray<Fill>;
  /** Convenience: index of the current bar in the full candle array. */
  barIndex: number;
}

export interface Fill {
  time: number;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  /** Fee paid in quote currency. */
  fee: number;
  /** Strategy-supplied reason for the parent signal. */
  reason: string;
  /** Engine tag: 'signal' (from strategy) | 'stop' | 'take-profit' | 'end' (forced close). */
  via: 'signal' | 'stop' | 'take-profit' | 'end';
  /** Signed size delta applied: +size for buy, -size for sell. */
  signedDelta: number;
}

/** Pure-data signal a strategy returns each bar. */
export type Signal =
  | { kind: 'hold' }
  | {
      kind: 'enter-long';
      /** Quote-currency notional to allocate. Must be > 0. */
      notional: number;
      reason: string;
      stopPrice?: number;
      takeProfitPrice?: number;
    }
  | {
      kind: 'enter-short';
      notional: number;
      reason: string;
      stopPrice?: number;
      takeProfitPrice?: number;
    }
  | { kind: 'exit'; reason: string }
  /** Move the stop-loss (e.g. trailing). No fill is created. */
  | { kind: 'adjust-stop'; stopPrice: number; reason?: string }
  /** Move the take-profit. No fill is created. */
  | { kind: 'adjust-take-profit'; takeProfitPrice: number; reason?: string };

/** Declarative tunable parameter. */
export interface ParamSpec {
  type: 'int' | 'float' | 'boolean' | 'string';
  default: number | boolean | string;
  min?: number;
  max?: number;
  /** Free-text description the LLM/CLI can show. */
  description?: string;
}

export type ParamValues = Record<string, number | boolean | string>;

export interface Strategy {
  /** Lowercase kebab id, unique inside its directory. */
  name: string;
  /** One-line human description shown in catalogs. */
  description?: string;
  /** Candle timeframe this strategy was designed around. */
  timeframe: Timeframe;
  /** Tunable parameters. Statically known by the engine and the LLM. */
  params: Record<string, ParamSpec>;
  /**
   * Number of leading candles the strategy needs before its indicators are
   * meaningful. May depend on the effective param values. The engine skips
   * onCandle until at least this many candles are visible.
   */
  warmup(params: ParamValues): number;
  /**
   * Pure function. Receives candles chronologically up to and including the
   * current bar (closed bars only — no partial/live bar). Returns a signal.
   * Must not mutate `candles` or `ctx`.
   */
  onCandle(candles: Candle[], ctx: Context, params: ParamValues): Signal;
}
