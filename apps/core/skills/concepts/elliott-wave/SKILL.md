---
name: concept-elliott-wave
description: Elliott Wave — 5-wave impulse and 3-wave corrective structures with Fibonacci wave relationships. When to use it, the strict rules, and why it backtests poorly without human oversight. Concept-only reference.
metadata:
  seris:
    priority: 30
    tool_names: [strategy_get, strategy_backtest_history]
---

# Elliott Wave

## The three iron rules

Elliott Wave says markets move in **5-wave impulses** (in the direction of the trend) and **3-wave corrections** (against it). Three rules MUST hold; a wave count violating any one is invalid:

1. **Wave 2 never retraces more than 100% of wave 1.**
2. **Wave 3 is never the shortest of waves 1, 3, 5.**
3. **Wave 4 never enters the price territory of wave 1** (except in diagonal patterns).

These are necessary, not sufficient. A wave count satisfying all three may still be wrong.

## The Fibonacci guidelines (not rules, only tendencies)

| Wave | Typical relationship |
|---|---|
| Wave 2 | Retraces 50–61.8% of wave 1 |
| Wave 3 | Extends to 161.8% or 261.8% of wave 1 |
| Wave 4 | Retraces 23.6–38.2% of wave 3 |
| Wave 5 | Equals wave 1, or is 61.8% of (wave 1 + wave 3) |
| Wave B (of ABC) | Retraces 50–78.6% of wave A |
| Wave C | Equals wave A, or is 61.8% of wave A |

These are *guidelines*. A wave 2 that retraces 78.6% is still valid; a wave 4 that overlaps wave 1 is not (iron rule 3).

## Why this is hard to backtest

- **Swing-point detection is the whole game.** Elliott's waves are defined over *significant* swings, but "significant" is not quantified. Different analysts pick different pivots on the same chart.
- **Multiple valid counts at the same time.** A chart can often be counted as "wave 3 of 3" or "wave B of an ABC" simultaneously. Only the subsequent price action resolves the ambiguity — which a backtest cannot do in advance.
- **Rule violations force re-counting.** A wave count that breaks an iron rule doesn't just fail — it demands a different count be substituted, recursively.

The standard algorithmic approach:

1. Detect swing points via Zigzag (a swing is confirmed after price moves `minPct%` away from the extreme)
2. Try to fit 5-wave impulse and 3-wave corrective templates over the most recent swings
3. Reject candidates that violate iron rules
4. Score remaining candidates by Fibonacci fit
5. Emit a signal only when a candidate completes (e.g. end of wave 5, end of wave C)

The **Zigzag minPct parameter dominates the result**. Set it too tight and every wiggle is a wave; too loose and the structure is invisible.

## When Elliott Wave genuinely helps

- **Long timeframes** (daily, weekly) where swing structure is unambiguous
- **Confluence with other signals** (e.g. wave 5 completion + RSI divergence + volume climax)
- **As a descriptive framework**, not a predictive one — "this rally looks like wave 3 of an impulse that started in March" is a useful frame, even if it doesn't tell you what to do tomorrow

## When it fails

- **Below 1h timeframe** — too much noise, every wave count is arbitrary
- **Alone, as an entry signal** — wave completion does not guarantee reversal; wave 5 can extend
- **In choppy, range-bound markets** — the theory needs trends to structure itself

## Honest recommendation for the user

If the user asks for an Elliott Wave backtest:

1. State up front: "Elliott Wave's value is structural analysis, not systematic entry. A naive wave-counting backtest will have many false signals."
2. Offer the simpler, more honest alternative: **Zigzag-based swing detection + Fibonacci retracement entry** (e.g. "buy a 61.8% retrace of the most recent impulse"). This captures the spirit without the counting ambiguity.
3. Only if the user insists on full Elliott counting, ask them to specify: Zigzag minPct, max wave-2 retrace, which Fibonacci ratios to enforce strictly.

**No code example in this build.** A correct Elliott Wave counter is a multi-thousand-line project. The `smc-ict` concept (swing + BOS/ChoCH) captures much of the practical value with a fraction of the ambiguity.
