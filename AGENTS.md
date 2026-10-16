# Latch Engineering Guidance

## Performance rules

- Treat database metadata and query results as unbounded collections. Do not design collection UI around small development fixtures.
- Keep interaction state at the smallest component that owns the interaction. Expanding, selecting, or resizing one item must not rerender an entire tree, grid, editor, or application shell.
- Normalize and index relationships when data enters the renderer. Do not perform repeated linear joins or nested collection scans during render.
- Isolate urgent input updates from expensive derived views. Defer filtering work and render only the descendants needed to show a match.
- Virtualize large visible collections. For hierarchical data, use isolated memoized subtrees at minimum and flatten plus virtualize when visible node counts can grow substantially.
- Preserve expensive mounted views across navigation when their state is expected to survive, particularly editors and result grids. Hide or suspend them instead of remounting them on every tab switch.
- For live resizing and other high-frequency interactions, use one shared layout owner or an established virtualized component; do not repeat the same layout calculation across every visible item. Coalesce writes to animation frames only after the layout scope is correct.
- Before considering collection-heavy UI complete, verify it against a large synthetic fixture representative of real databases, including thousands of objects or rows and wide records.

## Architecture rules

- Keep `App` as a composition shell. Feature state, effects, persistence, and async workflows belong to a feature controller or service with one clear owner.
- Keep related state together. Do not split one domain entity across component state, unrelated refs, and storage callbacks owned by different components.
- Wrap stateful third-party systems such as Monaco in a dedicated adapter hook. Preserve their long-lived instances and expose a small application-facing interface.
- Keep persistence behind the feature that owns the persisted data. Cross-feature migration code may read legacy fields, but new writes must not recreate the coupling.
- Prefer pure domain helpers plus thin UI components. Components may own local interaction state, but not unrelated application workflows.
