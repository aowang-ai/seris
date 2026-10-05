---
name: concept-smc-ict
description: Smart Money Concepts (ICT) — market structure (BOS, ChoCH), order blocks, fair value gaps, and liquidity sweeps. When these signals help, when they don't, and how to translate them into a backtestable strategy.
metadata:
  seris:
    priority: 26
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Smart Money Concepts (ICT)

## What this is

ICT ("Inner Circle Trader") is a price-action framework built on one premise: large institutional orders leave footprints in price. The framework names those footprints and trades them.

Unlike indicator systems (MA, RSI, MACD), ICT is **rule-based price action**. Each concept is a structural property of recent candles, not a smoothed average.

## The four pieces you actually use

### 1. Market structure: BOS and ChoCH

- **Higher Highs (HH) + Higher Lows (HL)** = uptrend. **Lower Highs (LH) + Lower Lows (LL)** = downtrend.
- **BOS (Break of Structure)** — the trend continues: price breaks the previous HH in an uptrend. Confirmation signal.
- **ChoCH (Change of Character)** — trend transition: in an uptrend, the price fails to make a new HH and breaks the previous HL. Reversal warning.

In code, structure is computed over *swing points* — local extrema over `lookback` bars. A swing high is a bar whose high is the max of `lookback` bars before and `lookback` bars after. Without swing points there is no BOS/ChoCH.

### 2. Order Block (OB)

The last opposite-color candle before an impulsive move (a BOS). Institutions are presumed to have filled orders there, and the price tends to revisit the candle before continuing.

- **Bullish OB**: the last bearish (red) candle before an up BOS.
- **Bearish OB**: the last bullish (green) candle before a down BOS.

A standard long setup: price returns to the bullish OB, holds above its midpoint ("mean threshold"), enter long with a stop just below the OB low.

### 3. Fair Value Gap (FVG)

A three-candle pattern where the middle candle is so strong that candle 1's high and candle 3's low don't overlap. The "gap" region is a magnet for retests.

- **Bullish FVG**: `candle1.high < candle3.low`. The zone `[candle1.high, candle3.low]` is unfilled.
- **Bearish FVG**: `candle1.low > candle3.high`. The zone `[candle3.high, candle1.low]` is unfilled.

FVGs hold most often on the timeframe where they formed. On lower timeframes they get filled quickly.

### 4. Liquidity sweep

A quick poke *above* a swing high (or *below* a swing low) followed by an immediate rejection. Stops get swept, then price reverses. The signature is a long wick and a bar that closes back inside the prior range.

"Equal highs" (two swing highs within a few ticks) mark a *pool* of resting stop orders — a likely sweep target.

## Backtestable strategy shape

A practical SMC strategy is the composition:

```
1. Identify swing points over the last N bars
2. Track the current structure (uptrend/downtrend/transition)
3. On ChoCH in the trade direction, mark the OB before the move
4. Enter on a retest of the OB (close within the OB range)
5. Stop just beyond the OB
6. Take-profit at the next swing high/low, OR trail with structure
```

**The hard part is swing-point detection.** A common choice:

```typescript
function isSwingHigh(candles: Candle[], i: number, lb: number): boolean {
  if (i < lb || i + lb >= candles.length) return false;
  const h = candles[i].high;
  for (let k = i - lb; k <= i + lb; k++) {
    if (k !== i && candles[k].high >= h) return false;
  }
  return true;
}
```

Note that swing-point detection at bar `i` requires `lb` bars *after* `i`. This introduces a lag — your strategy sees the swing `lb` bars late. That lag is real and not a bug; do not "fix" it by reading future bars (that is look-ahead).

## Failure modes

- **Backtest confirms a sweep but live it doesn't fill** — sweeps are fast; your engine fills *next* bar, missing the wick. SMC strategies work better on higher timeframes where the entry situation lasts 2+ bars.
- **Structure computed differently by different implementations** — Mark Douglas's original definition vs. common schoolbook definitions disagree on what counts as HL/LH. Pick one and stick with it.
- **Over-clustering signals** — BOS + OB + FVG + sweep on the same bar sounds great but restricts fill count to ~1 per month. Adjust one filter at a time.
