# Latch

Latch is a focused desktop SQL workspace built with Electron, React, TypeScript, MUI, and Monaco.

The project is an early MVP. It prioritizes a fast query workflow, a compact database explorer, and a provider-neutral architecture over full IDE coverage.

## Supported providers

- PostgreSQL
- MySQL
- Microsoft SQL Server
- Azure SQL
- SQLite

## Features

- Persist multiple database connections
- Encrypt server passwords with Electron `safeStorage`
- Discover databases visible to the configured login
- Browse schemas, tables, views, columns, stored procedures, functions, and triggers where supported
- Open database-specific query tabs and restore their SQL and selected databases between launches
- Edit SQL with Monaco and run the current selection or full query with `Cmd/Ctrl + Enter`
- Inspect virtualized query results without loading every row into the DOM
- Select and copy cells or rows, with or without column headers
- Resize result columns and application panels
- Inspect query errors and execution messages
- Choose light, dark, or system appearance

## Development

### Requirements

- Node.js 22 or newer
- npm

Install the locked dependencies and start the Electron development process:

```bash
npm ci
npm run dev
```

Run the same validation used in CI:

```bash
npm run build
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Electron with the development server |
| `npm run typecheck` | Type-check the main, preload, shared, and renderer code |
| `npm run build` | Type-check and create production bundles in `out/` |
| `npm run package` | Build unpacked bundles and installers for the current platform |
| `npm run package:mac` | Build macOS DMG and ZIP artifacts |
| `npm run package:win` | Build Windows NSIS and ZIP artifacts |
| `npm run package:linux` | Build Linux AppImage and tarball artifacts |
| `npm run preview` | Preview the production Electron bundles |

Installer output is written to `release/`.

## Desktop builds

The `Desktop builds` GitHub Actions workflow can be started manually from the Actions tab. It packages macOS, Windows, and Linux builds and retains them as workflow artifacts for 14 days.

Pushing a version tag also creates a GitHub release and attaches all installers:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The current artifacts are unsigned. macOS and Windows may warn when opening them until code-signing and macOS notarization credentials are configured.

## Architecture

The renderer has no direct Node.js access. Database and filesystem operations live in the Electron main process behind a typed, context-isolated preload API.

- `src/main/providers.ts` is the provider registry and routing boundary.
- `src/main/databases/` contains one adapter per database protocol.
- `src/main/connections.ts` owns persisted definitions and encrypted credentials.
- `src/main/ipc.ts` exposes the provider-neutral application API.
- `src/shared/` contains contracts shared across Electron processes.
- `src/renderer/src/features/` contains feature-owned state, effects, persistence, and views, including separate connection, metadata, explorer, and query-workspace controllers.
- `src/renderer/src/App.tsx` is the composition shell for those features.
- `src/renderer/src/components/DatabaseExplorer.tsx` owns the database object tree.
- `src/renderer/src/results/` contains result virtualization, selection, and copying logic.
- `src/renderer/src/theme.ts` defines the MUI design system.

See [docs/architecture.md](docs/architecture.md) for the renderer ownership model and dependency boundaries.

Adding a provider means registering its definition and implementing connection testing, database discovery, metadata discovery, query execution, and session cleanup.

## Local data and security

- Connection definitions are stored under Electron's platform-specific application data directory.
- Server passwords are encrypted with Electron `safeStorage` before being written to disk.
- Query drafts, tab state, panel layouts, and appearance settings are stored in renderer local storage.
- Credentials are kept out of renderer-facing connection objects.
- Local database files and environment files are ignored by Git to reduce the chance of committing sensitive data.

Do not use production credentials while evaluating an untrusted build.

## Project status

Latch is under active development. Expect incomplete SQL autocomplete, provider-specific metadata differences, and breaking storage changes before a stable release.

See [plans/monaco-autocomplete.md](plans/monaco-autocomplete.md) for the intentionally small autocomplete roadmap.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Repository-specific engineering constraints are documented in [AGENTS.md](AGENTS.md).

## License

No license has been selected yet. Until one is added, the repository is not licensed for reuse or redistribution.
