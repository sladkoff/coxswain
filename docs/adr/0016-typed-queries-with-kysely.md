# 16. Typed queries with Kysely

Date: 2026-09-25

## Status

Accepted. Settles the SQLite library that [ADR 0005](0005-local-data-storage.md) left open (`node:sqlite`, already
in use) and adds a query builder on top of it.

## Context

The core has 43 hand-written `db.prepare(...)` calls. Each lists its columns in a string with `as` aliases
(`workspace_id as workspaceId`) and casts the result (`as AgentSession`). Nothing checks those strings or casts
against the schema: a renamed column, a typo in an alias or a missing column in a `select` shows up only at run
time, often as an `undefined` field in the UI. The schema changes often while the concepts settle (ADR 0005), so
this happens.

Migrations are a list of SQL strings in `src/core/db.ts`, run in order inside a transaction each, with
`pragma user_version` as the counter. That is what the migrators in Kysely and Drizzle do too.

## Decision

1. **Kysely for queries** in the core. Queries stay SQL-shaped, like today's, but table and column names and result
   types are checked by TypeScript.
2. **On `node:sqlite`**, through the `kysely-node-sqlite` dialect. No native module to rebuild for Electron.
3. **The `DB` type is written by hand** in `src/core/db.ts`, next to the migrations, and changed in the same commit as
   the migration that changes the table. Columns are snake_case in SQL and in the type; each module maps rows to its
   own camelCase types (e.g. `AgentSession`) in one place, as the `columns` strings do now.
4. **The migrations stay as they are**: the append-only list of SQL strings with `user_version`. Kysely's `Migrator`
   isn't used.
5. **Queries become async.** Every core call already reaches the UI through async IPC, so only the core's own call
   sites change.
6. **Raw SQL where Kysely gets in the way**, through Kysely's `sql` tag, so it still runs on the same connection.

## Alternatives considered

- **Drizzle.** A schema in TypeScript is the source of truth and drizzle-kit writes the migrations, including SQLite's
  table rebuilds, which we write by hand (migrations 11 and 14). Rejected for now: its migrations are generated files
  plus a journal, harder to bundle with electron-vite than a list of strings, and its query API is further from the
  SQL we already have. Worth another look if hand-written rebuilds become a burden.
- **`kysely-codegen`** to generate the `DB` type from a database. Saves writing the type, but needs a migrated
  database at build time and a generation step. The schema is small; by hand is fine.
- **better-sqlite3**, which Kysely's built-in dialect expects. Rejected: a native module that has to be rebuilt for
  each Electron version, for no gain over `node:sqlite`.
- **Keep raw SQL and add runtime checks** (e.g. zod on each row). Catches mistakes later than the compiler does and
  adds code to every query.
- **Kysely's `Migrator`**: named migration files and a table of its own. More moving parts than `user_version`, and a
  second history next to the 15 migrations already shipped.

## Consequences

- A column renamed in a migration but not in `DB`, or the reverse, is still possible; one place to keep in step
  instead of 43.
- JSON columns (`guides.groups`, `action_items.entry_ids`) are typed as `string` and still parsed by hand.
- One more dependency and one small community dialect, both pinned.
- Moving the core to a utility process later (devlog tech debt) is unaffected; Kysely doesn't care where it runs.
