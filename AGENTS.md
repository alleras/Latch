# Latch Engineering Guidance

## Performance rules

- Treat database metadata and query results as unbounded collections. Do not design collection UI around small development fixtures.
- Keep interaction state at the smallest component that owns the interaction. Expanding, selecting, or resizing one item must not rerender an entire tree, grid, editor, or application shell.
- Normalize and index relationships when data enters the renderer. Do not perform repeated linear joins or nested collection scans during render.
- Isolate urgent input updates from expensive derived views. Defer filtering work and render only the descendants needed to show a match.
- Virtualize large visible collections. For hierarchical data, use isolated memoized subtrees at minimum and flatten plus virtualize when visible node counts can grow substantially.
- Preserve expensive mounted views across navigation when their state is expected to survive, particularly editors and result grids. Hide or suspend them instead of remounting them on every tab switch.
- Before considering collection-heavy UI complete, verify it against a large synthetic fixture representative of real databases, including thousands of objects or rows and wide records.
