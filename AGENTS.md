# Working on Seris

This guide applies to the entire repository. Read it before changing code and keep it updated when the architecture, development workflow or maintainer's conventions change. Write this file in English. Explicit instructions from the user take precedence over repository guidance.

## Product and scope

Seris is a local desktop workspace for AI-assisted market research. It combines chat, market charts, model configuration, saved TypeScript strategies and historical backtests. The current release targets macOS Apple Silicon; the UI supports English and Chinese.

Use real integrations and describe their capabilities accurately. Only implemented tools belong in the runtime catalog. Prototype account, brokerage and wallet modules are not evidence that live trading is supported; live orders, wallet transfers and connected portfolio balances are outside the current release scope. Backtests are simulated historical results, not executed trades.

Start with [README.md](README.md) for the product, [CONTRIBUTING.md](CONTRIBUTING.md) for development details, and [SECURITY.md](SECURITY.md) for credentials and action permissions.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/core/src/runtime/` | pi agent integration, model settings, credentials, approvals and persistent sessions |
| `apps/core/src/gateway/` | Authenticated loopback HTTP API and server-sent events (SSE) |
| `apps/core/src/protocol.ts` | Shared UI/core contracts, protocol version and runtime validators |
| `apps/core/src/markets/` | Instruments, market providers and market state |
| `apps/core/src/strategy/` | Strategy SDK, loading, durable storage and backtest execution |
| `apps/core/src/tools/`, `extensions/` | pi tools and automatically discovered extension modules; see `EXTENSIONS.md` |
| `apps/core/skills/` | Bundled skill instructions and strategy examples |
| `apps/desktop-ui/src/` | React UI; `App.tsx` coordinates state and `seris.ts` owns gateway access |
| `apps/desktop-ui/src/components/` | Chat, Markets, Strategies and model/settings components |
| `apps/desktop-ui/src/locales.ts`, `i18n.tsx`, `index.css` | Translations, localization helpers and shared styling |
| `apps/desktop/src-tauri/` | Tauri/Rust shell, gateway supervision, native credentials and bundle configuration |
| `apps/desktop/scripts/` | Runtime resource preparation, size optimization and installed-bundle verification |
| `apps/core/test/` | Existing Node regression checks and UI fixtures; reuse only when needed |
| `.github/workflows/`, `.github/release-notes/` | CI, tag-triggered publishing and versioned release notes |
| `.github/assets/`, `apps/desktop-ui/public/brand/` | README media and licensed product branding |

## Development commands

Use the Node version in `.node-version` and the pnpm version in the root `package.json`. Native desktop development also needs Rust and the Tauri platform prerequisites. Use pnpm and preserve `pnpm-lock.yaml`; do not introduce another package manager or lockfile.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install the recorded workspace dependencies |
| `pnpm tauri:dev` | Run the desktop shell with the development UI and core |
| `pnpm build` | Build the core and UI workspace packages |
| `pnpm core:gateway` | Start the built standalone gateway; use its printed browser launch URL |
| `pnpm ui:dev` | Run Vite for browser UI development against a configured gateway |
| `pnpm -C apps/desktop run build:app --bundles app` | Build a native app for Computer Use verification |
| `pnpm tauri:build` | Build desktop release bundles |
| `pnpm typecheck` | Check workspace types when relevant |
| `pnpm test` | Build and run the existing full Node regression suite; not a default local step |

These are available commands, not a checklist to run for every change. See the validation policy below before choosing checks.

## Architecture and code conventions

- Keep the Rust shell focused on native responsibilities. Agent behavior, tools, market services and strategy logic belong in the core; UI interactions belong in the React package.
- Use strict TypeScript and ESM. Follow the surrounding file's style; ordinary TypeScript uses two-space indentation, single quotes and semicolons. Core relative imports use `.js` extensions for NodeNext output. Avoid unrelated formatting changes.
- Use explicit types at module and API boundaries, runtime validation for external input, and `import type` for type-only dependencies. Do not pull Node runtime modules into the browser bundle.
- Change shared API contracts in `protocol.ts`, update their validators and consumers together, and consider a protocol version change when compatibility changes. Preserve SSE ordering, reconnect behavior and snapshot restoration.
- Keep memory retrieval, layered memory and experience harvesting enabled; changes to learning policy require their own scope.
- Add capabilities through the extension module entry described in [EXTENSIONS.md](EXTENSIONS.md). Skills provide instructions, not tool activation. Tool discovery is scoped to the chat and must respect host allowlists and per-tool approvals.
- Reuse the existing pi runtime, tool registry and skill-loading path. Tool execution must propagate cancellation. Preserve SDK tool declarations when transforming model context.
- Do not introduce per-task limits on model turns or tool-call counts. Keep Stop/cancellation functional; provider context limits and network timeouts serve different purposes.
- Permission choices belong to the authenticated UI and persist per chat. New chats default to asking for gated actions; model-generated parameters must not elevate permissions. Read `SECURITY.md` before changing this boundary.
- Keep changes focused on the user's request. Reuse existing helpers and installed libraries; add dependencies or abstractions only when they solve a concrete need.

## UI and user experience

- Reuse existing components, Base UI primitives, theme styles and brand assets. Keep focus handling, keyboard navigation and accessible names intact.
- Add user-facing strings through the localization helpers and update both English and Chinese translations. Keep technical implementation details out of normal product flows.
- Keep controls compact and aligned, and check the narrower Markets chat layout when changing shared composer controls.
- Enter must not send a message while an input method is composing or confirming text. Preserve Chinese IME behavior in chat, search and model selection.
- Avoid triangle-based disclosure controls in settings and ordinary forms. Expandable details in chat are acceptable; use the established icon, label and right-side chevron treatment.

## Persistence, credentials and generated files

- Desktop data belongs in the operating system's application-data directory. Standalone runs default to the working directory; `SERIS_DATA_DIR` and `SERIS_WORKSPACE` can override data and task workspace locations. Use the existing path helpers.
- Preserve conversations, model metadata, watchlists, user strategies and backtest results across restarts and upgrades. Migrate existing records compatibly rather than resetting user data.
- User strategies must live in durable strategy storage, not a replaceable bundled-runtime cache. Bundled examples remain under `apps/core/skills/strategies/`; the public strategy import is `@seris/strategy`.
- Desktop model secrets belong in the operating system credential store. Never print, commit or copy API keys, launch tokens, private conversations or local account data into fixtures or public screenshots.
- Do not commit dependencies, `dist/`, Rust `target/`, generated Tauri resources, local runtime data or machine-specific files. Treat `.gitignore` as the reference and inspect new untracked output before staging it.
- Preserve upstream licenses and notices. Project code uses Apache-2.0; Seris branding has separate terms in `apps/desktop-ui/public/brand/LICENSE.md`.

## Testing and validation policy

**Do not add or run tests unless necessary.** Automated tests and full verification suites are not the default for every change.

- Prefer **Computer Use end-to-end verification in the actual client** for functional and UI changes. Follow the real user workflow, inspect the visible result, and rebuild only when needed to exercise the current code.
- For model, market and strategy workflows, use configured real models and real data. If credentials, services or the environment block verification, state the blocker and what remains unverified. Mocked results do not establish that the real end-to-end flow works.
- For documentation, copy and other low-risk changes, use a focused read-through or visual review. Do not add test files or run the full suite for these changes.
- Add automated tests only for a concrete risk that Computer Use cannot verify reliably, such as a migration, permission boundary or concurrency failure. Explain the risk, reuse an existing test file where practical, and add only the minimum useful cases.
- Do not create a test file for every feature, introduce a test framework for routine changes, or write tests that merely mirror the implementation.
- Select type checks, builds, security checks and existing tests according to the changed code and actual uncertainty. Existing CI/release workflows run their own checks; this does not require repeating every check for every local edit.
- Once verification passes, do not repeat or broaden it without further changes, a failure or an unresolved concern. Report what was actually verified and any remaining limits.

## Git, commits and review

- Inspect `git status` and the relevant diff before editing. Preserve existing work; do not reset, discard or include unrelated changes.
- Use the `codex/` prefix when creating a task branch unless the user specifies another name. Branch creation is not required for a documentation edit.
- Stage only intended files and review the staged diff. Keep commits focused; do not mix unrelated cleanup, generated artifacts or user data into a feature or fix.
- Write concise English commit subjects in the imperative, consistent with history: for example, `Fix market search row sizing` or `docs: explain the desktop development workflow`. Scope prefixes are optional, not an enforced format.
- Describe the concrete problem, resulting behavior and relevant validation in commit bodies or PR descriptions. State real verification limits; do not claim tests, live model calls or releases that did not happen.
- Do not rewrite shared history or move published tags as part of routine work. Treat tag creation and publishing as release work, not incidental cleanup.

## Releases and packaging

- Keep versions aligned across root/workspace `package.json` files, Tauri configuration, the Rust package and affected lockfiles. Release tags use `v<version>`; the release workflow checks the tag against the root package version.
- Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds and publishes a GitHub Release. Prepare versioned notes in `.github/release-notes/`; prerelease tags produce prereleases.
- Build on the target platform and architecture. Packaging includes the Node runtime and core resources; use the existing preparation and optimization scripts rather than manually editing generated bundles.
- Before publishing, verify the actual packaged client's startup and affected user flows with Computer Use. For stable releases, verify persistence when upgrading from the previous bundle using the documented checks in `CONTRIBUTING.md`.
- Keep macOS bundle signatures intact after packaging. Current installers use ad-hoc signing and are not notarized; describe that accurately in release notes and installation instructions.

Keep this guide concise and grounded in the repository. Update affected documentation when behavior or workflows change; do not turn temporary machine-specific workarounds into permanent repository rules.
