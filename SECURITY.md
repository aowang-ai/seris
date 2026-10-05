# Security

Seris 0.1.x is an Alpha. Security fixes target the latest revision on `main`.
There is no security support commitment for older snapshots.

Report vulnerabilities privately through the repository's GitHub Security
Advisories page when private reporting is enabled. If it is unavailable, ask the
repository maintainer to enable a private reporting channel without posting
vulnerability details publicly.
Include the affected revision, reproduction steps and impact. Do not include
real credentials or customer data in a public issue.

Desktop model credentials are stored in the operating system credential store.
Local sessions, memory, installed skills and generated documents live in the
user data directory. Never commit that directory or an `.env` file.

The gateway binds to loopback and authenticates UI requests. Approval controls
tool actions, but the approved terminal is a full shell under the user's account.
`execute_code` uses Node permission controls; it is not an operating system
sandbox. Installed skill text and tool results should be treated as untrusted
content. Run the application with the permissions needed for your work.

Trading and wallet prototypes label mock data and simulated receipts. They must
not be presented as live balances, executed orders or broadcast transfers.

Run `pnpm audit --prod` for JavaScript dependencies and review Rust advisories
when updating native dependencies. A failed audit connection is not a clean
audit result. See [contributor checks](CONTRIBUTING.md#checks) for build and dependency checks.
