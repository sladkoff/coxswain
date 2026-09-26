# coxswain — devlog

Where the build stands and what we owe. Newest entry first. Terms are defined in
[the glossary](context/coxswain.md); decisions are in [the ADRs](adr/).

## 2026-09-27 — Guides made by the agent pane

### What works

- **Guides are agentic** ([ADR 0023](adr/0023-guides-made-by-the-agent-pane.md)). The agent pane's sessions get
  coxswain's MCP tools (`start_guide`, `add_group`, `add_explanation`, `add_finding`) from the local server that served
  the answer tool, at a path per workspace, allowed without asking. "Make me a guide" in the agent pane works; so do
  *Make a Guide* and *Make a Guide with Review* in the canvas bar's new *Guide* menu (`requestGuide`, like
  *Send all to agent*). How to guide is in `start_guide`'s result.
- **Guides show in *Changes*:** groups in reading order with title, description and file notes, *Not in the guide*,
  generated groups last. Explanations and findings are entries (new kinds) with a `guide_id`, shown as threads only
  with their guide; replying goes to the agent by default. *Send all to agent* leaves out the ones nobody replied to.
- **Pinned and kept:** a guide shows its range (merge base → PR head then), like a commit; stale once the PR moves
  on. Every guide stays in the *Guide* menu. The newest shows when it appears, and on opening if not stale.
- **The old pipeline is gone:** file summaries, grouping and describing calls, the guide prompt and model, `Guide.tsx`
  and the progress plumbing. Migration 21 drops `guides` and `file_summaries` (and their data), makes a new `guides`
  table and rebuilds `entries`. The summary model moved to Settings > *Change summaries*; `ask` lives in `timeline.ts`.
- **The guide's table of contents is back** (`GuideToc.tsx`, from the old Guide tab): left of the canvas while a
  guide shows, with viewed counts per group and in all, `✎` counts, the group being read marked, and click to jump.
  `countItems` no longer makes an empty count for explanations and findings (`✎ 0`).
- Tried on PR #1 of the test project: the agent called every tool, and the guide, two explanations and five findings
  showed on the canvas while it worked.

### Tech debt

- The tools add to the workspace's latest guide, so two sessions making guides at once mix.
- A guide request goes to the latest agent session, like comments, not the one the picker shows.
- The Navigator keeps tree order under a guide; only the canvas and its table of contents are in reading order.
- `ponytail:` the table of contents has a fixed width; make it resizable like the Navigator if titles get cut.
- `Overview.tsx` still isn't mounted anywhere.

## 2026-09-26 — Agent-first layout, first rough pass

### What works

- **No more tabs.** The *Overview*, *Guide* and *Diff* tabs are gone. Opening a PR shows the **agent pane**
  (the old L4 chat) on the left, always visible and resizable, and the **canvas** on the right (glossary). For
  now the canvas has one tab, *Changes* (the file diffs), in a tabs row above a bar with *Files*, *Commits* and the cog.
- **The canvas's bottom bar** sums up the review: threads (outdated, waiting on the agent), +/− lines, and files
  viewed with a progress bar. Its thread count opens a list of every thread; clicking one scrolls to it.
  *Send all to agent* sends every thread in one message to the agent pane's session (`sendReview`), known in the
  transcript by a `[Review · N threads]` header like a comment's, and shown as a card. *Show Viewed Files* now hides viewed file diffs on the canvas too, not only in the
  Navigator; when all are viewed it says so, with *Show them*.
- *View > Toggle Agents* (⌥⌘B) is gone, since the agent pane is always shown.
- The agent pane's header no longer says *Claude Code*. A session picker there (*Session N · date*) shows any of the
  workspace's agent sessions, not only the latest; *New session* next to it.
- **Comments are threads.** The comment box on lines is a send button (Enter), a *Send to agent* checkbox and ✕ to
  cancel. Every comment starts a thread with a reply box of the same shape, so a note can be answered too. Ticked, a
  comment is a question and the agent's answer lands in the thread; unticked, a note. No schema change: `parent_id`
  already threads entries, it just wasn't used for notes. A question asked in a thread is given the thread's notes
  since its last question (and the anchor, if the thread began as a note), since the agent session never saw them.
  Note boxes and question threads are now one `ThreadBox`. The old *Send to agent* on a note (a chip in the agent
  pane's message box, once only) is gone with its plumbing (`noteIds`, `formatAsk`'s notes); reply with the box
  ticked instead. `entries.sent_at` is no longer written or read.
- **Comments go to the agent pane** ([ADR 0021](adr/0021-comments-go-to-the-agent-pane.md)): a question is a turn
  in the workspace's current agent session, not a hidden per-round one. The agent chat shows it as a card (*Comment
  on `a.ts:3` sent to Claude*, the comment, *View thread*, which scrolls the canvas to the thread); the reply streams
  to both and is kept as the thread's answer. The card comes from a header line in the prompt, read back from the
  transcript (`withComment` in `core/agents.ts`).
- **No more review rounds** ([ADR 0022](adr/0022-no-review-rounds.md)): entries belong to their workspace. Rounds,
  wrap up, action items, hand-off and *Copy as prompt* are gone from the core, IPC and UI (`Round.tsx` deleted; round
  events left the timeline and action items the change summaries). Migration 20 rebuilds `entries` with
  `workspace_id` and `agent_sessions` without `review_round_id`, and drops `action_items` and `review_rounds`; ran
  on the real database with its 17 entries kept. `ask`'s `instructions` parameter went with wrap up.

### Tech debt

- `Overview.tsx` isn't mounted anywhere; kept until the canvas can show it (`Guide.tsx` went with ADR 0023).
- `ponytail:` the comment card is parsed from the prompt's header line; store sent comments by turn if it gets in the way.
- `ponytail:` *View thread* stops at the file for an outdated thread, which isn't between the lines.
- The agent pane shows no *Working…* during a comment's turn, and a comment fails if the pane's own turn is running.
- `ponytail:` comments and *Send all to agent* go to the latest agent session, not the one the picker shows.
- `ponytail:` every entry a workspace ever had is listed; nothing archives old ones.
- UX.md's L3 and L4 sections still describe the tabbed layout; they get rewritten once the canvas settles.

## 2026-09-26 — The Overview's timeline

### What works

- **The Overview is a timeline** ([ADR 0020](adr/0020-timeline-of-phases.md)): the PR's title, author and GitHub link,
  then its phases, newest first, each with its events, newest first too. Terms (*timeline*, *phase*, *change summary*, *event*,
  *context*) are in the glossary; the layout is in UX.md.
- **Phases** (`phases` table, migration 18): every PR head `openWorktree` reads is passed to `recordHead`, which adds
  a phase when the head is new. `base` is the previous head if the new one builds on it (`isAncestor`), else the
  merge base; the kind (*PR created*, *N new commits*, *Rebased*) is derived from it.
- **Change summaries** are made in the background right after a phase is recorded: one run on the guide's summary
  model with the phase's diff (cut like a guide's), its commits, the PR's description, earlier phases' intents and,
  for a push, the action items and GitHub reviews and comments since the previous phase. Stored as prose
  (`phases.summary`, migration 19, which drops the first try's separate `intent` and `why` columns); the prompt asks
  for the intent and the why. *Regenerate* (or *Summarise*) makes one again.
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

- **Every review round is reachable** ([ADR 0019](adr/0019-round-history-and-resolving.md),
  [ticket 0001](tickets/0001-read-a-wrapped-up-round.md)). `listRounds` replaces `getRound`: every round, oldest
  first, with its stream and action items. The Round bar steps through them with ‹ ›, the latest shown first and a
  new round showing itself. *Show round* opens the selected round's action items and then its stream, each question
  with its follow-ups and answers. #5311's round 3, wrapped up with no action items, can be read again.
- **Done and resolved**: an action item has a *done* checkbox (`action_items.done_at`, migration 17). A round is
  resolved once wrapped up with every item done, derived in `listRounds`, not stored. The bar says *wrapped up, N of
  M done* or *resolved*.
- **Copy as prompt** puts the round's open action items and its stream on the clipboard (`formatHandOff`, now
  exported, written by the main process). Done items are left out of every hand-off, L4's too.
- **Wrap up takes a round id**, so an earlier round can be wrapped up again.
- ***Post to PR*** is a disabled placeholder on the bar.

### Tech debt

- `ponytail:` `listRounds` reads every entry of a workspace on each change to entries; page it if rounds pile up.
- `ponytail:` *Post to PR* does nothing yet.
- Wrapping up again loses which items were done.

## 2026-09-26 — Every agent run over ACP

### What works

- **Every agent run is an ACP session** ([ADR 0018](adr/0018-agents-over-acp.md),
  [ticket 0004](tickets/0004-agent-sessions-over-acp.md)). `src/core/agents.ts` is the only place that starts an agent:
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
  after `session/new`: the adapter prefers the user's settings over a `_meta` model. Without one, the agent's *default*
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
  own *default* (Opus 5.5 here). Left to itself the adapter resolves the settings model differently from Claude Code:
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
  [ticket 0003](tickets/0003-data-fetching-with-tanstack-query.md)). `queries.ts` holds the one `QueryClient` and
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
  [ticket 0002](tickets/0002-typed-queries-with-kysely.md)). `db.ts` has the tables' types (`Tables`) next to the
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

- **Send to agent** on a wrapped-up round's bar puts the round in L4's message box (*Round N · N
  action items*, ✕ to take it out). The next message is an ask whose prompt is the action items in
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
- **Commits in the Diff tab**: *Commits* next to *Files* opens a native menu of the commits from
  the merge base to HEAD (`listCommits`); picking one shows its commit diff (first parent → commit;
  `listChangedFiles` takes a `head`, and the Viewer reads the new side at it). Checked on #5311: a
  commit's 80 files match `git diff`, and the button shows. The menu itself wasn't clicked (a native
  menu can't be driven over the DevTools protocol).
- **The guide is made on request**: without a stored guide, the Guide tab shows *Create guide*
  instead of starting one on open. A guide already being made still shows its progress.
- **A guide to one commit**: *Create guide* and *Regenerate* first open the Commits menu, *All
  Changes* or one commit. A commit guide is made from its commit diff (migration 13: `guides.head`,
  with `merge_base` the commit's parent; `readFileDiff` and `diffFingerprints` take a `head`), and the
  Guide tab shows it with that commit's file diffs, its header saying *Commit abc1234* or *All
  changes*. The tab shows the latest guide of either kind. Checked with a hand-made commit guide on a
  copy of the database: the commit's 80 files, 2 in its group and 78 under *Not in the guide*.
- Dropdown buttons have no ▾.
- **Guides are pinned to the PR head** ([ADR 0014](adr/0014-guides-pinned-to-the-pr-head.md)): a new
  guide to all changes covers the merge base → the PR head (migration 14: `guides.kind`, and `head`
  set for both kinds) and reads its file diffs there, so an agent's local edits don't show in it.
  When the PR head moves on, an amber bar says the guide is stale, with *Regenerate*. **Viewed
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
  show between the lines and in the ✎ counts; a file diff's header opens its *N outdated*. A
  wrapped-up round's entries leave the views; the Round bar still counts them. Prompts say "as at
  commit abc1234" for entries made on a pinned range.

### Tech debt

- **A hand-off isn't recorded** (`ponytail:` on `formatHandOff`): the items don't know they were
  sent, and the button offers it again. Add `handed_off_at` when it matters.
- **All items or none**: no picking single items; delete the others in the draft first.
- **Notes on a commit diff** keep the commit's line numbers but say "as in the worktree then", and
  *Viewed* in a commit diff marks the file viewed for all changes (`ponytail:` on the Viewer's
  `head`). Anchor entries to the commit if that misleads.
- **A wrapped-up round with no action items can't be read again** (ADR 0015 hides wrapped-up rounds):
  [ticket 0001](tickets/0001-read-a-wrapped-up-round.md).
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
  ([ADR 0018](adr/0018-agents-over-acp.md), [ticket 0004](tickets/0004-agent-sessions-over-acp.md)).
- **No data cache in the UI**: panes refetch on every switch and reread through `version` counters.
  Planned: TanStack Query with `changed` events from the core
  ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  [ticket 0003](tickets/0003-data-fetching-with-tanstack-query.md)).
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
  yet. The menu bar still says *Electron*, and the Dock shows Electron's icon for a moment at launch.
  Build an `.icns` into the app bundle when we package.

## 2026-09-25 — Review rounds

### What works

Not checked in the app yet: the user tests it.

- **Review rounds of entries replace local comments** ([ADR 0011](adr/0011-review-rounds-and-entries.md)).
  Glossary first: *note*, *question*, *answer*, *thread*, *anchor*, *review round*; *comment* now
  means GitHub only; *local comment*, *imported comment*, *import* and *publish* are gone (*post*
  replaces publish).
- Migration 11: `review_rounds` and `entries` (kind, body, `parent_id`, optional anchor); old comments
  and the agent sessions asked from them are dropped; `agent_sessions` rebuilt with
  `review_round_id` in place of `comment_id`. Checked from a copy of a version 10 database.
- `src/core/comments.ts` is now `src/core/review.ts`. The gutter box says *Note* where it said
  *Comment*.
- **Questions share one agent session per round**, so a question knows the earlier ones. They run
  read-only (`--permission-mode default`, so edits are refused), and the reply is saved as an answer
  entry when the turn ends. Follow-ups are questions in the same thread.
- **Counts of notes and questions** (`✎ N`, hover for how many of each) on changed files in the
  Navigator, tree and list, and on groups in the Guide's table of contents (`countItems` in `ui.tsx`).
  A question's follow-ups and answers don't count; the thread does.
- **Wrap up** ([ADR 0012](adr/0012-wrap-up-and-action-items.md)): a bar at the bottom of *Guide* and
  *Diff* shows the round (*Round N*, its notes and questions) and *Wrap up*, which sends the round's
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
  guide's. No *Stop* while it runs.
- **Hand-off isn't built**: action items can't be implemented or posted yet. (Paid off for agents in *Hand off a round to the agent*.)
- **Questions run one at a time per round**: a second while one runs gets *A turn is already running*.
  Queue them if it gets in the way.
- **Tool calls in a thread show only while streaming**; an answer keeps only the agent's text, and a
  stopped or failed turn leaves no answer.
- **Only changed files show counts** in the Navigator: in *Files*, a note on an unchanged file (made
  from a whole file) has no row decoration.
- No UI yet for a round's whole stream, floating entries, action items or GitHub comments (UX open
  question 3).

## 2026-09-25 — Faster guides

### What works

Not checked in the app yet: the user runs the first guide with it.

- **Guides made in one-turn calls** ([ADR 0010](adr/0010-faster-guides.md)). #5311 took ~6½ minutes,
  mostly summary agents taking ~20 turns to read diffs themselves. Now coxswain puts each file diff in
  the prompt (`readFileDiff`, cut to 300 lines) and every `claude -p` runs with no tools and a short
  system prompt of its own in place of Claude Code's.
- **Summaries are cached** in `file_summaries` (migration 10) by file diff fingerprint, so
  *Regenerate* and a PR that moved on only summarise changed files. Every file is summarised now,
  small PRs too, in batches of at most 25 files or 1200 lines, 16 at once.
- **Grouping answers with file numbers**, not paths, and no descriptions; files it leaves out go in
  *Other changes*.
- **Groups are described in parallel after grouping**, each with a description and a *file note* per
  file diff (glossary), shown above the file diff. The guide shows as soon as it's grouped, groups
  read *Describing…* until theirs arrives, and the top counts the groups described.
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
- **Guide tags**: grouping may tag a group *generated* (glossary); the default prompt asks for
  lockfiles, generated clients, snapshots and build output to go in such groups. They're sorted last
  (in the core, and in the tab after *Not in the guide*) and low-lighted. Old guides have no tags.
- **Scrolling file diffs no longer freezes** (Diff and Guide tabs): `@pierre/diffs` highlighted each
  file diff on the main thread as it scrolled into range. It now runs in the library's worker pool
  (`WorkerPoolContextProvider` in `main.tsx`, ES module workers in `electron.vite.config.ts`).
- **Long lines wrap** in file diffs and files, instead of scrolling sideways (`overflow: 'wrap'` in
  `Viewer.tsx`; the library's virtualizer measures wrapped lines).
- **View options in the tab's bar**: on *Guide* and *Diff*, a cog opens a native menu with *Unified*
  or *Split* file diffs and *Show Viewed Files*. That setting moved there from the Navigator's cog
  menu and the Guide's *Show viewed* button, so the two now share it. It resets on restart
  (`ponytail:` in `App.tsx`), like the Navigator's settings.
- **Guide text renders as Markdown**: group titles (inline), descriptions and file notes, with one
  readable style for descriptions and notes and more space between groups. The Markdown setup is
  shared as `Prose` in `ui.tsx`, also used by the Overview and agent replies.

### Tech debt

- Paid off: summaries weren't cached.
- **Batch sizes, cut-offs and parallelism are fixed guesses** (`ponytail:` in `guides.ts`): 300 lines
  per diff, 25 files or 1200 lines per batch, 3000 lines per group, 16 calls at once.
- Paid off: rules for generated files, now the *generated* guide tag. A saved custom guide prompt
  doesn't get the new sentence; the schema's description of the tag still tells the agent.
- **An unfinished guide** (the app quit while describing) stays so until regenerated.
- **The progress bar's split** between summarising and grouping (50/50) and its pace are new guesses.
- **Placeholder heights of file diffs not yet loaded are guesses** (20 px a changed line, capped at
  200 lines), so the page shifts a little when one loads.

## 2026-09-24 — Guide

### What works

- **The Guide tab** ([ADR 0009](adr/0009-guides-from-structured-output.md)). The first time it opens
  it shows a progress bar while `createGuide` asks Claude Code (`claude -p` with a
  JSON schema). No diff goes in the prompt: agents get the file list and read diffs themselves with
  `git diff` (read-only tools, no MCP servers). A big PR is cut into batches of files, summarised by
  up to eight agents at once on the summary model (`haiku`), then one agent groups the summaries. The guide's groups show one after another: title, a short
  description of what to look at, then the group's file diffs, the same Viewer as in *Diff*
  (comments, *Ask agent*, Viewed). A group's *Viewed* checkbox marks all its file diffs. Viewed file
  diffs and fully viewed groups are hidden, with *Show viewed* to bring them back. A table of
  contents on the left lists the groups with their viewed counts and a bar for the whole guide,
  follows the scroll, and jumps to a group on click. Its width is fixed (`ponytail:` in `Guide.tsx`). Files the guide doesn't mention show last under *Not in the guide*. *Regenerate* makes
  a new one. Leaving the tab while it's being made and coming back waits for the same run.
- **Guides are stored** (`guides`, migration 7) with the merge base and the model that made them,
  shown at the top of the tab. Checked in the app: #5284 got five groups from
  `claude-opus-5-5[1m]`, and showed again at once after a restart.
- **Settings > Guide**: the guide prompt (with *Reset*), the model (empty is Claude Code's
  default) and the summary model, stored in a new `settings` table (migration 8).
- **Stacked file diffs read their files only when scrolled near the screen**, in both *Diff* and
  *Guide*. Before, a big PR (#5311, 297 files) started ~600 `git` processes at once and every other
  call, like switching tabs or workspaces, queued behind them.
- The agents are told to run `git diff --no-ext-diff`, since one repo's `.gitattributes` sends CSV to
  `daff`, which isn't always installed. A first version put the patch in the prompt and failed on it.

### Tech debt

- **Groups are whole file diffs**, not hunks (UX open question 2).
- **Summaries aren't cached**, and batch sizes and parallelism are fixed (`ponytail:` in
  `guides.ts`): *Regenerate* summarises everything again. Cache by `diffFingerprint` when that hurts.
- **The progress bar is approximate**: the core reports batches summarised and when grouping
  starts (`guides:progress`); between those the bar creeps on at a guessed pace (`Guide.tsx`), and
  the split between summarising and grouping (60/40) is a guess from one PR.
- **A guide from another merge base is hidden, not marked outdated**, and files changed since
  only show under *Not in the guide*.
- **Two app instances make two guides**: runs are shared per process only.
- **A file diff still loading shows its path at a guessed height**, so scrolling to a file can land a
  bit off until the ones above it have loaded (the old `ponytail:` in `App.tsx`, now smaller).

## 2026-09-24 — Viewer tabs

### What works

- **Tabs in L3:** *Overview*, *Guide* and *Diff*. A workspace opens on *Overview*: the PR's title
  and its description as Markdown (`getPullRequestOverview`). Cached in memory per workspace, so the
  tab shows at once and refreshes in the background.
  *Guide* says "Coming soon". *Diff* shows every changed file's diff one after another in one
  scroll, with the Navigator on its left, shown with the *Files N* toggle in the tab's bar; picking a changed file there scrolls to
  it, and a file picked in *Files* shows in place of the file diffs. The Diff tab stays mounted
  while another tab shows, so the file diffs and Navigator keep their state. A second bar under the tabs is there for each tab's options, empty so far.
- **The Navigator and L4 start hidden**; ⌘B (*View > Toggle Navigator*) toggles the Navigator too.
  L4's button moved from its header to the right of each tab's bar, as an *Agent* toggle like *Files*.

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
- **Asks.** *Send to agent* puts a comment in the L4 message box as a chip; several can be collected.
  On send, the core puts each comment in front of the message (file, lines, side, the code in a
  fence, the comment) and marks them sent; they then show *Sent to agent* inline.
- **Agent replies render as Markdown** in L4 (`react-markdown` + `remark-gfm`: lists, tables,
  code, links). Links open in the browser; the app window never navigates.
- **Ask agent from a comment.** The comment box has *Ask agent* (⇧⌘Enter): it saves the comment
  and starts an agent session tied to it (`agent_sessions.comment_id`, migration 6), with the
  comment as the first turn. Replies stream into the comment's thread in the Viewer, and the user
  can answer there. L4 leaves these sessions out. The Viewer now keeps showing the file while it
  rereads after a turn, instead of flashing *Loading…*. Checked in the app: an ask and a follow-up.
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
- No ETags (ADR 0006, decision 7): GitHub data refetches in full after a minute, on window focus (ADR 0017).

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
