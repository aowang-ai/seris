# Contributing to Seris

Seris 0.1.x supports AI chat, real market data and local strategy backtests on macOS Apple Silicon. Describe the user problem before proposing a large change. Keep contributions focused and reuse existing libraries where appropriate. Register only implemented tools; prototypes and simulated account or trading tools must not enter the release catalog.

## Development

Use the Node version in `.node-version`, pnpm from `package.json`, and Rust for desktop work.

```bash
pnpm install --frozen-lockfile
pnpm tauri:dev
```

For standalone gateway development, build the workspace and start the gateway. It prints a one-time browser launch URL and can start without model credentials.

```bash
pnpm build
pnpm core:gateway
```

Standalone model credentials can be configured in the UI for the lifetime of the gateway, or through provider environment variables: `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY` / `MOONSHOT_CN_API_KEY`, and `KIMI_API_KEY`.

## Architecture and local data

The desktop shell bundles Node and the core runtime. The React UI connects to the local gateway over HTTP and SSE; [`apps/core/src/protocol.ts`](apps/core/src/protocol.ts) defines their shared protocol. The core uses the pi agent runtime.

Desktop data lives in the system application-data directory. The standalone gateway uses the working directory. Override these with `SERIS_DATA_DIR`; use `SERIS_WORKSPACE` for the agent's task directory. Sessions, state, installed skills and generated artifacts remain local and are excluded from Git. Internal development notes in `docs/` are also excluded.

User strategies live in `skills/strategies/` within that data directory. Strategies can import types and indicator helpers from `@seris/strategy`; legacy relative SDK imports remain supported. Older strategy drafts are migrated from runtime caches on first launch.

Browser tools require Chrome or `SERIS_BROWSER_PATH`. Approved terminal actions run a full shell under your account; Node permission controls are not an operating system sandbox. See [Security](SECURITY.md) for details.

## Checks

Follow the repository's [agent guidelines](AGENTS.md): do not add or run tests unless they are necessary for the change. Prefer end-to-end validation with Computer Use in the actual client, using a configured real model and real market data where relevant. Document any environment blocker and what remains unverified.

For low-risk documentation, copy or styling changes, use a focused review or visual check. Add automated tests only for concrete risks that are difficult to verify reliably through the UI; reuse existing test files and keep cases minimal. Do not create a test file for every feature or routinely run the full suite.

Choose existing checks according to the affected code and risk:

```bash
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level high
```

Build the native client when needed for end-to-end validation. Use the relevant native and resource checks for packaging, startup or release changes on the target platform:

```bash
pnpm -C apps/desktop run build:app --bundles app
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node apps/desktop/scripts/verify-resources.mjs
node apps/desktop/scripts/verify-desktop.mjs # macOS interactive startup and recovery
```

Before a stable release, also verify the actual previous and candidate bundles:

```bash
node apps/desktop/scripts/verify-upgrade.mjs /path/to/previous/Seris.app /path/to/candidate/Seris.app
```

This uses disposable app data and the bundles' own Node runtimes, checks conversation, model metadata, watchlist, strategy and backtest preservation, then removes the old runtime and checks again. It requires access to the Binance public API for real backtest candles. It does not read or modify the user's model credentials. The native startup check covers a fresh data directory; use the compiled client to verify the visible navigation and a real configured model before publishing.

Optional live model checks use `pnpm core:smoke` and `pnpm core:smoke:gateway`. These require model credentials and can incur provider charges. Offline tests do not require those credentials. UI regression tests require Chrome or an executable specified by `SERIS_BROWSER_PATH`.

## Contributions and reports

Issues should include the operating system, app version, reproduction steps and expected behavior. Remove API keys, account details and private conversations from logs and screenshots. Report vulnerabilities as described in [Security](SECURITY.md).

Preserve upstream licenses and notices when importing code or assets. Record the source, version, license and modifications in your pull request. Do not contribute proprietary code, prompts or skill instructions without redistribution rights.

Contributions use the [project license](LICENSE). Seris branding has the separate terms in [the brand license](apps/desktop-ui/public/brand/LICENSE.md).
