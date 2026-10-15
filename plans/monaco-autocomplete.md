# Context-aware SQL autocomplete

## Goal

Make Monaco suggestions relevant to the cursor context without building a full SQL language service.

## First iteration

- Build a lightweight lookup index when the active schema changes.
- Inspect the current statement around the cursor.
- Suggest tables and views after `FROM` and `JOIN`.
- Suggest only a table's columns after `table.`.
- Resolve simple aliases such as `FROM users u` followed by `u.`.
- Re-enable automatic suggestions once completion no longer scans the whole schema per keystroke.

## Later improvements

- Columns visible in `SELECT`, `WHERE`, `GROUP BY`, and `ORDER BY`.
- CTEs, subqueries, multiple schemas, and dialect-specific behavior.
- Ranking, quoting, functions, and richer completion details.
- Replace the lightweight resolver with a parser or language service if its limits become costly.

## Guardrails

- Keep completion work off the React render path.
- Precompute schema data; do not rebuild a flat suggestion list while typing.
- Prefer useful partial support over pretending every SQL construct is understood.
