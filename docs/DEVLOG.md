# coxswain — devlog

Where the build stands and what we owe. Newest entry first. Terms are defined in
[the glossary](context/coxswain.md); decisions are in [the ADRs](adr/).

## 2026-09-28 — Views of existing code without a diff

Issue #31, for G3 and G5 (ADRs 0014, 0023, 0026).

- Views can start on a clean branch and explain existing code with prose and diagrams. The agent's instructions
  describe source-file embeds: `file path=…` fences show the whole file at the view's snapshot, including unchanged
  files. Diff embeds still require a change; guides use diffs for their changed files.
- Embedded source files use Pierre's file viewer, with inline comments, explanations and findings. Paths are checked
  against the pinned git tree; directories and submodules cannot be embedded as files. Every path is embedded once.
- Whole files have separate Reviewed fingerprints, based on their contents, independent of the diff or merge base.
  Existing diff marks are preserved. File headers, section counts, the table of contents and the bottom bar agree;
  the bottom bar counts the view's embeds. Show Reviewed Files and section navigation work for source files too.
- Reviewed for commit and scope diffs now follows the displayed range, as view review state already did.
- Regression tests cover empty diffs, mixed embeds, invalid paths and diagrams, annotations, guide coverage,
  snapshot reads and independent review state across edits and base changes. Checked in the built app with a
  disposable clean repository: source file, diagram, explanation, Reviewed hiding, progress and section navigation;
  then mixed source/diff embeds, independent checkboxes and the all-reviewed message.
- Source embeds show whole files; selecting a line range for an embed remains deferred. No schema migration needed.

## 2026-09-28 — Branch workspaces, local changes and turn diffs

The local development loop (#3, ADR 0028), for G5.

### What works

- **A workspace without a PR.** The new workspace screen starts one on a branch: a new one made from a base branch (the
  default unless another is picked), or one already on GitHub. Its diff is against where it forked. The sidebar shows
  the branch's last name part. _Open Pull Request…_ (Commits pane, ⌘K) pushes it and opens a draft PR into the base
  branch in the browser; the workspace is the PR's from then on, in the same worktree. A PR opened elsewhere for the
  branch is picked up when the workspace opens, and opening that PR from the new workspace screen reuses it.
- **Local changes told apart** (UX open question 5, now gone): _All_ · _PR_ · _Local_ next to _Diff_; the Navigator
  marks files with local changes (●); the Commits pane marks commits not pushed and has _Push_ (never forced).
- **Snapshots.** The worktree as a commit, uncommitted and untracked files included, without touching its index
  (`src/core/snapshot.ts`). New views are pinned to one, so they include local changes, and go stale when the worktree
  changes rather than only when the PR moves.
- **Turn diffs.** Every agent turn is snapshotted before and after; a turn that changed something is listed under
  _Agent turns_ in the Commits pane and shows like a commit diff.
- The `workspaces` table is rebuilt (nullable `pr_number`, `branch`, `base_branch`) with foreign keys off while
  migrating, checked after; `turns` is new. `src/core/workspaces.test.ts` covers the rebuild keeping children, branch
  names and snapshots.
- Checked in the app: a branch workspace with a local commit, an untracked file and an agent turn; the scopes; the
  turn's diff; a view with the untracked file going stale on an edit; a PR workspace's scopes. _Push_ and _Open Pull
  Request…_ weren't run against GitHub.

### Tech debt

- `ponytail:` snapshot refs (`refs/coxswain/snapshots/`) are never pruned.
- `ponytail:` a branch's slashes become `+` in its worktree's folder name, so `a/b` and `a+b` collide.
- `ponytail:` the branches offered for a new workspace are as of the clone and the fetches since.
- `ponytail:` two turns running at once in one workspace each get both's changes.
- The base branch is picked from a native menu of every branch on GitHub; long for big repositories.
- coxswain doesn't commit; the agent or the user does (UX open question 5).

## 2026-09-27 — README for the first release

### What works

- **The README lists the features since it was written** (#24): views with diagrams and embedded file diffs, _Copy as
  prompt_, Back and Forward, and the command palette.

## 2026-09-27 — Install script

### What works

- **`curl … install.sh | sh`** installs the latest release on macOS (`.zip` into `/Applications`) or Linux (AppImage
  into `~/.local/bin`), or a given version. Release files are now named `coxswain-<version>-<os>-<arch>`, so the
  script can build the URL.

### Tech debt

- The repo is private, so the curl line only works once it's public.
- No Windows script and no Linux arm64 release build.

## 2026-09-27 — Send all, at once; Copy as prompt

### What works

- **Send all to agent shows at once** in the agent pane. The refetch of the transcript that tells the pane about a new
  session used to reload the session mid-turn and replace the message just streamed in; `readTranscript` now returns
  null while a turn runs in the session, and the pane keeps what streamed. Questions sent from threads had the same
  race.
- **Copy as prompt** next to it in the bottom bar puts the same message (without its _[Review · N threads]_ header) on
  the clipboard, to paste into another agent.

### Tech debt

- The pane still doesn't show _working_ for a turn it didn't start, and a session made by _Send all_ misses the
  message itself until the turn ends (it streams before the pane knows the session).

## 2026-09-27 — Agent session titles

### What works

- **Agent sessions have titles** (#14): the session picker names each session by its title instead of _Session N_.
  Claude Code's adapter generates one after the first turn and sends it as a `session_info_update`; the core stores
  it in `agent_sessions.title` (a new migration) and tells the UI. Until then, and for Codex, which names a session
  only when the user does, the title is the first message's first line, without a comment's or review's header.
- View titles were already the agent's (`start_view`'s `title`); unchanged.

### Tech debt

- Sessions started before this keep _Session N_ until their next message.
- A title can't be renamed in coxswain.

## 2026-09-27 — Command palette and action registry

### What works

- **Command palette** (#10, ADR 0027): ⌘K (_View > Command Palette…_) opens a search box with `>` typed; the text
  after it finds an action by fuzzy match and Enter runs it. Without `>` it's Open Quickly (⌘⇧O), now ranked: a match
  in the file name first, then word starts, then letters in order.
- **Action registry**: every action (Back, Forward, show or hide Files and Commits, show the diff or a view, each New
  View, Unified or Split diffs, show or hide reviewed files, open a workspace, New Workspace, switch project, Add
  Project, Settings, Open Quickly) is one entry in `App.tsx` with a title, shortcut and whether it can run now. Native
  menu items send one `action` IPC event with the id, replacing four one-off events; the canvas bar's Back, Forward
  and magnifier run actions by id.
- `pnpm test` runs `node --test` over `src/**/*.test.ts`; the first is the fuzzy matcher's.

### Tech debt

- Native menu items aren't greyed out from the registry (only Back and Forward are); a disabled action's menu item
  does nothing.
- The palette doesn't list PRs not yet opened as workspaces, or agent sessions ([UX](UX.md) wants both).
- Files are still capped at the first 50 matches.

## 2026-09-27 — Managing views

### What works

- **Older views can be changed** (#20): `write_section`, `add_explanation` and `add_finding` take `view`, the id
  `start_view` returns, and write to the latest view without it. `list_views` lists the views with their ids and
  section headings, and `remove_section` removes a section.
- **Views can be removed:** right-click a view's chip → _Remove View…_, confirmed, deletes it with its explanations
  and findings. Removing the newest no longer shows the one before it as if it were new.
- Checked with a throwaway script against an in-memory database: `list_views`, `remove_section` on an older view and
  on the latest, unknown ids and section numbers, and the cascade to entries.

### Tech debt

- Paid off: the tools wrote only to the latest view and views couldn't be removed.
- Two sessions keep their views apart only if the agent passes `view`; nothing ties a view to its session.

## 2026-09-27 — Views: markdown, diagrams and embedded file diffs

### What works

- **Views** (#1, ADR 0026): the agent makes views of the PR with coxswain's tools, not only guides. A view is a title
  and sections of markdown: prose, tables, ` ```mermaid ` diagrams, and ` ```diff path=… ` fences that embed a file
  diff as in the diff, with threads, explanations, findings and _Reviewed_. The core parses sections; the UI renders
  them.
- **Guides are views** that go through every changed file; files no section embeds show under _Not in the guide_.
  Existing guides were migrated into sections (their explanations, findings and replies kept). Other views show
  only what they embed.
- **Tools:** `start_view` (title, guide) and `write_section` (append, or replace section N) replace `start_guide` and
  `add_group`. `start_view`'s result teaches the syntax and how to write a guide or another view.
- **The canvas bar** names each view's chip by its title (_Guide_, _Data flow_, _Guide 2_ for a repeat). _New View_'s
  menu adds _data model_, _data flow_ and a message of your own. The table of contents lists sections, with counts only
  for sections that embed file diffs.
- **Mermaid diagrams anywhere markdown shows**, chat and threads included: loaded on the first diagram, in the system
  theme and redrawn when it changes; a diagram that doesn't draw shows its code and the error.
- **The agent's diagrams are checked:** `write_section` has the window draw each one first and refuses the section with
  mermaid's error if one doesn't draw, so the agent fixes it. Checked by calling the tool over the MCP server: a
  broken flowchart came back with the parse error, a good ER diagram was added.
- Explanations are labelled _Explanation_, not _Guide_, since any view can have them.
- Checked in the built app driven with Playwright's `_electron`, on a copy of a real database: a migrated guide
  (sections, table of contents, a low-lighted generated section, an explanation between the lines) and a data flow
  view (a flowchart, a table, an embedded file diff, a broken diagram's error).

### Tech debt

- The agent learns whether its diagrams draw, not how they look; with no window open they aren't checked.
- An embed is a whole file diff; embedding only some of its lines isn't built.
- Reviewed file diffs are hidden in every view as in a guide, which can hide the one file diff a data model view is
  about; _Show Reviewed Files_ brings it back.
- Mermaid is about 1.2 MB of the renderer bundle, in its own chunk.
- The bottom bar and the Navigator count the whole range while a view that embeds only some of it shows (UX open
  question 2).

## 2026-09-27 — Diff and numbered guides in the canvas bar

### What works

- **_Diff_ chip** left of the guide chip in the canvas bar: shows the diff without a guide, and is on while none
  shows. It replaces the Guide menu's _No Guide_.
- **A chip per guide**, numbered in the order made (_Guide 1_, _Guide 2_, …), to switch between them; the guide's
  date, head and staleness are in its tooltip. The Guide menu is gone.
- **_New View_ chip** (dashed, a layers-plus icon) after it: its menu has _New View (guide)_ and _New View
  (review)_, which fill the agent pane's composer as before. Meant to offer other kinds of view later.

## 2026-09-27 — Back and forward on the canvas

### What works

- **_View > Back_ (⌥⌘←) and _Forward_ (⌥⌘→), and chevrons in the canvas bar** step through the canvas's history
  (#8, ADR 0025): whole files opened any way, files picked in _Diffs_, the _Diffs_/_Files_ toggle, commits and guides
  picked, and workspaces opened. Back into another workspace's step opens it again. Greyed out at either end.
- **The canvas's state is the location** (`CanvasSearch` in `router.ts`): TanStack Router with memory history, one
  route. A change to what the canvas shows is a `navigate()`, so it's a step without anything else to wire.
- **Each step keeps its scroll.** A whole file by offset; the file diffs by the one at the top and how far into it,
  since those above it may have been read (and grown) since. The file diffs stay mounted, hidden, under a whole file.
  The restore is applied again until it holds: after a jump, Pierre's Virtualizer applies the fix-up it worked out
  for the old place. Its own `scrollTo` does the same (tried).
- **The keys work with the Navigator focused:** the main process takes them in `before-input-event`, before the file
  tree (which uses ⌥⌘←/→ itself) can.
- Checked in the built app driven with Playwright's `_electron`: diffs picks, the _Files_ toggle and whole files,
  back and forward across them with a tree row focused, the chevrons, the menu items greying out, and after a resize.

### Tech debt

- The scroll restore gives up after 2 s, e.g. a huge file still loading, and leaves it as far as it got. It finds
  file diffs by their DOM id and works against the Virtualizer's own fix-ups; a Pierre update can break it quietly.
- Showing a thread is a step only when it changes what the canvas shows (it drops a whole file or commit); the scroll
  to it, and a jump from a guide's table of contents to a group, aren't steps.
- Settings, Projects and New Workspace are still `screen` state, outside the history.
- Back across workspaces hasn't been tried with two workspaces open; only one was in the test data.

## 2026-09-27 — CI and releases

### What works

- **CI** (`.github/workflows/ci.yml`): typecheck, lint, format check and build on every push to `main` and every PR.
- **Releases from a button** (ADR 0024): Actions → _Release_ → _Run workflow_ with `0.2.0` bumps `package.json` on
  `main`, tags `v0.2.0`, builds macOS (arm64, x64), Windows x64 and Linux x64 with electron-builder and creates the
  GitHub release with generated notes; `0.2.0-rc.1` makes a pre-release. `pnpm dist` builds
  for the machine you're on into `dist/`.
- **Settings shows the version and commit** (_About_: `coxswain 0.1.0 · 05c8448`), set at build time.
- **A packaged app finds `gh`, `claude` and `codex`** when started from the Dock: it takes the login shell's `PATH`.
  Checked with the macOS arm64 package opened with `open`: the startup check passed and Codex's adapter started
  from inside the asar.
- The packaged app has its icon in the bundle and says _coxswain_ in the menu bar.

### Tech debt

- **Unsigned builds**: macOS needs right-click → Open (or `xattr -cr`) on first launch; Windows shows SmartScreen.
- **Windows can't find the agents yet**: `onPath` in `agents.ts` looks for `claude` and `codex` without `.exe`, and
  the native menu has no Settings entry outside macOS. Only the macOS build has been run.
- No auto-update.

## 2026-09-27 — README, license and contributing

### What works

- **The repository has a front page:** `README.md` with a screenshot (`docs/screenshot.png`, an agent review of
  honojs/hono#5201), the features, requirements and getting started; `LICENSE` (MIT) and `CONTRIBUTING.md` (issues
  first, AI-assisted PRs welcome).

## 2026-09-27 — Codex, and model and effort in the composer

### What works

- **Codex runs in the agent pane** (`@agentclientprotocol/codex-acp` 1.13.1, the user's own `codex` on `PATH`), in
  its _Approve for me_ mode, with coxswain's tools and the pane's instructions (ADR 0018, 10).
- **_New session_ is a split button** (`ButtonGroup`, shaped like shadcn's): the button starts a session on the agent picked last, its
  chevron's native menu on another, Claude Code or Codex. The one picked last is also what questions, reviews and
  guides start a session on when the workspace has none. The session keeps its agent; the
  picker names it.
- **Agent picks under the composer** (`listAgentPicks`, `setAgentPick`): the model and the effort, each a native menu
  of what the agent offers (ACP session config options), stored per agent in `settings`. Every turn of the agent's
  sessions, the pane's own, questions, reviews and guides, runs on them.
- Claude Code's _Default (recommended)_ model shows as the model it resolves to, e.g. _Opus 5.5 (default)_, named
  from the model ID the adapter sends (`modelName`, a `ponytail:` guess from the ID's shape).

### Tech debt

- The choices are the agent's latest session's. Before the agent has one, listing them opens a session in the
  worktree and closes it again (a few seconds for Claude Code). Choices are kept while the app runs; a model the agent
  adds shows after a restart.
- **Effort levels follow the model late** (`ponytail:` in `listAgentPicks`): a model picked before its first turn
  shows the old model's levels until the turn, and a stored level the model hasn't is skipped.
- Codex isn't in the startup check: a missing `codex` shows as the first turn's error.

## 2026-09-27 — Go to Definition and Find Usages

### What works

- **⌘-click a name to see where it's defined** (`findDefinitions` in `git.ts`, token callbacks in `Viewer.tsx`): in a
  file diff or a whole file, ⌘ over a token underlines it; ⌘-click shows the defining file on the canvas at that
  line, with the Navigator on _Files_. Several matches open a native menu to pick from. A relative import
  path (`"./queries"`) opens its file, trying the usual extensions and `index` files.
- **Right-click a name for _Go to Definition_ or _Find Usages_** (a native menu, `menus:token`). _Find Usages_
  (`findUsages` in `git.ts`) lists every worktree line with the name as a whole word in the same native picker as
  several definitions: the first 30, then _N more_.
- **One way to show a whole file** (`openFile` in `App.tsx`): selecting in _Files_, Open Quickly, Go to Definition and
  Find Usages all show it on the canvas with the Navigator on _Files_ and the file revealed. Fixed on the way: the
  tree's second mount effect under StrictMode reset its paths and folded the reveal away when switching to _Files_,
  and a jump within _Files_ to another file scrolled the file drawn before.
- **Find Usages always shows its menu**, even for one line (often the one clicked), and both menus say _No usages
  found_ / _No definition found_ instead of doing nothing.

### Tech debt

- Definitions are found by name with `git grep -w` and one regex for many languages, so a common name lists every
  definition of it, and methods written over several lines, C functions and destructured names aren't found. A
  language server in the core (ADR 0003) is the upgrade.
- Only the worktree is searched; a name clicked on the old side of a file diff finds its definition as it is now.
- No way back to where you clicked.
- Usages are found by name too: the same word in comments, strings and unrelated code counts. The picker is a native
  menu capped at 30; a results pane (like a search sidebar) if long lists need browsing.

## 2026-09-27 — Open Quickly

### What works

- **⌘⇧O opens any file of the workspace** (_File > Open Quickly…_ or the magnifier in the canvas bar, `OpenQuickly.tsx`): a search box over the window
  filters the worktree's files by path; Enter shows the file in the canvas and the Navigator on _Files_.
- **_Files_ follows the canvas:** the file shown there is selected in the tree, its folders opened and the row
  scrolled into view, also after the tree reloads.

### Tech debt

- Matches are unranked, the first 50 in tree order. Rank by match quality if long repositories make it noisy.

## 2026-09-27 — Agent replies stream token by token

### What works

- **The agent's text streams as it's written**, in the agent pane and in a thread, and a tool's line shows as soon as
  the tool starts. The core sends a chat entry again on every update under the same `id`; the UI replaces the entry it
  grew from (`upsert` in `ChatEntry.tsx`). A question's answer entry is still saved whole when the turn ends.
- **A message sent in the agent pane shows at once**, with the composer cleared, before the core has started the
  session's adapter (seconds for a new session). The core no longer echoes the pane's own message back to it.
- **The agent knows it's in coxswain.** Agent pane sessions append a short context to Claude Code's system prompt
  (`paneContext` in `agents.ts`, ADR 0023): a PR review app, what the comment headers mean, what the coxswain tools
  are for.

### Tech debt

- Each streamed chunk is one IPC message and a re-render of the entry's Markdown. Fine at chat speed; batch per
  animation frame if long replies stutter.

## 2026-09-27 — Shared components

### What works

- **Controls come from one place.** `src/renderer/src/components/`: `Button` (default, primary, ghost, link),
  `ToggleButton`, `SegmentedControl`, `Input`, `TextArea` (Enter submits, Esc cancels), `Screen`, `Card`,
  `ProblemCard`, `ListRow`, `Centered`, `ProgressBar`, `Splitter`, `Prose`, `ErrorText`, `ProblemMessage` and the
  icons, with the shared tokens (`muted`, `divider`, `selectable`, `titleBar`, `cn`) in `styles.ts`. `ui.tsx` is gone;
  its counting helpers are in `format.ts`.
- **Bespoke parts have their own components:** `WorkspaceRail`, `CanvasBar`, `StatusBar`, `GuideGroupHeader` and
  `GuideFileNote` out of `App.tsx`; `ThreadBox`, `DraftBox` and the composer in `Thread.tsx` out of `Viewer.tsx`; chat
  entries, `PermissionPrompt` and `TurnStatus` (shared by the agent pane and threads) in `ChatEntry.tsx` out of
  `Agents.tsx`.
- Small visual changes from unifying: the thread composer's Comment/Agent toggle is now the same segmented control as
  Diffs/Files; the guide's contents progress bar is green like the status bar's; ghost buttons all wash on hover.
  A thread's reply count now says "replies", not "replys".
- **Lint and format:** `pnpm lint` (oxlint, default rules, clean) and `pnpm format` (oxfmt, default settings). The
  whole repo, docs included, was formatted once.
- **The project icon is a menu.** Clicking L1's project icon pops a native menu of the projects, the current one
  checked; picking one switches to it, and _Add Project…_ opens the Projects screen.
- **Threads no longer widen the file diff.** A resolved thread's one-line header set the code column's width, so a
  narrow canvas (e.g. with the guide's contents shown) cut threads off on the right. Thread boxes now use
  `contain: inline-size`.
- **The UI says _Agent_, not _Claude_ or _Claude Code_**: the agent pane's empty state and composer, the review and
  comment cards, and the permission prompt.
- **No carets** on the status bar's thread toggle. The agent pane's session picker is a button (_Session N_) with a
  native menu of the sessions and their dates, in place of a `<select>`.
- **Remove a workspace**: right-click its icon in L1, _Remove Workspace…_, confirm. Its entries, reviewed files and
  agent sessions are deleted (the schema's cascade); the worktree stays, and adding the PR again adopts it.
- **One confirmation dialog** for destructive actions, native (`window.coxswain.confirm`, `dialogs:confirm`). Removing
  a workspace and deleting a thread both use it.
- **Startup check** (`core/setup.ts`): `git`, `gh` signed in and `claude` on PATH, all local so it passes offline.
  Anything missing shows the Setup screen full window, with the fix for each and the PATH looked on.

### Tech debt

- `cn` joins classes without resolving conflicts (`ponytail:` in `styles.ts`); add tailwind-merge with shadcn.
- The startup check doesn't check that `claude` is signed in (`ponytail:` in `setup.ts`); its first turn says so.

## 2026-09-27 — Cleanup: no timeline, docs as they stand

### What works

- **The timeline is gone.** The Overview wasn't reachable since the tabs went, but opening a worktree still recorded
  each PR head as a phase and spent a Claude call summarising it. Removed: `core/timeline.ts`, `Overview.tsx`,
  GitHub's PR activity (`getPullRequestActivity`), `isAncestor` and `readFileDiff` in `git.ts`, the `timeline:` and
  summary model IPC, Settings' _Change summaries_, and the `timeline` change kind. Opening a worktree now only opens it.
- **Migrations are squashed** into one that makes today's schema. A database made before is refused with a message
  saying to move it away; migration numbers in the entries below refer to the old chain.
- **Worktrees are named by PR number** (`worktrees/<owner>/<name>/pr-<number>/`), not the workspace's row ID, which
  a fresh database hands out again: a reset opened PR #1 as workspace 1 while the clone's worktree for its branch
  sat at `…/2`, and git refused (_already used by worktree_). Opening a worktree now moves one that already holds the
  branch into place, local changes and all, after pruning registrations whose folder is gone.
- **One-shot runs are gone** from `core/agents.ts`: the answer tool, and the `answer`, `tools`, `instructions`,
  `thinking`, `persist`, `model` and `mode` options. Every run is an agent pane turn, in auto mode on Claude Code's
  default model. The MCP server stays for the guide tools. `runAgentTurn` is now `runTurn`.
- Exports used only in their own file are no longer exported. Stale comments naming the Diff tab or deleted ADRs
  are fixed.
- **The docs say what holds now.** ADRs no longer keep history ([ADR 0001](adr/0001-record-architecture-decisions.md),
  AGENTS.md): 0007, 0009, 0010, 0011, 0012, 0019, 0020 and 0022 are deleted, their numbers left as gaps. 0005,
  0008, 0013, 0015, 0018, 0021 and 0023 are rewritten without what they superseded; 0014 is now _Reviewed belongs
  to a file diff's contents_. The done tickets are deleted, and tickets are deleted when done from now on. UX.md
  describes the agent-first layout (L1 project column, L2 Navigator, L3 canvas, L4 agent pane); the glossary lost
  _Viewer_, _Overview_, _Diff tab_, _Timeline_, _Phase_, _Change summary_, _Event_ and _Context_.

### Tech debt

- Older devlog entries below still describe what they built then, including what's now gone.

## 2026-09-27 — Guides made by the agent pane

### What works

- **Guides are agentic** ([ADR 0023](adr/0023-guides-made-by-the-agent-pane.md)). The agent pane's sessions get
  coxswain's MCP tools (`start_guide`, `add_group`, `add_explanation`, `add_finding`) from the local server that served
  the answer tool, at a path per workspace, allowed without asking. "Make me a guide" in the agent pane works; so do
  _Make a Guide_ and _Make a Guide with Review_ in the canvas bar's new _Guide_ menu, which put the message in
  the agent pane's composer for the user to edit and send (not sent right away, as ADR 0023 says). How to guide is in `start_guide`'s result.
- **Guides show in _Changes_:** groups in reading order with title, description and file notes, _Not in the guide_,
  generated groups last. Explanations and findings are entries (new kinds) with a `guide_id`, shown as threads only
  with their guide; a reply is a note. _Send all to agent_ leaves out the ones nobody replied to.
- **Pinned and kept:** a guide shows its range (merge base → PR head then), like a commit; stale once the PR moves
  on. Every guide stays in the _Guide_ menu. The newest shows when it appears, and on opening if not stale.
- **The old pipeline is gone:** file summaries, grouping and describing calls, the guide prompt and model, `Guide.tsx`
  and the progress plumbing. Migration 20 drops `guides` and `file_summaries` (and their data), makes a new `guides`
  table and rebuilds `entries`. The summary model moved to Settings > _Change summaries_; `ask` lives in `timeline.ts`.
- **The guide's table of contents is back** (`GuideToc.tsx`, from the old Guide tab): left of the canvas while a
  guide shows, with viewed counts per group and in all, `✎` counts, the group being read marked, and click to jump.
  `countItems` no longer makes an empty count for explanations and findings (`✎ 0`).
- **No tabs row over the canvas:** it only ever held _Changes_. The canvas's bar is now the top strip (and drags the
  window); a tabs row comes back with a second thing to show.
- **Commits is a pane, not a menu:** _Commits_ in the canvas's bar opens a list on the left, in the Navigator's
  place (one or the other), and a click picks the commit. `listCommits` replaces the `menus:commits` popup.
- **Comment/Agent toggle** replaces the comment box's _Send to agent_ checkbox, left of the send button. It's one
  global preference in `settings` (`comment.to-agent`); a reply is always a note, so reply boxes have no toggle (_Send all to agent_ sends threads afterwards).
- **Thread ⋯ menu** replaces the thread's ✕: _Edit_ (the first comment, the user's own; `editEntry`), _Delete_,
  _Send to Agent_ (`sendThread`: the latest note becomes a question and is asked like one, answer in the thread).
  `askQuestion` and `sendThread` share `ask` in the core and `asking` in the main process.
- **Resolved threads:** a ✓ left of the ⋯ menu resolves and reopens. Migration 21 adds `entries.resolved_at`, set on
  the thread's first entry (`resolveThread`). A resolved thread folds to one line, is counted and labelled in the
  bottom bar's list, and is left out of _Send all to agent_.
- **_Viewed_ is now _Reviewed_** (glossary): labels, `src/core/reviewed.ts`, `listReviewed`/`setReviewed`,
  `showReviewed`, the `reviewed:` IPC channels. Migration 22 renames `viewed_files` to `reviewed_files`. Accepted
  ADRs and older devlog entries keep the old word.
- Tried on PR #1 of the test project: the agent called every tool, and the guide, two explanations and five findings
  showed on the canvas while it worked.

### Tech debt

- The tools add to the workspace's latest guide, so two sessions making guides at once mix.
- A guide request goes to the latest agent session, like comments, not the one the picker shows.
- The Navigator keeps tree order under a guide; only the canvas and its table of contents are in reading order.
- `ponytail:` the table of contents has a fixed width; make it resizable like the Navigator if titles get cut.

## 2026-09-26 — Agent-first layout, first rough pass

### What works

- **No more tabs.** The _Overview_, _Guide_ and _Diff_ tabs are gone. Opening a PR shows the **agent pane**
  (the old L4 chat) on the left, always visible and resizable, and the **canvas** on the right (glossary). For
  now the canvas has one tab, _Changes_ (the file diffs), in a tabs row above a bar with _Files_, _Commits_ and the cog.
- **The canvas's bottom bar** sums up the review: threads (outdated, waiting on the agent), +/− lines, and files
  viewed with a progress bar. Its thread count opens a list of every thread; clicking one scrolls to it.
  _Send all to agent_ sends every thread in one message to the agent pane's session (`sendReview`), known in the
  transcript by a `[Review · N threads]` header like a comment's, and shown as a card. _Show Viewed Files_ now hides viewed file diffs on the canvas too, not only in the
  Navigator; when all are viewed it says so, with _Show them_.
- _View > Toggle Agents_ (⌥⌘B) is gone, since the agent pane is always shown.
- The agent pane's header no longer says _Claude Code_. A session picker there (_Session N · date_) shows any of the
  workspace's agent sessions, not only the latest; _New session_ next to it.
- **Comments are threads.** The comment box on lines is a send button (Enter), a _Send to agent_ checkbox and ✕ to
  cancel. Every comment starts a thread with a reply box of the same shape, so a note can be answered too. Ticked, a
  comment is a question and the agent's answer lands in the thread; unticked, a note. No schema change: `parent_id`
  already threads entries, it just wasn't used for notes. A question asked in a thread is given the thread's notes
  since its last question (and the anchor, if the thread began as a note), since the agent session never saw them.
  Note boxes and question threads are now one `ThreadBox`. The old _Send to agent_ on a note (a chip in the agent
  pane's message box, once only) is gone with its plumbing (`noteIds`, `formatAsk`'s notes); reply with the box
  ticked instead. `entries.sent_at` is no longer written or read.
- **Comments go to the agent pane** ([ADR 0021](adr/0021-comments-go-to-the-agent-pane.md)): a question is a turn
  in the workspace's current agent session, not a hidden per-round one. The agent chat shows it as a card (_Comment
  on `a.ts:3` sent to Claude_, the comment, _View thread_, which scrolls the canvas to the thread); the reply streams
  to both and is kept as the thread's answer. The card comes from a header line in the prompt, read back from the
  transcript (`withComment` in `core/agents.ts`).
- **No more review rounds** (ADR 0022): entries belong to their workspace. Rounds,
  wrap up, action items, hand-off and _Copy as prompt_ are gone from the core, IPC and UI (`Round.tsx` deleted; round
  events left the timeline and action items the change summaries). Migration 19 rebuilds `entries` with
  `workspace_id` and `agent_sessions` without `review_round_id`, and drops `action_items` and `review_rounds`; ran
  on the real database with its 17 entries kept. `ask`'s `instructions` parameter went with wrap up.

### Tech debt

- `ponytail:` the comment card is parsed from the prompt's header line; store sent comments by turn if it gets in the way.
- `ponytail:` _View thread_ stops at the file for an outdated thread, which isn't between the lines.
- The agent pane shows no _Working…_ during a comment's turn, and a comment fails if the pane's own turn is running.
- `ponytail:` every entry a workspace ever had is listed; nothing archives old ones.

## 2026-09-26 — The Overview's timeline

### What works

- **The Overview is a timeline** (ADR 0020): the PR's title, author and GitHub link,
  then its phases, newest first, each with its events, newest first too. Terms (_timeline_, _phase_, _change summary_, _event_,
  _context_) are in the glossary; the layout is in UX.md.
- **Phases** (`phases` table, migration 18): every PR head `openWorktree` reads is passed to `recordHead`, which adds
  a phase when the head is new. `base` is the previous head if the new one builds on it (`isAncestor`), else the
  merge base; the kind (_PR created_, _N new commits_, _Rebased_) is derived from it.
- **Change summaries** are made in the background right after a phase is recorded: one run on the guide's summary
  model with the phase's diff (cut like a guide's), its commits, the PR's description, earlier phases' intents and,
  for a push, the action items and GitHub reviews and comments since the previous phase. Stored as prose
  (`phases.summary`, migration 19, which drops the first try's separate `intent` and `why` columns); the prompt asks
  for the intent and the why. _Regenerate_ (or _Summarise_) makes one again.
- **`getTimeline`** puts it together on each read: phases with files, +/− lines and commits counted by git
  (`listCommits` now takes a head); every round's notes and questions (answers folded) and wrap-ups; GitHub's issue
  timeline (`getPullRequestActivity`, which replaces `getPullRequestOverview`): comments, reviews with their review
  comment count, merged, closed, reopened, ready or draft, force-pushed. Events go in the phase seen at or before
  them; a review in the phase of its commit.
- The core sends `timeline` when a phase is recorded or a summary starts or ends; entries changing also refetch it.
- Not checked in the running app yet: the user is testing it.

### Tech debt

- `ponytail:` `getTimeline` asks GitHub (the PR and up to 10 pages of its timeline) on every read, and entries
  changing reads it again. Cache the activity if the rate limit shows.
- `ponytail:` the summary's diff sizes are the guide's, copied; share them if they become settings.
- Phases are only seen while coxswain is open, so pushes made while it's closed are one phase, and the first phase
  covers everything up to the first head seen. A phase after a rebase summarises the whole PR again.
- A failed summary isn't tried again on its own until the app restarts.
- Agent sessions and hand-offs aren't on the timeline: hand-offs aren't recorded yet.
- The context (the timeline as text for agents) isn't built.

## 2026-09-26 — Every round readable, resolved when its items are done

### What works

- **Every review round is reachable** (ADR 0019,
  ticket 0001). `listRounds` replaces `getRound`: every round, oldest
  first, with its stream and action items. The Round bar steps through them with ‹ ›, the latest shown first and a
  new round showing itself. _Show round_ opens the selected round's action items and then its stream, each question
  with its follow-ups and answers. #5311's round 3, wrapped up with no action items, can be read again.
- **Done and resolved**: an action item has a _done_ checkbox (`action_items.done_at`, migration 17). A round is
  resolved once wrapped up with every item done, derived in `listRounds`, not stored. The bar says _wrapped up, N of
  M done_ or _resolved_.
- **Copy as prompt** puts the round's open action items and its stream on the clipboard (`formatHandOff`, now
  exported, written by the main process). Done items are left out of every hand-off, L4's too.
- **Wrap up takes a round id**, so an earlier round can be wrapped up again.
- _**Post to PR**_ is a disabled placeholder on the bar.

### Tech debt

- `ponytail:` `listRounds` reads every entry of a workspace on each change to entries; page it if rounds pile up.
- `ponytail:` _Post to PR_ does nothing yet.
- Wrapping up again loses which items were done.

## 2026-09-26 — Every agent run over ACP

### What works

- **Every agent run is an ACP session** ([ADR 0018](adr/0018-agents-over-acp.md),
  ticket 0004). `src/core/agents.ts` is the only place that starts an agent:
  `run(agent, options, handlers)` for a turn, `newSession` for an agent session stored before its first message,
  `history` for its transcript, `cancel` to stop a turn. L4's agent sessions, a round's questions, the three guide steps
  (`ask` in `guides.ts`) and wrap-up all call it; `runClaude`, the `claude -p` spawns, `transcriptPath`,
  `readTranscript`'s file reading and `stopGuides` are gone.
- **One adapter process** (`@agentclientprotocol/claude-agent-acp` 0.81.2, run by Electron as Node, with
  `@agentclientprotocol/sdk` 1.5.0), started on first use with `CLAUDE_CODE_EXECUTABLE` set to the `claude` on `PATH`.
  An adapter that exits is started again by the next run, which resumes its session there (checked). Quitting stops it,
  which ends every run.
- **Options are data**: the Claude record maps `tools: 'none'` to `tools: []` and `strictMcpConfig`, `instructions` to
  `systemPrompt`, `thinking: false` to `{ type: 'disabled' }`, `persist: false` to `persistSession: false`, and `mode`
  to the `auto` or `default` permission mode (`session/set_mode`). The model is set with `session/set_config_option`
  after `session/new`: the adapter prefers the user's settings over a `_meta` model. Without one, the agent's _default_
  option. Aliases (`haiku`) match an option
  by value, description or name. One-shot runs close their session after (`session/close`); otherwise their Claude
  Code processes stay.
- **Answer tool**: a localhost HTTP MCP server on a free port, a random path per run, one `answer` tool with the run's
  schema, allowed through `allowedTools`. Arguments are checked against the schema (`mismatch`); a misfit goes back to
  the agent as a tool error. The first fit ends the turn (`session/cancel`) and resolves the run.
- **Permission prompts** in L4 and in a question's thread (`PermissionPrompt` in `Agents.tsx`), with the options the
  agent sends; the pick goes back through `answerPermission`. L4 runs in auto mode, so only what the classifier would
  block asks; questions run in default mode with every tool, so edits and most commands ask. One-shot runs reject every
  request. A stopped turn or a closed window cancels a waiting prompt.
- **Chat entries from ACP updates**: streamed text is held until the next tool or the turn's end, so it arrives
  whole as before; a tool's line takes its title from the update that carries the input (`Bash git status`); a
  subagent's updates are left out. `ChatEntry` and the IPC shape are unchanged.
- The agent picks the session ID (`session/new`). Sessions made before load by their stored ID: #5311's 273-entry hand-off
  session replays in L4.
- Checked in a second instance on a copy of the database: L4 shows the old session's history; a new session runs a
  turn with a Bash call; a question gets its answer in its own session; guides and wrap-up run. In a scratch run
  against the adapter: 16 one-shot runs at once in 4.4 s, a permission request reaches the handler and its rejection
  reaches the agent, a session resumes after the adapter restarts. Not checked in the window: the permission prompt
  itself (the classifier in the session that drove the app wouldn't let it provoke one).
- **Guide timing on #5311** (279 files), same model (Opus 5.5) and summary cache, old `claude -p` → ACP: all summaries
  reused 62 s → 61 s (grouped 24 → 27 s, described 38 → 34 s); 56 files to summarise 89 s → 77 s.

### Tech debt

- **A model in the user's settings is ignored** (`ponytail:` in `openSession`): a run without a model gets the agent's
  own _default_ (Opus 5.5 here). Left to itself the adapter resolves the settings model differently from Claude Code:
  `"opus[1m]"` became Opus 4.8, which made a guide 216 s. The 1M-context variant isn't offered by the adapter.
- **An agent session never sent a message can't be resumed after a restart** (`ponytail:` on `startAgentSession`):
  its first message fails. Only happens if the first turn fails before it's sent.
- **The answer schema check is hand-written** (`ponytail:` on `mismatch`) for the keywords our schemas use.
- The adapter logs every session's phases to the main process's stderr, and the SDK warns once per answer run that
  `allowedTools` shadows `canUseTool`. Noise, not errors.
- Codex (`@zed-industries/codex-acp`) is a second agent record, not added yet.
- Paid off: "Blocked tools can't be approved" (the `ponytail:` on `runTurn`), and depending on Claude Code's
  stream-json and transcript formats.

## 2026-09-25 — Data fetching with TanStack Query

### What works

- **Every read from the core is a TanStack Query query** ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  ticket 0003). `queries.ts` holds the one `QueryClient` and
  `core(name, ...args)`, which turns a preload call into query options keyed `[name, ...args]`, so the keys live in
  one place. Switching back to a workspace or tab shows the cached data at once and refreshes behind it.
- **The core says what changed.** The main process sends `changed` (`{ workspaceId, what }`) when an ask's notes are
  marked sent, when an agent turn ends (`worktree`, `transcript`), when a question gets its answer (`entries`) and when
  a guide run ends (`guide`). `changed()` in `queries.ts` maps each `what` to the queries it makes stale. UI writes (a
  note, a deleted entry, an action item edited, wrap-up) call the same `changed()`; Viewed is set in the cache at once
  and refetched if storing it fails.
- The `version` prop and the `onTurnEnd` and `onEntriesChanged` callbacks are gone, and so are the per-component
  `stale` flags and the Overview's hand-made cache.
- **GitHub data refreshes**: `openWorktree` (the PR's head), the Overview and the open PRs go stale after a minute
  and refetch when the window gains focus. Offline or signed out, `openWorktree` and the Overview keep what they
  fetched before (the query errors and keeps its data), and the Navigator says the PR couldn't be checked.
- Refetches with the same data keep the same arrays (structural sharing), so the Navigator's tree and the memoised
  Viewers don't remount or redraw.
- Checked in the app on #5311: Overview, Diff (279 files, the round bar) and Guide load; the Guide shows its groups
  two frames after switching back from Overview; Viewed toggles and survives a tab switch. Not yet checked live: an
  agent turn or a question refreshing the panes through `changed`.

### Tech debt

- UI writes are plain calls followed by `changed()`, not `useMutation`; only Viewed is optimistic. Move to
  `useMutation` where a write needs pending or error state on screen.
- The Projects screen (repository pages) and Settings still load with `useEffect`; they aren't on the paths that
  switch often.
- Queries are dropped five minutes after their pane unmounts (TanStack's default `gcTime`); raise it if switching
  back after longer flashes empty.
- Paid off: "PR data loads once per workspace and never refreshes" and "Nothing is cached; switching workspaces
  refetches everything".

## 2026-09-25 — Typed queries

### What works

- **Every query in the core goes through Kysely** ([ADR 0016](adr/0016-typed-queries-with-kysely.md),
  ticket 0002). `db.ts` has the tables' types (`Tables`) next to the
  migrations; `openDatabase` still runs the migrations on `node:sqlite`, then returns a `Kysely<Tables>` (`Db`) on
  Kysely's own SQLite dialect, through a ten-line adapter. Column lists are typed arrays with `as` aliases, so a wrong
  column or alias fails `pnpm typecheck`. The `as` casts are gone; it found one: the stream was typed as entries with
  a state they don't have.
- Queries are async now, and so are the core functions that look up a workspace's worktree (`openedWorktree`,
  `openedBefore`, `getWorkspaceRepo`). `runTurn` checks for a running turn again after its lookup.
- Wrap-up writes its action items in a Kysely transaction; `getRound` counts the rounds in the same query it reads.
- Checked on a copy of the real database: projects, workspaces, agent sessions, settings, a guide and round 3
  read the same; the hand-offs of rounds 1–3, `getRound` and `getGuide` come out identical to the code before;
  a note is added, sent by an ask and deleted; a question with a stand-in `claude` makes the round's agent session,
  stores the answer and reuses the session; a failed transaction rolls back. A second instance on the copy shows
  #5311's Overview, Guide (80 files) and Diff (279 files, 223 viewed) as before.

### Tech debt

- **`Tables` is kept in step with the migrations by hand** (ADR 0016). A migration that changes a table without
  changing `Tables` still typechecks.
- JSON columns (`guides.groups`, `action_items.entry_ids`) are `string` and parsed by hand.

## 2026-09-25 — Hand off a round to the agent

### What works

- **Send to agent** on a wrapped-up round's bar puts the round in L4's message box (_Round N · N
  action items_, ✕ to take it out). The next message is an ask whose prompt is the action items in
  order, each with its anchor and code, then the round's whole numbered stream (notes, questions,
  answers) as context, then the notes attached and the user's text (`formatHandOff` in `review.ts`;
  `formatStream` is shared with wrap-up). It goes to L4's current agent session, so it shows there.
- Checked: the prompt for #5311's round 2 (4 items, 11 entries) from a copy of the database.
- **Agent sessions run in auto mode** ([ADR 0013](adr/0013-auto-permission-mode.md)), so the
  agent can read Linear, run tests and the like when Claude Code's classifier allows it; before,
  anything that would prompt was refused, which is why a hand-off on #5311 said Linear was declined.
  Checked with `claude -p --permission-mode auto` in #5311's worktree: a Linear read and `git log`
  ran with no denials. Questions stay read-only.
- **Fixed blank space in L4**: tool lines (`⏺ Bash …`) collapsed to nothing once the chat
  overflowed (`truncate` lets a flex item shrink to zero), leaving only the gaps between them. A
  subagent's own messages no longer stream into L4, matching what the transcript shows on reload.
- **Fixed Guides piling up**: every Guide → Diff → Guide switch left the old Guide in the page, so
  the tab showed several stacked. `Round` shared the Guide's key (the workspace ID) as its sibling, so
  React never deleted the old Guide's DOM. Found by driving a second instance over the Chrome
  DevTools protocol (`--remote-debugging-port`); checked the same way after the fix: one Guide on
  Guide, none on Diff or Overview.
- **Commits in the Diff tab**: _Commits_ next to _Files_ opens a native menu of the commits from
  the merge base to HEAD (`listCommits`); picking one shows its commit diff (first parent → commit;
  `listChangedFiles` takes a `head`, and the Viewer reads the new side at it). Checked on #5311: a
  commit's 80 files match `git diff`, and the button shows. The menu itself wasn't clicked (a native
  menu can't be driven over the DevTools protocol).
- **The guide is made on request**: without a stored guide, the Guide tab shows _Create guide_
  instead of starting one on open. A guide already being made still shows its progress.
- **A guide to one commit**: _Create guide_ and _Regenerate_ first open the Commits menu, _All
  Changes_ or one commit. A commit guide is made from its commit diff (migration 13: `guides.head`,
  with `merge_base` the commit's parent; `readFileDiff` and `diffFingerprints` take a `head`), and the
  Guide tab shows it with that commit's file diffs, its header saying _Commit abc1234_ or _All
  changes_. The tab shows the latest guide of either kind. Checked with a hand-made commit guide on a
  copy of the database: the commit's 80 files, 2 in its group and 78 under _Not in the guide_.
- Dropdown buttons have no ▾.
- **Guides are pinned to the PR head** ([ADR 0014](adr/0014-reviewed-follows-file-diff-contents.md)): a new
  guide to all changes covers the merge base → the PR head (migration 14: `guides.kind`, and `head`
  set for both kinds) and reads its file diffs there, so an agent's local edits don't show in it.
  When the PR head moves on, an amber bar says the guide is stale, with _Regenerate_. **Viewed
  belongs to file diff contents**: in a pinned guide it's read at the guide's head
  (`diffFingerprints`, one `git cat-file --batch`), in the Diff tab from the worktree; `viewed_files`
  keeps a row per fingerprint. File summaries use the same fingerprint. Checked on a copy of the
  database with #5311: a guide pinned at the head before the agent's commit shows 297 of 297 viewed
  and the stale bar; the live Diff tab shows 223 of 279; a guide at the new head would start at 223.
  Guides from before keep showing the live diff.
- **Entries record where they were written, and go outdated**
  ([ADR 0015](adr/0015-entries-pinned-and-outdated.md)). Migration 15: `entries.base`/`head` and
  `review_rounds.merge_base`/`head`. `listEntries` takes the view's range and gives each entry a
  state: current (its lines still read as its code), outdated, or wrapped-up. Only current entries
  show between the lines and in the ✎ counts; a file diff's header opens its _N outdated_. A
  wrapped-up round's entries leave the views; the Round bar still counts them. Prompts say "as at
  commit abc1234" for entries made on a pinned range.

### Tech debt

- **A hand-off isn't recorded** (`ponytail:` on `formatHandOff`): the items don't know they were
  sent, and the button offers it again. Add `handed_off_at` when it matters.
- **All items or none**: no picking single items; delete the others in the draft first.
- **Notes on a commit diff** keep the commit's line numbers but say "as in the worktree then", and
  _Viewed_ in a commit diff marks the file viewed for all changes (`ponytail:` on the Viewer's
  `head`). Anchor entries to the commit if that misleads.
- **A wrapped-up round with no action items can't be read again** (ADR 0015 hides wrapped-up rounds):
  ticket 0001.
- **Guide and Diff tab can disagree** on a file with local changes: viewed in one, not the other
  (ADR 0014). Local changes get no guide or "changes since" yet.
- **Guides from before pinning** have no head and keep the old live behaviour until regenerated.
- **Old viewed rows stay** (`ponytail:` in `viewed.ts`).
- **Commit guides don't expire** (`ponytail:` on `getGuide`): one stays even if a rebase drops its
  commit from the PR.
- **Summaries are cached per file**, not per diff, so guides to a commit and to all changes evict
  each other's summaries and re-summarise those files (Haiku calls) when they alternate.
- **A merge commit's diff** is against its first parent, so it shows everything merged in.
- **Blocked tools can't be approved** (`ponytail:` on `runTurn`): what auto mode blocks stays
  blocked until L4 shows permission prompts. Planned: every agent run over ACP
  ([ADR 0018](adr/0018-agents-over-acp.md), ticket 0004).
- **No data cache in the UI**: panes refetch on every switch and reread through `version` counters.
  Planned: TanStack Query with `changed` events from the core
  ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  ticket 0003).
- **The whole stream goes along**, answers in full. Fine for a round; trim if long rounds crowd the
  prompt.

## 2026-09-25 — App icon

### What works

- coxswain has an icon: a racing shell seen from above, oars out, with the cox in amber at the stern.
  The source is `resources/icon.svg`, rendered to `resources/icon.png` with
  `qlmanage -t -s 1024 -o resources resources/icon.svg` (then rename the output to `icon.png`).
- The main process sets it as the Dock icon on macOS and as the window icon on Windows and Linux.

### Tech debt

- **The icon is set at runtime** (`ponytail:` in `src/main/index.ts`), because there's no packaging
  yet. The menu bar still says _Electron_, and the Dock shows Electron's icon for a moment at launch.
  Build an `.icns` into the app bundle when we package.

## 2026-09-25 — Review rounds

### What works

Not checked in the app yet: the user tests it.

- **Review rounds of entries replace local comments** (ADR 0011).
  Glossary first: _note_, _question_, _answer_, _thread_, _anchor_, _review round_; _comment_ now
  means GitHub only; _local comment_, _imported comment_, _import_ and _publish_ are gone (_post_
  replaces publish).
- Migration 11: `review_rounds` and `entries` (kind, body, `parent_id`, optional anchor); old comments
  and the agent sessions asked from them are dropped; `agent_sessions` rebuilt with
  `review_round_id` in place of `comment_id`. Checked from a copy of a version 10 database.
- `src/core/comments.ts` is now `src/core/review.ts`. The gutter box says _Note_ where it said
  _Comment_.
- **Questions share one agent session per round**, so a question knows the earlier ones. They run
  read-only (`--permission-mode default`, so edits are refused), and the reply is saved as an answer
  entry when the turn ends. Follow-ups are questions in the same thread.
- **Counts of notes and questions** (`✎ N`, hover for how many of each) on changed files in the
  Navigator, tree and list, and on groups in the Guide's table of contents (`countItems` in `ui.tsx`).
  A question's follow-ups and answers don't count; the thread does.
- **Wrap up** (ADR 0012): a bar at the bottom of _Guide_ and
  _Diff_ shows the round (_Round N_, its notes and questions) and _Wrap up_, which sends the round's
  numbered stream to one `claude -p` with a schema and no tools (`runClaude`, now exported from
  `guides.ts`) and stores the action items it drafts (migration 12: `action_items`,
  `review_rounds.ended_at`). The draft opens above the bar to edit or delete items. Wrapping up ends
  the round; the next entry starts another. On #5311's test round it took 15 s and made one anchored
  item from a question and its answer, leaving out a note with nothing to change.
- `runTurn` takes a finished prompt; formatting an ask's notes moved to the main process
  (`formatAsk`), so `agents.ts` no longer depends on the review code.

### Tech debt

- **Rounds don't go stale** (`ponytail:` in `review.ts`): a round isn't tied to the commit or guide it
  reviewed, so new changes don't end it; only wrapping up does (glossary open question 3).
- **Only the latest round is reachable**: once a new round starts, the last one's entries and action
  items leave the UI (`ponytail:` on `ReviewRound`).
- **The wrap-up prompt is fixed** and uses Claude Code's default model, not in Settings like the
  guide's. No _Stop_ while it runs.
- **Hand-off isn't built**: action items can't be implemented or posted yet. (Paid off for agents in _Hand off a round to the agent_.)
- **Questions run one at a time per round**: a second while one runs gets _A turn is already running_.
  Queue them if it gets in the way.
- **Tool calls in a thread show only while streaming**; an answer keeps only the agent's text, and a
  stopped or failed turn leaves no answer.
- **Only changed files show counts** in the Navigator: in _Files_, a note on an unchanged file (made
  from a whole file) has no row decoration.
- No UI yet for a round's whole stream, floating entries, action items or GitHub comments (UX open
  question 3).

## 2026-09-25 — Faster guides

### What works

Not checked in the app yet: the user runs the first guide with it.

- **Guides made in one-turn calls** (ADR 0010). #5311 took ~6½ minutes,
  mostly summary agents taking ~20 turns to read diffs themselves. Now coxswain puts each file diff in
  the prompt (`readFileDiff`, cut to 300 lines) and every `claude -p` runs with no tools and a short
  system prompt of its own in place of Claude Code's.
- **Summaries are cached** in `file_summaries` (migration 10) by file diff fingerprint, so
  _Regenerate_ and a PR that moved on only summarise changed files. Every file is summarised now,
  small PRs too, in batches of at most 25 files or 1200 lines, 16 at once.
- **Grouping answers with file numbers**, not paths, and no descriptions; files it leaves out go in
  _Other changes_.
- **Groups are described in parallel after grouping**, each with a description and a _file note_ per
  file diff (glossary), shown above the file diff. The guide shows as soon as it's grouped, groups
  read _Describing…_ until theirs arrives, and the top counts the groups described.
- **How long a guide took** is stored (`started_at`, `finished_at`, migration 9) and shown at the top
  of the tab; the main process logs each phase's seconds and how many summaries were reused.
- The default guide prompt now asks for file notes too; Settings says what each model does.
- **First run on #5311: 3 min 31 s** (was ~6 min 25 s), on screen after 1 min 47 s: summaries ~70 s,
  grouping 30 s, 20 groups described in ~1 min 40 s (one took 99 s). Every file got a note.
- **Summaries run without thinking** (`MAX_THINKING_TOKENS=0`): Haiku spent about as many tokens
  thinking as answering. Grouping and describing keep it.
- **Fixed: switching workspace on the Guide tab made a stray guide** for the new workspace from the old one's
  merge base (the first render after a switch still held the old PR data), running 16 `claude` processes
  in the background over a diff of 1000+ files. `usePullRequest` now only returns data for the current
  workspace.
- **Notes don't mention file numbers**: one said "file 106"; the prompts now say to name files by path.
- **Guide tags**: grouping may tag a group _generated_ (glossary); the default prompt asks for
  lockfiles, generated clients, snapshots and build output to go in such groups. They're sorted last
  (in the core, and in the tab after _Not in the guide_) and low-lighted. Old guides have no tags.
- **Scrolling file diffs no longer freezes** (Diff and Guide tabs): `@pierre/diffs` highlighted each
  file diff on the main thread as it scrolled into range. It now runs in the library's worker pool
  (`WorkerPoolContextProvider` in `main.tsx`, ES module workers in `electron.vite.config.ts`).
- **Long lines wrap** in file diffs and files, instead of scrolling sideways (`overflow: 'wrap'` in
  `Viewer.tsx`; the library's virtualizer measures wrapped lines).
- **View options in the tab's bar**: on _Guide_ and _Diff_, a cog opens a native menu with _Unified_
  or _Split_ file diffs and _Show Viewed Files_. That setting moved there from the Navigator's cog
  menu and the Guide's _Show viewed_ button, so the two now share it. It resets on restart
  (`ponytail:` in `App.tsx`), like the Navigator's settings.
- **Guide text renders as Markdown**: group titles (inline), descriptions and file notes, with one
  readable style for descriptions and notes and more space between groups. The Markdown setup is
  shared as `Prose` in `ui.tsx`, also used by the Overview and agent replies.

### Tech debt

- Paid off: summaries weren't cached.
- **Batch sizes, cut-offs and parallelism are fixed guesses** (`ponytail:` in `guides.ts`): 300 lines
  per diff, 25 files or 1200 lines per batch, 3000 lines per group, 16 calls at once.
- Paid off: rules for generated files, now the _generated_ guide tag. A saved custom guide prompt
  doesn't get the new sentence; the schema's description of the tag still tells the agent.
- **An unfinished guide** (the app quit while describing) stays so until regenerated.
- **The progress bar's split** between summarising and grouping (50/50) and its pace are new guesses.
- **Placeholder heights of file diffs not yet loaded are guesses** (20 px a changed line, capped at
  200 lines), so the page shifts a little when one loads.

## 2026-09-24 — Guide

### What works

- **The Guide tab** (ADR 0009). The first time it opens
  it shows a progress bar while `createGuide` asks Claude Code (`claude -p` with a
  JSON schema). No diff goes in the prompt: agents get the file list and read diffs themselves with
  `git diff` (read-only tools, no MCP servers). A big PR is cut into batches of files, summarised by
  up to eight agents at once on the summary model (`haiku`), then one agent groups the summaries. The guide's groups show one after another: title, a short
  description of what to look at, then the group's file diffs, the same Viewer as in _Diff_
  (comments, _Ask agent_, Viewed). A group's _Viewed_ checkbox marks all its file diffs. Viewed file
  diffs and fully viewed groups are hidden, with _Show viewed_ to bring them back. A table of
  contents on the left lists the groups with their viewed counts and a bar for the whole guide,
  follows the scroll, and jumps to a group on click. Its width is fixed (`ponytail:` in `Guide.tsx`). Files the guide doesn't mention show last under _Not in the guide_. _Regenerate_ makes
  a new one. Leaving the tab while it's being made and coming back waits for the same run.
- **Guides are stored** (`guides`, migration 7) with the merge base and the model that made them,
  shown at the top of the tab. Checked in the app: #5284 got five groups from
  `claude-opus-5-5[1m]`, and showed again at once after a restart.
- **Settings > Guide**: the guide prompt (with _Reset_), the model (empty is Claude Code's
  default) and the summary model, stored in a new `settings` table (migration 8).
- **Stacked file diffs read their files only when scrolled near the screen**, in both _Diff_ and
  _Guide_. Before, a big PR (#5311, 297 files) started ~600 `git` processes at once and every other
  call, like switching tabs or workspaces, queued behind them.
- The agents are told to run `git diff --no-ext-diff`, since one repo's `.gitattributes` sends CSV to
  `daff`, which isn't always installed. A first version put the patch in the prompt and failed on it.

### Tech debt

- **Groups are whole file diffs**, not hunks (UX open question 2).
- **Summaries aren't cached**, and batch sizes and parallelism are fixed (`ponytail:` in
  `guides.ts`): _Regenerate_ summarises everything again. Cache by `diffFingerprint` when that hurts.
- **The progress bar is approximate**: the core reports batches summarised and when grouping
  starts (`guides:progress`); between those the bar creeps on at a guessed pace (`Guide.tsx`), and
  the split between summarising and grouping (60/40) is a guess from one PR.
- **A guide from another merge base is hidden, not marked outdated**, and files changed since
  only show under _Not in the guide_.
- **Two app instances make two guides**: runs are shared per process only.
- **A file diff still loading shows its path at a guessed height**, so scrolling to a file can land a
  bit off until the ones above it have loaded (the old `ponytail:` in `App.tsx`, now smaller).

## 2026-09-24 — Viewer tabs

### What works

- **Tabs in L3:** _Overview_, _Guide_ and _Diff_. A workspace opens on _Overview_: the PR's title
  and its description as Markdown (`getPullRequestOverview`). Cached in memory per workspace, so the
  tab shows at once and refreshes in the background.
  _Guide_ says "Coming soon". _Diff_ shows every changed file's diff one after another in one
  scroll, with the Navigator on its left, shown with the _Files N_ toggle in the tab's bar; picking a changed file there scrolls to
  it, and a file picked in _Files_ shows in place of the file diffs. The Diff tab stays mounted
  while another tab shows, so the file diffs and Navigator keep their state. A second bar under the tabs is there for each tab's options, empty so far.
- **The Navigator and L4 start hidden**; ⌘B (_View > Toggle Navigator_) toggles the Navigator too.
  L4's button moved from its header to the right of each tab's bar, as an _Agent_ toggle like _Files_.

### Tech debt

- **Switching tabs or panes was slow**: every click re-diffed and redrew every file diff, since the
  Viewers re-rendered with new file objects and `@pierre/diffs` redraws on each render. Paid off: the
  Viewer is memoised with stable props, and the Diff tab uses the library's `Virtualizer`, which
  draws only the lines on screen. Still, **every changed file is read from disk up front**
  (`ponytail:` in `App.tsx`); read them as they scroll into view if big PRs load slowly.
- **Scrolling to a file diff can land short** while file diffs above it are still loading
  (`ponytail:` in `App.tsx`).

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
- **Asks.** _Send to agent_ puts a comment in the L4 message box as a chip; several can be collected.
  On send, the core puts each comment in front of the message (file, lines, side, the code in a
  fence, the comment) and marks them sent; they then show _Sent to agent_ inline.
- **Agent replies render as Markdown** in L4 (`react-markdown` + `remark-gfm`: lists, tables,
  code, links). Links open in the browser; the app window never navigates.
- **Ask agent from a comment.** The comment box has _Ask agent_ (⇧⌘Enter): it saves the comment
  and starts an agent session tied to it (`agent_sessions.comment_id`, migration 6), with the
  comment as the first turn. Replies stream into the comment's thread in the Viewer, and the user
  can answer there. L4 leaves these sessions out. The Viewer now keeps showing the file while it
  rereads after a turn, instead of flashing _Loading…_. Checked in the app: an ask and a follow-up.
- **Viewed files.** A _Viewed_ checkbox in a file diff's header; the Navigator hides viewed files, says
  "N of M viewed", and has a cog button with a native menu: _Show Viewed Files_ (then shown with a
  ✓), and _As Tree_ / _As List_ for the changed files. Stored per workspace (`viewed_files`, migration 5) with a fingerprint of the
  file diff (merge base + worktree file), so a file becomes unviewed when an agent or new PR commits
  change it. Checked in the app on #5284.
- **The Agents pane can be hidden**: a button in its header, _View > Toggle Agents_ (⌥⌘B), and a
  button in L3's top bar to show it again. It stays mounted while hidden, so a running turn keeps
  going and still reloads the diff. _Send to agent_ shows it.
- **Resizable panes.** Drag the border between L2 and L3, or L3 and L4, to resize. L3 takes the
  rest.
- Checked in the app on a private repo #5291: comment on lines 3–5, send with an instruction,
  the agent read the file and answered about those lines.

### Tech debt

- **Viewed isn't synced with GitHub's** _Viewed_ checkbox; it's local only, and also covers local
  changes, which GitHub doesn't see.
- **The ✓ in the Navigator is redrawn by resetting the rows' git status** (`ponytail:` in
  `Navigator.tsx`), since `@pierre/trees` has no call to refresh decorations.
- **The Navigator's cog settings reset** per workspace and on restart (`ponytail:` in
  `Navigator.tsx`), like the pane widths.
- **The list is a tree without folders:** `@pierre/trees` has no list mode, so rows are named after
  the file and the folder goes in the row decoration. Two files with the same name show their whole
  path instead. A long file name squeezes out its folder and can clip the +/− lines.
- **Whether the Agents pane is shown resets on restart**, like the pane widths.
- **A thread may show an entry twice** if it mounts while its turn runs (transcript + stream;
  `ponytail:` in `Viewer.tsx`).
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
files there, and _Diffs_ shows what they changed. That's the first full loop for G4: ask the agent,
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
- **Navigator and Viewer read the worktree.** _Diffs_ is `git diff <merge base>` against the
  worktree plus untracked files (renames detected); _Files_ is `git ls-files`; the Viewer's old side
  is `git show <merge base>:<path>`, its new side the file on disk. Both reload after every agent
  turn.
- **Agents edit files** in their worktree (`--permission-mode acceptEdits`). Checked in the app: a
  33-second first open of a private repo #5284, then an agent-written file showed up in _Diffs_
  next to the PR's 12 files.
- The core resolves every path and ref itself from workspace and project IDs; file paths from the
  UI can't leave the worktree, and commits must be full SHAs.

### Tech debt

Paid off from the proof of concept: per-file GitHub API reads for trees and files, GitHub's
truncated trees and 3000-file limit on _Diffs_, the missing clone and worktree paths, and the empty
agent folder.

- **PR and local changes look the same** in _Diffs_ ([UX](UX.md) open question 5).
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

L4 is now a chat with a local Claude Code, per ADR 0007. It
proves the loop of sending a turn, streaming the reply and resuming later. The agent can't see the
PR's code yet, because there is still no clone.

### What works

- **Chat in L4.** Type a message, press Enter; the agent's text and each tool it uses (one line,
  e.g. `⏺ Bash pwd`) appear as they arrive. _Stop_ kills a running turn.
- **Agent sessions per workspace.** The first message creates one (`agent_sessions` table, migration
  3). _New session_ starts another with the next message. Switching workspaces shows that
  workspace's latest agent session.
- **Resume after restart.** The transcript is read back from Claude Code's own
  `~/.claude/projects/*/<session ID>.jsonl`, and the next turn resumes with `--resume`.
- **Running turns are killed** when the app quits.

### How it's put together

| Where                         | What                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/agents.ts`          | Agent sessions in SQLite, `runTurn` (spawns `claude -p … --output-format stream-json`), `readTranscript`, `stopTurn`. One parser for stream and transcript lines. |
| `src/main/index.ts`           | `agents:*` handlers; chat entries go to the window as `agents:entry` events.                                                                                      |
| `src/renderer/src/Agents.tsx` | The L4 chat pane.                                                                                                                                                 |

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
- **Navigator** (L2). A _Diffs / Files_ toggle: the PR's changed files as a tree with status and
  +/− lines, or the whole tree at the PR's head with changed folders marked.
- **Viewer** (L3). Selecting a file in _Diffs_ shows its file diff side by side (merge base vs head,
  as GitHub shows it); selecting one in _Files_ shows the whole file.
- **Storage.** Projects and workspaces persist in SQLite, with migrations from the start.

L4 (agents) is an empty placeholder (since filled; see the entry above).

### How it's put together

| Where                  | What                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`            | The UI-free core ([ADR 0002](adr/0002-standalone-electron-app.md)): `github.ts` (Octokit, token from `gh`), `db.ts` (SQLite and migrations), `projects.ts`, `workspaces.ts`.       |
| `src/main/index.ts`    | Electron main process: window, native menu, and one `ipcMain.handle` per core function.                                                                                            |
| `src/preload/index.ts` | The single typed interface the UI uses to reach the core (`window.coxswain`).                                                                                                      |
| `src/renderer/src/`    | React UI. `App.tsx` holds the screen state; one file per screen or pane (`Navigator`, `Viewer`, `Projects`, `NewWorkspace`, `Settings`, `Onboarding`); `ui.tsx` has shared pieces. |

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
- `gh` is found through `PATH` (a packaged app takes the login shell's, ADR 0024).
- Open PRs: only the first 100 are listed.
- Repository search only filters the pages already loaded.
- No ETags (ADR 0006, decision 7): GitHub data refetches in full after a minute, on window focus (ADR 0017).

**Data and state**

- Projects and workspaces can't be removed, and closed or merged PRs keep their workspace.
- UI state isn't stored (ADR 0005 plans for it): the Diffs/Files toggle, the open file and pane sizes
  reset on restart.
- The core runs inside the main process and SQLite calls are synchronous. Fine at this size; move it
  to a utility process if the main process ever stutters.
- IPC handlers don't validate their arguments; they trust the renderer.

**UI**

- shadcn/ui isn't set up (ADR 0004); `src/renderer/src/components/` holds our own controls until it is.
- Keyboard shortcuts cover Settings, Open Quickly, the command palette (⌘K), Toggle Navigator, Back and Forward;
  the rest are reached through ⌘K.
- ADR 0004's system accent colour, reduced motion and high contrast aren't wired up.
- The native menu is laid out for macOS only.
- Panes have fixed widths; no resizing.
- The Viewer shows one file at a time; tabs are an open question in [UX](UX.md).
- No React error boundary; a failed core call can leave a pane blank.
- The renderer bundle isn't split; Shiki's grammars all ship in it.

**Tooling**

- Tests are one `node --test` file (`pnpm test`); no linter or formatter config.
- No signing or auto-update (ADR 0024).
- electron-vite 5 doesn't know Electron 44 downloads its binary lazily, so `postinstall` runs
  `install-electron`. Remove it once electron-vite catches up.
- electron-vite 5 holds Vite at 7.
- `@pierre/trees` is a beta and `@pierre/diffs` is young (ADR 0003); both are pinned and need
  deliberate upgrades.

**Docs**

- [ADR 0005](adr/0005-local-data-storage.md) still says _session_ for what the glossary now calls a
  _workspace_. Accepted ADRs aren't edited; a later ADR touching storage should use the new term.
