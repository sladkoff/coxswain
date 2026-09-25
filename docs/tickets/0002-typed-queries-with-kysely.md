# 2. Typed queries with Kysely

## Status

Done.

## Goal

None directly: tech debt that slows every change to G2–G5 ([GOALS.md](../GOALS.md)).

## What

Nothing changes for the user. Every query in `src/core/` goes through Kysely on `node:sqlite`, typed against a `DB`
interface, so a wrong column name fails `pnpm typecheck` instead of showing `undefined` in the UI.

## Notes

- [ADR 0016](../adr/0016-typed-queries-with-kysely.md).
- Add `kysely`, pinned. Kysely's SQLite dialect runs on `node:sqlite` through a small adapter in `openDatabase`.
- `openDatabase` keeps running the migrations on the raw `DatabaseSync`, then wraps it in a `Kysely<DB>`. The core's
  functions take the `Kysely<DB>` instead of `DatabaseSync`.
- Write `DB` from the schema as migrated today (all 15 migrations), not from the first `create table`s: e.g.
  `comments` is gone, `agent_sessions` has `review_round_id`.
- The `columns` strings and `as` casts go; each module maps rows to its camelCase type once.
- Queries turn async; `startAgentSession`, `listAgentSessions`, `currentRound` and friends and their callers in
  `src/main/index.ts` need `await`.
- Check on a copy of the real database (`~/Library/Application Support/coxswain/`) that a workspace with guides,
  rounds and action items still opens and shows the same.
