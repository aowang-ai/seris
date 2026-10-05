# Contributing to Seris

Seris is an early Beta. Describe the user problem before proposing a large change. Keep contributions focused and reuse existing libraries where appropriate.

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

## Checks

```bash
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level high
```

Desktop changes also require a native build and resource checks on the target platform:

```bash
pnpm -C apps/desktop run build:app --bundles app
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node apps/desktop/scripts/verify-resources.mjs
node apps/desktop/scripts/verify-desktop.mjs # macOS interactive startup and recovery
```

Optional live model checks use `pnpm core:smoke` and `pnpm core:smoke:gateway`. These require model credentials and can incur provider charges. Offline tests do not require those credentials. UI regression tests require Chrome or an executable specified by `SERIS_BROWSER_PATH`.

## Contributions and reports

Issues should include the operating system, app version, reproduction steps and expected behavior. Remove API keys, account details and private conversations from logs and screenshots. Report vulnerabilities as described in [Security](SECURITY.md).

Preserve upstream licenses and notices when importing code or assets. Record the source, version, license and modifications in your pull request. Do not contribute proprietary code, prompts or skill instructions without redistribution rights.

Contributions use the [project license](LICENSE). Seris branding has the separate terms in [the brand license](apps/desktop-ui/public/brand/LICENSE.md).
