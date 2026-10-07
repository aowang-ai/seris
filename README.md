# Seris

**An AI market research assistant for your desktop.**

Seris connects conversation with a market workspace. Follow crypto, stocks, ETFs, commodities, FX and indices, inspect candlestick charts, and ask an agent to analyze what you are looking at or set a price alert.

**Status: 0.1.0 stable.** This release supports Chat, Markets, model settings and local strategy backtests on macOS Apple Silicon. Unfinished Automation and Portfolio pages and simulated account, trading and wallet tools are not exposed. Live order execution and wallet transfers are unavailable. Alerts run only while the app is running.

## Install

Download the Apple Silicon DMG from [Releases](https://github.com/aowang-ai/seris/releases). Open it and drag Seris to Applications. The app uses a complete ad-hoc signature and is not Apple-notarized. After the first blocked launch, go to **System Settings → Privacy & Security → Open Anyway** and approve Seris. See [Apple's instructions](https://support.apple.com/102445). Quit the old app before replacing it during an upgrade; conversations, watchlists, model configuration and user strategies remain in the application-data directory. A keychain prompt may ask you to authorize access to an existing model credential after an upgrade.

## Features

- **Chat:** persistent conversations, automatic titles, streaming responses and tool approvals.
- **Markets:** watchlists, search, TradingView candlestick charts, news and conditional alerts. Open Chat alongside a chart and share the current instrument, interval and selected range.
- **Models:** cloud providers, custom OpenAI/Anthropic-compatible endpoints, and model discovery from running Ollama or LM Studio servers.
- **Strategies:** review AI-authored TypeScript strategies before saving, backtest against Binance spot candles, and inspect persisted metrics, fills and charts. User strategies survive application upgrades; older drafts are migrated from runtime caches on first launch.
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

The supported desktop platform for 0.1.0 is macOS Apple Silicon. Windows, Linux and Intel Mac installers are not part of this release. See [Contributing](CONTRIBUTING.md) for additional checks and standalone gateway development.

## Market data

Market data uses public Hyperliquid perpetual, Binance spot, Binance USDT traditional-finance perpetual and Hyperliquid xyz APIs. Traditional-finance perpetuals cover supported stocks, ETFs, commodities, FX and indices; their quotes are contract prices. Use ticker codes when a venue does not support company-name searches. Funding rates are displayed as percentages per hour, with Binance settlement intervals applied before conversion. Availability depends on the source and region.

US stocks and ETFs are also available through the official Longbridge SDK: connect from Markets and complete browser authorization. Data access depends on your account permissions; the market-data integration does not submit trades. Crypto news requires `CRYPTOCOMPARE_API_KEY` in the startup environment.

Market views report missing data rather than inventing quotes or company information. US-stock alerts wait for fresh quotes when the latest quote is more than five minutes old.

## Project structure

| Directory | Purpose |
| --- | --- |
| `apps/core` | pi 1.0.2 agent runtime, gateway, tools, skills and persistent sessions |
| `apps/desktop-ui` | React / Vite / Tailwind interface |
| `apps/desktop` | Tauri / Rust shell, process supervision and desktop packaging |

The desktop shell bundles Node and the core runtime. The UI connects to the local gateway over HTTP and SSE; `apps/core/src/protocol.ts` defines their shared protocol.

## Local data

Desktop data lives in the system application-data directory. The standalone gateway uses the working directory. Override these with `SERIS_DATA_DIR`; use `SERIS_WORKSPACE` for the agent's task directory. Sessions, state, installed skills and generated artifacts remain local and are excluded from Git. Internal development notes in `docs/` are also excluded.

User strategies live in `skills/strategies/` within that data directory. Strategies can import types and indicator helpers from `@seris/strategy`; legacy relative SDK imports remain supported.

Browser tools require Chrome or `SERIS_BROWSER_PATH`. Approved terminal actions run a full shell under your account; Node permission controls are not an operating system sandbox. Read [Security](SECURITY.md) for details.

## License

Project-owned code and public documentation use [Apache-2.0](LICENSE). Seris branding has [separate terms](apps/desktop-ui/public/brand/LICENSE.md). Dependencies retain their own licenses.
