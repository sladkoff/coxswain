# coxswain — devlog

Where the build stands and what we owe. Newest entry first. Terms are defined in
[the glossary](context/coxswain.md); decisions are in [the ADRs](adr/).

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
  blocked until L4 shows permission prompts (`--permission-prompt-tool`).
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
