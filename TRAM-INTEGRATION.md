# Trạm integration of upstream CCAM

This checkout is the actual [Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) application, upstream commit `3c2034c47e32382b698e4d4e1a8d353f1bba76a7`, version 2.4.3. It is distributed under MIT, copyright Son Nguyen; preserve `LICENSE` when distributing it.

The client already includes Vietnamese translations in all 15 namespaces. No translation strings or upstream UI components were changed. The isolated launcher selects `vi` on first use while preserving an existing language preference. It suppresses the first-run hook installation prompt because Trạm explicitly forwards its own job lifecycle events.

## Build

The root setup script installs hooks/links a CLI and is intentionally not used. Dependencies were installed with lifecycle scripts disabled. Node 24's built-in SQLite fallback supports this installation without compiling `better-sqlite3`.

```text
pnpm --ignore-workspace import
pnpm --ignore-workspace install --ignore-scripts --frozen-lockfile
cd client
pnpm --ignore-workspace import
pnpm --ignore-workspace install --ignore-scripts --frozen-lockfile
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

`--ignore-workspace` prevents the parent workspace from receiving the install. Imported pnpm lockfiles preserve the npm lockfile's resolved versions.

## Isolated launch

`tram-bootstrap.mjs` starts upstream Express routes, SQLite, built client and WebSocket on `127.0.0.1:4820`. It requires a server-only token file with at least 32 characters and supports dedicated `DASHBOARD_DATA_DIR`. The launcher redirects dashboard Claude/Codex homes to isolated directories. It does not call upstream `startServer()` (which publishes a user-global registry) or `startBackgroundServices()` (which scans/imports native transcripts), and does not install hooks, plugins or a global CLI.

```text
DASHBOARD_TOKEN_FILE=<private absolute file path>
DASHBOARD_DATA_DIR=<dedicated monitor data directory>
node tram-bootstrap.mjs
```

Keep the token on the server. An authenticated Trạm proxy should forward API requests with `x-dashboard-token` and WebSocket upgrades with the same header. Browser URLs, storage and injected JavaScript must not contain it.

The upstream client uses absolute `/api` and `/ws` URLs and `BrowserRouter` at `/`; it has no native base-path option. Embed it through a **dedicated origin**, with every request and WebSocket upgrade authorized against the Trạm local-admin session. A `/monitor` prefix proxy alone will not cover upstream routing. The intended lower control panel is read-only: the bootstrap rejects mutation routes except the private Codex lifecycle bridge. Run jobs and manage accounts in Trạm.

## Job lifecycle bridge

`tram-bridge.mjs` exports `sendJobLifecycle(job, phase, {tokenFile, baseURL})`. Send only explicitly selected Trạm jobs, with `phase` one of `start`, `completed`, `failed`, `cancelled`. `start` forwards upstream `SessionStart` then `UserPromptSubmit`; terminal phases forward the matching completion/end lifecycle. Sessions are namespaced as `tram-<job.id>`. Prompt, attachment and generated source content are not forwarded. No native Codex hook configuration is changed.

This gives the actual upstream dashboard live Trạm session/agent states. It does not fabricate token usage, cost or tool traces; those remain unavailable unless a future bridge explicitly supplies verified runtime events.

## Validation scope

The upstream client TypeScript build and Vite production build are run. Targeted Vietnamese i18n parity and isolated bootstrap/bridge smoke checks are appropriate for this local integration. Full upstream server/client/MCP/desktop test suites are not required to modify the untouched upstream behavior and have not been run as part of this integration. Upstream full guides/wiki were intentionally left unchanged because all integration behavior lives in the separate wrapper files above.
