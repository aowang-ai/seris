---
name: concept-sentiment-analysis
description: Sentiment-driven trading using fear/greed index, funding rates, and news flow. What Seris supports today and how to combine sentiment with price action.
metadata:
  seris:
    priority: 27
    tool_names: [get_fear_greed, get_trending_tokens, get_global_market, get_crypto_news]
---

# Sentiment analysis

## What Seris has today

| Tool | Data |
|---|---|
| `get_fear_greed` | CNN-style crypto fear/greed index (0-100). Daily update. |
| `get_trending_tokens` | CoinGecko trending list — what's being searched right now |
| `get_global_market` | Total market cap, BTC dominance, volume |
| `get_crypto_news` | CryptoCompare news feed — headlines, not full text |

## The fear/greed contrarian rule

The most robust sentiment signal in crypto:

| FG value | Interpretation | Action bias |
|---|---|---|
| < 20 | Extreme fear | Accumulate (contrarian) |
| 20–40 | Fear | Cautious long bias |
| 40–60 | Neutral | No edge |
| 60–80 | Greed | Cautious short bias |
| > 80 | Extreme greed | Take profit / fade |

**Critical caveat:** fear/greed is a *daily* snapshot. It is not a real-time signal. A strategy that enters on "FG < 20" must accept that it is entering on yesterday's sentiment.

## Combining with price

Sentiment alone is a weak signal. The useful combination:

1. **FG < 20 + price near support** → long with conviction
2. **FG > 80 + price parabolic** → reduce size or tighten stop
3. **FG neutral + price trending** → no sentiment edge; rely on price action

## What Seris cannot do

- **Social media sentiment** (Twitter/X, Reddit, Telegram) — no API
- **Real-time sentiment** — fear/greed is daily, not intraday
- **Sentiment backtesting** — the engine does not have historical FG data in the candle feed

**No code example in this build.** A sentiment-aware strategy would need the FG value passed as a param override or fetched via a separate tool call before the backtest starts.
