# Contributing to Latch

## Getting started

1. Use Node.js 22 or newer.
2. Install dependencies with `npm ci`.
3. Start the application with `npm run dev`.
4. Run `npm run build` before submitting a change.

## Code guidelines

- Keep provider-specific behavior inside `src/main/databases/` and expose it through the provider-neutral contracts.
- Keep Electron main, preload, shared, and renderer responsibilities separated.
- Prefer small modules with explicit typed boundaries.
- Treat database metadata and result sets as unbounded. Follow the performance rules in `AGENTS.md` for collection-heavy UI.
- Do not commit credentials, connection exports, local databases, generated bundles, or environment files.
- Do not add a dependency when the existing stack can solve the problem cleanly.

## Pull requests

- Explain the user-visible behavior and important architectural decisions.
- Include manual verification steps for UI behavior.
- Keep unrelated formatting or refactoring out of the change.
- Confirm that `npm run build` passes.
