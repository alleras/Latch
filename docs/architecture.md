# Latch architecture

Latch separates application composition, feature controllers, UI, and Electron infrastructure.

## Renderer

- `App.tsx` composes the shell, dialogs, sidebar, and query workspace. It coordinates only workflows that cross feature boundaries.
- `features/connections` owns provider discovery and saved connection CRUD.
- `features/database-catalog` owns database/schema metadata, request deduplication, and caches.
- `features/database-explorer` owns the selected explorer context and its persistence.
- `features/query-workspace` owns tabs, query drafts, execution state, results, and workspace persistence. It also owns file binding for tabs opened from `.sql` files, the File menu's open and save commands, their unsaved state and close prompts, save workflows, and unsaved-edit backups. A tab may have no connection; it adopts the explorer's connection only on a user action (clicking the tab, closing the tab before it, reopening its file, picking a connection in the sidebar, or adding a connection). The shell passes the explorer's selection in; the workspace applies the adoption rule in those handlers.
- `features/query-workspace/editor` adapts Monaco. One editor instance is retained while each open query tab receives its own model and saved view state.
- `components` render reusable UI and keep only local interaction state.

The intended dependency direction is:

```text
App shell -> feature controllers -> preload API
          -> feature views       -> shared UI components
```

Feature views should not reach into another feature's state. Cross-feature actions are passed explicitly by the shell.

## Main process

- `index.ts` chooses between the desktop app (`app.ts`) and the `latch` command line (`cli/`), which runs when the launcher passes `--latch-cli`.
- `ipc.ts` exposes the application API.
- `menu.ts` and `menu-template.ts` own the application menu. File items only send commands to the renderer; the query workspace decides what they do.
- `sql-files.ts` reads and writes `.sql` files, detecting UTF-8 (with or without a BOM), UTF-16 and Windows-1252 and writing the same encoding back. `draft-backups.ts` keeps unsaved-edit backups under the application data directory, lands only the newest write for each tab, and prunes leftovers at launch. `file-access.ts` limits file reads and writes by path to files the user picked in an open or save dialog. All three are pure Node modules covered by unit tests.
- `connections.ts` owns persisted connection definitions and credentials.
- `providers.ts` routes provider-independent operations to provider adapters.
- `databases/*` contains provider implementations.
- `databases/session-cache.ts` owns reusable database session lifecycles.
- `databases/read-only-sql.ts` is the dialect-aware statement guard for read-only command line queries. Each provider's `executeBounded` adds database-level read-only enforcement where the database supports it, a timeout, and a row limit, on a dedicated connection that is closed afterwards.

### Command line

The `latch` command is a launcher script (`cli/launcher.ts`, installed by `cli/install.ts`) that starts the Latch executable with `--latch-cli -- <args>`. It must be the Latch executable because `safeStorage` keys belong to the app. `cli/main.ts` runs without a window, gives Chromium a temporary session directory so commands can run alongside the app and each other, and exits with the command's code.

`cli/program.ts` is the command runner. It takes its database access as injected services, so parsing (`cli/arguments.ts`), help (`cli/help.ts`), connection and object lookup (`cli/catalog.ts`), access rules, and output (`cli/output.ts`) are all covered by unit tests without Electron. Commands, options, and help text come from one table in `cli/spec.ts`. A future MCP server should reuse `program.ts`'s services and access rules rather than adding another path to the providers.

Per-connection access (`cliAccess`) is stored with the connection in `connections.ts` and edited in **Settings > Command line**. The connection store is replaced atomically on save because the command line reads it from another process.

## Performance model

Query tabs retain results and Monaco models across navigation. Tab activation switches the active Monaco model and result visibility; it must not recreate the editor, reload metadata, or rerender the database explorer unnecessarily.
