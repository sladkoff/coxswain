# coxswain — devlog

Where the build stands and what we owe. Newest entry first. Terms are defined in
[the glossary](context/coxswain.md); decisions are in [the ADRs](adr/).

## 2026-09-24 — Local comments and asks

Comments on code, handed to the agent: the first version of the main selling point (G4) from inside
coxswain, before importing any GitHub comments.

### What works

- **Commenting.** In the Viewer, the gutter `+` (from `@pierre/diffs`) starts a comment on one line,
  or on a range by dragging it. Works on both sides of a diff and on whole files. ⌘Enter saves, Esc
  cancels.
- **Local comments are stored** (`comments` table, migration 4) with path, side (`old` = merge base,
  `new` = worktree), line range, the code as it was, and the text. They show inline and survive
  restarts. They can be deleted.
- **Asks.** *Send to agent* puts a comment in the L4 message box as a chip; several can be collected.
  On send, the core puts each comment in front of the message (file, lines, side, the code in a
  fence, the comment) and marks them sent; they then show *Sent to agent* inline.
- **Agent replies render as Markdown** in L4 (`react-markdown` + `remark-gfm`: lists, tables,
  code, links). Links open in the browser; the app window never navigates.
- **Viewed files.** A *Viewed* checkbox in a file diff's header; the Navigator hides viewed files, says
  "N of M viewed", and has a cog button with a native menu: *Show Viewed Files* (then shown with a
  ✓), and *As Tree* / *As List* for the changed files. Stored per workspace (`viewed_files`, migration 5) with a fingerprint of the
  file diff (merge base + worktree file), so a file becomes unviewed when an agent or new PR commits
  change it. Checked in the app on #5284.
- **The Agents pane can be hidden**: a button in its header, *View > Toggle Agents* (⌥⌘B), and a
  button in L3's top bar to show it again. It stays mounted while hidden, so a running turn keeps
  going and still reloads the diff. *Send to agent* shows it.
- **Resizable panes.** Drag the border between L2 and L3, or L3 and L4, to resize. L3 takes the
  rest.
- Checked in the app on a private repo #5291: comment on lines 3–5, send with an instruction,
  the agent read the file and answered about those lines.

### Tech debt

- **Viewed isn't synced with GitHub's** *Viewed* checkbox; it's local only, and also covers local
  changes, which GitHub doesn't see.
- **The ✓ in the Navigator is redrawn by resetting the rows' git status** (`ponytail:` in
  `Navigator.tsx`), since `@pierre/trees` has no call to refresh decorations.
- **The Navigator's cog settings reset** per workspace and on restart (`ponytail:` in
  `Navigator.tsx`), like the pane widths.
- **The list is a tree without folders:** `@pierre/trees` has no list mode, so rows are named after
  the file and the folder goes in the row decoration. Two files with the same name show their whole
  path instead. A long file name squeezes out its folder and can clip the +/− lines.
- **Whether the Agents pane is shown resets on restart**, like the pane widths.
- **Pane widths reset on restart** (`ponytail:` in `App.tsx`); persist them once there's a settings
  table.
- **Comments drift.** They're anchored by line numbers only, so an agent's edits move them off their
  lines; the stored code snippet keeps the ask right, the inline position doesn't. Outdated tracking
  is glossary open question 2 (`ponytail:` in `comments.ts`).
- A range dragged across both sides of a diff is taken as the side it ends on (`ponytail:` in
  `Viewer.tsx`).
- Comments can't be edited, only deleted, and deleting doesn't ask first.
- **No way to see pending comments or send them in bulk.** Comments not yet sent are only visible
  inline in the file they're on, and each one has to be added to the message box by hand; there's no
  list of a workspace's unsent comments and no "send all" ([UX](UX.md) open question 3).
- No threads, no resolving.
- Asks are sent as one plain-text prompt; the chat shows it in full.
- Code blocks in agent replies aren't syntax-highlighted (`ponytail:` in `Agents.tsx`); user
  messages stay plain text.

## 2026-09-24 — Clones and PR worktrees

Each project now has its own clone and each workspace a PR worktree, per
[ADR 0008](adr/0008-clones-and-pr-worktrees.md). Agent sessions work in the worktree and may edit
files there, and *Diffs* shows what they changed. That's the first full loop for G4: ask the agent,
see its diff. G1 is ticked.

### What works

- **Clone on add.** Making a project current starts a blobless clone into
  `~/coxswain/repos/<owner>/<name>/` in the background; the project icon pulses meanwhile. Clones
  are written to `<name>.cloning` and renamed when done.
- **PR worktree on open.** Opening a workspace fetches the PR's head branch and creates
  `~/coxswain/worktrees/<owner>/<name>/<workspace id>/` on a local branch tracking it. Later opens
  fast-forward it when the PR moved and nothing is changed locally; otherwise the Navigator says so.
- **Switching is local.** A worktree opened before shows at once (150–400 ms, measured) from what the
  core remembers; the GitHub check and fetch (~2.5 s) run in the background and only redraw if the PR
  moved. Offline, the worktree still shows, with a notice.
- **Navigator and Viewer read the worktree.** *Diffs* is `git diff <merge base>` against the
  worktree plus untracked files (renames detected); *Files* is `git ls-files`; the Viewer's old side
  is `git show <merge base>:<path>`, its new side the file on disk. Both reload after every agent
  turn.
- **Agents edit files** in their worktree (`--permission-mode acceptEdits`). Checked in the app: a
  33-second first open of a private repo #5284, then an agent-written file showed up in *Diffs*
  next to the PR's 12 files.
- The core resolves every path and ref itself from workspace and project IDs; file paths from the
  UI can't leave the worktree, and commits must be full SHAs.

### Tech debt

Paid off from the proof of concept: per-file GitHub API reads for trees and files, GitHub's
truncated trees and 3000-file limit on *Diffs*, the missing clone and worktree paths, and the empty
agent folder.

- **PR and local changes look the same** in *Diffs* ([UX](UX.md) open question 5).
- **Fork PRs** show an error; they need a fork remote (`ponytail:` in `git.ts`).
- **No cleanup.** Worktrees, their branches and clones stay on disk forever; removing workspaces and
  projects isn't built.
- **No undo** for agent edits beyond git itself; no commit or push from coxswain yet.
- The remembered head and merge base live in memory, so the first open of each workspace after a
  restart still waits ~2.5 s (`ponytail:` in `git.ts`).
- Reloads only happen on workspace open and after agent turns; edits made outside coxswain show on
  the next turn or reopen. A file watcher would fix it.
- The opened file keeps the status it had when opened; if a turn deletes it, the Viewer shows it
  empty rather than deleted.
- A PR whose head branch is the repository's default branch can't get a worktree, because the clone
  itself has that branch checked out.
- HTTPS clones rely on `gh auth setup-git` (or another credential helper); without one they fail
  with git's message. `git` and `gh` are found through `PATH`.
- `parseChanges` was checked against a real repository (renames, binary, deletes, untracked) with a
  throwaway script; still no test setup in the repo.

## 2026-09-24 — First agent sessions: chat with Claude Code

L4 is now a chat with a local Claude Code, per [ADR 0007](adr/0007-running-claude-code.md). It
proves the loop of sending a turn, streaming the reply and resuming later. The agent can't see the
PR's code yet, because there is still no clone.

### What works

- **Chat in L4.** Type a message, press Enter; the agent's text and each tool it uses (one line,
  e.g. `⏺ Bash pwd`) appear as they arrive. *Stop* kills a running turn.
- **Agent sessions per workspace.** The first message creates one (`agent_sessions` table, migration
  3). *New session* starts another with the next message. Switching workspaces shows that
  workspace's latest agent session.
- **Resume after restart.** The transcript is read back from Claude Code's own
  `~/.claude/projects/*/<session ID>.jsonl`, and the next turn resumes with `--resume`.
- **Running turns are killed** when the app quits.

### How it's put together

| Where | What |
|-------|------|
| `src/core/agents.ts` | Agent sessions in SQLite, `runTurn` (spawns `claude -p … --output-format stream-json`), `readTranscript`, `stopTurn`. One parser for stream and transcript lines. |
| `src/main/index.ts` | `agents:*` handlers; chat entries go to the window as `agents:entry` events. |
| `src/renderer/src/Agents.tsx` | The L4 chat pane. |

### Tech debt

- **The worktree is an empty folder** until cloning lands (paid off in the entry above).
- **No tool approval.** Print mode refuses tools that need permission, so the agent can't run most
  commands (file edits were allowed in the entry above). Next step: `--permission-prompt-tool` or the
  Agent SDK (ADR 0007).
- Only the latest agent session per workspace is shown; earlier ones stay in the database
  (`ponytail:` in `Agents.tsx`, UX open question 4).
- Tool results aren't shown, only the call; replies are plain text, not Markdown (`ponytail:` in
  `agents.ts`, `Agents.tsx`).
- No partial streaming (`--include-partial-messages`): text appears a message block at a time.
- A turn keeps running if you switch workspaces, but coming back doesn't show it as running, and its
  entries arriving meanwhile are only visible after reopening.
- `claude` is found through `PATH`, like `gh`.
- The `agents.ts` logic is checked by a throwaway script (two real turns, resume, transcript), not a
  committed test; still no test setup in the repo.

## 2026-09-24 — Proof of concept

The first vertical slice: open a GitHub repository, pick one of its PRs, and read its diffs and
files. It proves the stack from ADRs 0002–0006 works together. Nothing talks to an agent yet, and
nothing is cloned.

### Running it

```sh
pnpm install     # also downloads the Electron binary (see debt)
pnpm dev         # run with hot reload
pnpm start       # build and run the built app
pnpm typecheck
```

GitHub features need the GitHub CLI signed in (`gh auth login`), per
[ADR 0006](adr/0006-github-integration.md).

### What works

- **Onboarding.** With no project, a full-window screen links to Settings and to choosing a first
  project.
- **Settings** (⌘,). Shows the GitHub account `gh` is signed in as, or what to do if `gh` is
  missing or signed out.
- **Projects.** The project icon at the top of L1 opens the list of projects and the user's GitHub
  repositories (paged, searchable). Picking a repository adds it as a project and makes it current.
- **Workspaces.** `+` under the project icon lists the repository's open PRs; picking one adds a
  workspace. Workspace icons sit in L1 in the order they were added, the current one marked.
- **Navigator** (L2). A *Diffs / Files* toggle: the PR's changed files as a tree with status and
  +/− lines, or the whole tree at the PR's head with changed folders marked.
- **Viewer** (L3). Selecting a file in *Diffs* shows its file diff side by side (merge base vs head,
  as GitHub shows it); selecting one in *Files* shows the whole file.
- **Storage.** Projects and workspaces persist in SQLite, with migrations from the start.

L4 (agents) is an empty placeholder (since filled; see the entry above).

### How it's put together

| Where | What |
|-------|------|
| `src/core/` | The UI-free core ([ADR 0002](adr/0002-standalone-electron-app.md)): `github.ts` (Octokit, token from `gh`), `db.ts` (SQLite and migrations), `projects.ts`, `workspaces.ts`. |
| `src/main/index.ts` | Electron main process: window, native menu, and one `ipcMain.handle` per core function. |
| `src/preload/index.ts` | The single typed interface the UI uses to reach the core (`window.coxswain`). |
| `src/renderer/src/` | React UI. `App.tsx` holds the screen state; one file per screen or pane (`Navigator`, `Viewer`, `Projects`, `NewWorkspace`, `Settings`, `Onboarding`); `ui.tsx` has shared pieces. |

Stack: Electron 44, electron-vite 5, React 19, TypeScript 7, Tailwind 4, `@pierre/trees` and
`@pierre/diffs` (pinned exactly), `@octokit/core`, `node:sqlite` (built into Electron's Node 24, so
no native module).

### Tech debt

Deliberate shortcuts for the PoC, grouped by what will force them. Items marked `ponytail:` in the
code are found with `grep -rn "ponytail:" src`.

**No local clone yet** — the biggest gap, and next to go.

- Every file tree and file content is read from the GitHub API, one request per file opened
  (`src/core/github.ts`). Slow, rate-limited (5000 requests/hour), and it can't show local changes.
- GitHub truncates very large trees, and lists at most 3000 changed files per PR.
- Projects have no `repo_path` and workspaces no `worktree_path` (`projects.ts`, `workspaces.ts`).
  Cloning into `~/coxswain/repos/…` and worktrees into `~/coxswain/worktrees/…` (ADRs 0005, 0006)
  replaces the API reads above.
- Local repositories can't be added yet; detecting a GitHub remote (ADR 0006) isn't built.

**GitHub**

- Signing in depends on `gh`; native OAuth is the long-term plan (ADR 0006).
- `gh` is found through `PATH`, which a packaged app launched from Finder won't have.
- Open PRs: only the first 100 are listed.
- Repository search only filters the pages already loaded.
- No polling or ETags (ADR 0006, decision 7): PR data loads once per workspace and never refreshes
  while the app runs.
- Nothing is cached; switching workspaces refetches everything.

**Data and state**

- Projects and workspaces can't be removed, and closed or merged PRs keep their workspace.
- UI state isn't stored (ADR 0005 plans for it): the Diffs/Files toggle, the open file and pane sizes
  reset on restart.
- The core runs inside the main process and SQLite calls are synchronous. Fine at this size; move it
  to a utility process if the main process ever stutters.
- IPC handlers don't validate their arguments; they trust the renderer.

**UI**

- shadcn/ui isn't set up (ADR 0004); the few controls are hand-rolled with Tailwind.
- Keyboard use stops at ⌘, (Settings), Esc (close a screen) and the tree's own arrow keys; there
  are no shortcuts for the rest and no ⌘K, which [UX](UX.md) requires everywhere.
- ADR 0004's system accent colour, reduced motion and high contrast aren't wired up.
- The native menu is laid out for macOS only.
- Panes have fixed widths; no resizing.
- The Viewer shows one file at a time; tabs are an open question in [UX](UX.md).
- No React error boundary; a failed core call can leave a pane blank.
- The renderer bundle isn't split; Shiki's grammars all ship in it.

**Tooling**

- No tests of any kind, and no linter or formatter config.
- No packaging, signing or auto-update.
- electron-vite 5 doesn't know Electron 44 downloads its binary lazily, so `postinstall` runs
  `install-electron`. Remove it once electron-vite catches up.
- electron-vite 5 holds Vite at 7.
- `@pierre/trees` is a beta and `@pierre/diffs` is young (ADR 0003); both are pinned and need
  deliberate upgrades.

**Docs**

- [ADR 0005](adr/0005-local-data-storage.md) still says *session* for what the glossary now calls a
  *workspace*. Accepted ADRs aren't edited; a later ADR touching storage should use the new term.
