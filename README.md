# Seris

**An AI trading assistant for your desktop.**

Seris connects conversation with a market workspace. Follow crypto, US stocks and ETFs, inspect candlestick charts, and ask an agent to analyze what you are looking at or set a price alert.

**Status: Alpha.** Chat, Markets and model settings are connected. Strategies, Automation and Portfolio pages are prototypes. Trading and wallet tools marked as simulated do not execute real transactions. Alerts run only while the app is running.

## Features

- **Chat:** persistent conversations, automatic titles, streaming responses and tool approvals.
- **Markets:** watchlists, search, TradingView candlestick charts, news and conditional alerts. Open Chat alongside a chart and share the current instrument, interval and selected range.
- **Models:** cloud providers, custom OpenAI/Anthropic-compatible endpoints, and model discovery from running Ollama or LM Studio servers.
- **Settings:** English and Chinese interfaces, provider configuration and model selection. Desktop API keys are stored in the operating system credential store.

## Run locally

Use the Node version in [`.node-version`](.node-version), **pnpm 12.5.1**, Rust, and the Tauri build prerequisites for your operating system.

```bash
pnpm install --frozen-lockfile
pnpm tauri:dev
```

Open **Settings → Models**, configure a provider and choose a default model. For local models, start Ollama or LM Studio first; Settings discovers models on their default ports, and supports custom endpoints. Testing a connection sends a short model request and may incur provider charges.

```bash
pnpm typecheck
pnpm test        # Offline regression checks; no live model or trading API calls
pnpm tauri:build
```

macOS desktop builds have been validated. Windows and Linux installers still need platform-specific validation. See [Contributing](CONTRIBUTING.md) for additional checks and standalone gateway development.

## Market data

Crypto prices use public Hyperliquid perpetual and Binance spot APIs. Availability depends on the source and region. US stocks and ETFs use the official Longbridge SDK: connect from Markets and complete browser authorization. Data access depends on your account permissions; the market-data integration does not submit trades. Crypto news requires `CRYPTOCOMPARE_API_KEY` in the startup environment.

Market views report missing data rather than inventing quotes or company information. US-stock alerts wait for fresh quotes when the latest quote is more than five minutes old.

## Project structure

| Directory | Purpose |
| --- | --- |
| `apps/core` | pi 1.0.2 agent runtime, gateway, tools, skills and persistent sessions |
| `apps/desktop-ui` | React / Vite / Tailwind interface |
| `apps/desktop` | Tauri / Rust shell, process supervision and desktop packaging |
| `licenses/upstream` | Supplemental third-party license texts used during packaging |

The desktop shell bundles Node and the core runtime. The UI connects to the local gateway over HTTP and SSE; `apps/core/src/protocol.ts` defines their shared protocol.

## Local data

Desktop data lives in the system application-data directory. The standalone gateway uses the working directory. Override these with `SERIS_DATA_DIR`; use `SERIS_WORKSPACE` for the agent's task directory. Sessions, state, installed skills and generated artifacts remain local and are excluded from Git. Internal development notes in `docs/` are also excluded.

Browser tools require Chrome or `SERIS_BROWSER_PATH`. Approved terminal actions run a full shell under your account; Node permission controls are not an operating system sandbox. Read [Security](SECURITY.md) for details.

## License

Project-owned code and public documentation use [Apache-2.0](LICENSE). Seris branding has [separate terms](apps/desktop-ui/public/brand/LICENSE.md). Fonts and dependencies retain their own licenses; see [Third-party software](THIRD-PARTY.md).
