# Latch architecture

Latch separates application composition, feature controllers, UI, and Electron infrastructure.

## Renderer

- `App.tsx` composes the shell, dialogs, sidebar, and query workspace. It coordinates only workflows that cross feature boundaries.
- `features/database-catalog` owns connections, database/schema metadata, request deduplication, and caches.
- `features/database-explorer` owns the selected explorer context and its persistence.
- `features/query-workspace` owns tabs, query drafts, execution state, results, and workspace persistence.
- `features/query-workspace/editor` adapts Monaco. One editor instance is retained while each open query tab receives its own model and saved view state.
- `components` render reusable UI and keep only local interaction state.

The intended dependency direction is:

```text
App shell -> feature controllers -> preload API
          -> feature views       -> shared UI components
```

Feature views should not reach into another feature's state. Cross-feature actions are passed explicitly by the shell.

## Main process

- `ipc.ts` exposes the application API.
- `connections.ts` owns persisted connection definitions and credentials.
- `providers.ts` routes provider-independent operations to provider adapters.
- `databases/*` contains provider implementations.
- `databases/session-cache.ts` owns reusable database session lifecycles.

## Performance model

Query tabs retain results and Monaco models across navigation. Tab activation switches the active Monaco model and result visibility; it must not recreate the editor, reload metadata, or rerender the database explorer unnecessarily.
