# Security

Seris 0.1.x is the initial stable release series for macOS Apple Silicon.
Security fixes target the latest stable release; update to that release when a
fix is available. Older releases and pre-release snapshots are not maintained.

Report vulnerabilities privately through the repository's GitHub Security
Advisories page when private reporting is enabled. If it is unavailable, ask the
repository maintainer to enable a private reporting channel without posting
vulnerability details publicly.
Include the affected revision, reproduction steps and impact. Do not include
real credentials or customer data in a public issue.

Desktop model credentials are stored in the operating system credential store.
Local sessions, memory, installed skills and generated documents live in the
user data directory. Never commit that directory or an `.env` file.

The gateway binds to loopback and authenticates UI requests. New chats use
**Ask every time** for gated actions such as saving strategies, terminal commands
and browser interactions. The composer offers **Allow all actions** for the
current chat; it persists across restarts and releases any pending tool approval
in that chat. Switching back restores confirmation for subsequent gated actions.
Only the authenticated UI API changes this permission mode; a model request
cannot select it through prompt parameters. Chats have no runtime cap on model
turns or tool calls, and the user can stop an active run from the composer.

An allowed terminal is a full shell under the user's account.
`execute_code` uses Node permission controls; it is not an operating system
sandbox. Installed skill text and tool results should be treated as untrusted
content. Run the application with the permissions needed for your work.

The released runtime does not register simulated account, brokerage or wallet
tools, or placeholder funding and desktop-control tools. Live order execution
and wallet transfers are outside this release's feature scope. Strategy
backtests must not be presented as executed trades or live portfolio returns.

Run `pnpm audit --prod` for JavaScript dependencies and review Rust advisories
when updating native dependencies. A failed audit connection is not a clean
audit result. See [contributor checks](CONTRIBUTING.md#checks) for build and dependency checks.
