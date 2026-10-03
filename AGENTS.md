# AGENTS.md

coxswain is a local mini IDE for reviewing and building code with local coding agents (Claude Code,
Codex). Its main selling point: pick review comments on a PR, hand them to a local agent to
implement, and see the resulting diff. It is an Electron app, currently a proof of concept.

## Docs

Read these before changing anything; they are the source of truth.

| Doc                                                  | What it holds                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/GOALS.md](docs/GOALS.md)                       | The goals (G1–G5) and non-goals. Work should serve a goal.               |
| [docs/context/coxswain.md](docs/context/coxswain.md) | The ubiquitous language: every term used in code, docs and conversation. |
| [docs/UX.md](docs/UX.md)                             | The screen layout (L1–L4) and open UX questions.                         |
| [docs/adr/](docs/adr/)                               | Architecture decisions, one numbered file each.                          |
| [docs/DEVLOG.md](docs/DEVLOG.md)                     | What has been built so far and the tech debt we carry.                   |
| [docs/tickets/](docs/tickets/)                       | Work still to do, one numbered file per ticket.                          |

## Development process

Keeping the docs current is part of every change, not a follow-up.

1. **Language first.** Use the glossary's terms in code, UI text and docs. When a term is new or its
   meaning changes, update [the glossary](docs/context/coxswain.md) first, then the code.
2. **Decisions go in ADRs.** A choice of library, architecture, storage, protocol or anything else
   that is costly to reverse gets an ADR in `docs/adr/`, numbered in sequence
   (`NNNN-short-title.md`, sections Status, Context, Decision, Alternatives considered,
   Consequences). ADRs say what holds now, not how we got there: when a decision changes, edit its
   ADR; when it no longer holds, delete it. Numbers are never reused, so gaps are expected.
3. **UX changes update [UX.md](docs/UX.md)**, including its diagram and open questions. Remove a
   question once it is answered.
4. **Append to the devlog.** At the end of a piece of work, add or extend the newest entry in
   [DEVLOG.md](docs/DEVLOG.md): what now works, and any tech debt taken on or paid off. Mark
   deliberate shortcuts in code with a `ponytail:` comment that names the limit and the upgrade path,
   and list them in the devlog.
5. **Tick goals** in [GOALS.md](docs/GOALS.md) when they are met.
6. **What coxswain tells its agents** (`paneContext`, the view tools' texts, the skills' notes in `src/core/skills.ts`)
   is written with the `writing-for-agents` skill in `.claude/skills/`.

## Architecture rules

- **The UI does no work of its own** ([ADR 0002](docs/adr/0002-standalone-electron-app.md)). All
  git, GitHub, file and agent work lives in `src/core/`, which knows nothing about Electron or the
  UI. The UI reaches it only through `src/preload/index.ts` (`window.coxswain`), wired to the core in
  `src/main/index.ts`.
- **Store only what nobody else has** ([ADR 0005](docs/adr/0005-local-data-storage.md)): SQLite in
  the core, with append-only migrations in `src/core/db.ts`. No `localStorage` or IndexedDB.
- **GitHub token comes from `gh`** and is never stored
  ([ADR 0006](docs/adr/0006-github-integration.md)).
- **What the canvas shows is the router's location** ([ADR 0025](docs/adr/0025-canvas-history-with-tanstack-router.md)):
  a field of `CanvasSearch` in `src/renderer/src/router.ts`, changed with `navigate()`, so Back and Forward cover it.
- **Branching on more than two outcomes is a ts-pattern `match`**: not chained ternaries, `if … return` ladders or
  nested JSX conditionals ([ADR 0035](docs/adr/0035-ts-pattern-for-branching.md)). Over a union, end with
  `.exhaustive()`; type outside values (GitHub's enums) as their union, not `string`, and end with
  `.exhaustive(() => fallback)`. Narrow with `P.…select()` instead of `!`.
- **Work nobody waits for is a background job, started by a core event**
  ([ADR 0038](docs/adr/0038-background-jobs-and-core-events.md)): a `JobSpec` run by `src/core/jobs.ts`, so it is
  retried and shows in Activity, started from `src/core/background.ts` when the core emits a change
  (`src/core/events.ts`). No timers in the UI for the core's work, and no second runner.
- **Every core write emits what it changed; the UI never invalidates queries itself**
  ([ADR 0017](docs/adr/0017-data-fetching-with-tanstack-query.md)): the write calls `emit` from `src/core/events.ts`, and
  `affects` in `src/renderer/src/queries.ts` is the one place that says which reads go stale. Data that changes outside
  coxswain (git, GitHub) is watched by the core (`src/core/watch.ts`, [ADR 0030](docs/adr/0030-workspace-watcher.md)),
  never polled by the UI.
- **Diffs, files and trees use the Pierre libraries**
  ([ADR 0003](docs/adr/0003-diff-view-and-file-tree.md)), pinned to exact versions.
- **Desktop conventions** from [ADR 0004](docs/adr/0004-styling-and-native-feel.md): native menus
  and dialogs, system font and theme, default cursor, no text selection outside content, dense
  layout. Screens build from the shared controls in `src/renderer/src/components/` (Button,
  ToggleButton, SegmentedControl, Input, TextArea, Card, Screen, …) and the tokens in its
  `styles.ts`; don't hand-roll a control that one of them covers.

## Layout

```
src/core/       UI-free core: GitHub, SQLite, projects, workspaces
src/main/       Electron main process: window, menu, IPC handlers
src/preload/    The typed interface between UI and core
src/renderer/   React UI: one file per screen or pane; shared controls and styles in components/
docs/           Goals, glossary, UX, ADRs, devlog, tickets
```

## Commands

```sh
pnpm install     # also downloads the Electron binary
pnpm dev         # run with hot reload
pnpm start       # build and run
pnpm typecheck   # type check
pnpm test        # node --test over src/**/*.test.ts
pnpm lint        # oxlint
pnpm format      # oxfmt, formats in place
```

GitHub features need the GitHub CLI signed in: `gh auth login`.

A dev run uses the installed app's database (`~/Library/Application Support/coxswain`), and a new migration
locks the installed release out of it. Check migrations against a scratch one: `COXSWAIN_USER_DATA=/tmp/cx pnpm dev`.

Before calling a change done, run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format` and `pnpm build`, and check the change in the
running app.
