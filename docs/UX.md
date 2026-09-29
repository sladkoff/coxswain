# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md). Open questions are listed at the end.

## Layout

Agent-first. Opening a PR shows the project column (L1), the agent pane (L4) on the left and the canvas (L3) on the
right. The canvas is one explorer that both the agent and the human annotate; for now it shows _Changes_, the
workspace's file diffs, with the Navigator (L2) or the commits pane on its left. The top bar follows the columns: over
the left pane, its own bar (hide it, and _Changes_ · _Files_ · _Commits_ to switch it); over the canvas, what the canvas
shows — _Diff_ with its range, a chip per view, a dashed _New View_ chip — then Back and Forward chevrons, a magnifier
(Open Quickly), the display options (sliders) and Activity (a pulse icon; see below). A bar at its bottom sums up the
review.

```
┌────┬─────────────────────────┬──────────────────────────────────────────┐
│    │ Fix auth · Codex [New▾] │▣ Changes|Files|Comm…│Diff·All▾ Guide[+]⚌∿│
│ L1 ├─────────────────────────┼─────────────────────┼────────────────────┤
│    │ L4 Agent pane           │ L2 Navigator        │ L3 Canvas          │
│ P  │                         │ or Commits          │                    │
│ ── │ agent chat              │                     │ files, diffs and   │
│▌#12│                         │                     │ diagrams (the agent│
│ #34│                         │                     │ and the human      │
│ +  │ [message box]           │                     │ annotate it)       │
│    │                         ├─────────────────────┴────────────────────┤
│    │                         │▾ 3 threads ●1 │ ▰▱ 1/2 │ +33 −0 Hand off▾│
└────┴─────────────────────────┴──────────────────────────────────────────┘
          ⌘K overlays the canvas; existing diagrams stay in place
```

## Activity

The last button in the canvas bar shows what coxswain does in the background: for now summary jobs (glossary,
[ADR 0029](adr/0029-file-summaries-and-activity.md)). It's a pulse icon, a turning ring while a job runs, with a red
dot when one failed since the list was last opened. Clicking it opens the list under it, the latest 50 jobs of every workspace, newest first, kept across restarts. Each shows _Summarising_, _Summarised_, _Failed_ or _Stopped_, the workspace, _ahead_ or _for a view_, how long it took
and when; a progress bar (full and red once failed); files that had a summary, were summarised and failed; the agent,
the model it ran on, runs and range; the files being summarised now; the last error; and Stop while it runs. Its header
names the summary agent and model, with _Settings…_; under it, _This workspace_: how many of the workspace on screen's
committed file diffs have a summary at its HEAD, with _Up to date_, _Summarising…_, _Not yet_ or _For views only_. Esc or a click outside closes it.

Settings has _File summaries_: the agent (_Claude Code_ · _Codex_), the model (a native menu of what the agent offers,
asked in the workspace on screen; greyed out without one) and _Summarise_: _Ahead_ or _Only for views_.

## Before the main screen

At startup the app checks for `git`, the GitHub CLI (`gh`, signed in) and Claude Code (`claude`) on its PATH. If any
is missing, a full-window screen lists each problem with the command that fixes it, the PATH it looked on, and
_Check again_; nothing else shows until all are there. Then, with no project yet, the welcome screen.

## Levels

- **L1 — Current project and its workspaces**, a sidebar about 230 px wide; its top bar holds the macOS window
  buttons and, at its right, a panel button that hides the sidebar entirely; the same button then shows at the agent
  pane header's left (after the window buttons) to bring it back, and the command palette has _Show or Hide the
  Sidebar_. At the top, the current project: its initial, name and owner. Clicking it opens a native menu of the user's projects, the current one
  checked, to switch to one; _Add Project…_ at its bottom opens the _Open a project_
  dialog over the window: a search field, the user's projects (initial, name, owner, _Current_), then their GitHub
  repositories, most recently pushed first (owner/name, a lock if private, the description, when pushed: _3 days ago_),
  to add one. Esc, ✕ or a click outside closes it, as it does the New workspace dialog. The rest of the screen belongs to the current project. A project's
  repository must be git, local or cloned, and may be on GitHub.

  Below it, under _Workspaces_, one row per workspace of the project, in the order they were added, the current one
  filled: the PR's title (from GitHub; its number until it's loaded or when offline), then `#number · branch` in small
  type, and an icon for an open, draft, merged or closed PR, or a branch; _+ New Workspace_ at the end, and a + next to _Workspaces_ (in reach however long the list), start one. Right-clicking a workspace offers _Remove Workspace…_, which asks
  first: its comments, reviewed files and agent sessions go, its worktree stays on disk. A workspace is either a PR or a branch (ADR 0028), and has
  one worktree; a branch workspace's row shows its branch name. _New Workspace_ opens the _New workspace_
  dialog over the window, the project under its title, with two tabs. _Pull request_: a search field (title, number,
  author, branch) and the repository's open PRs, each with a PR icon (grey for a draft), its title, `#number · author ·
branch`, when it was updated, and _Has a workspace_ if it does. _Branch_: one field for the branch's name, which
  filters the repository's branches on GitHub (the default one and those with a workspace marked); picking one works on
  it as it is there. A name that isn't one of them gets a row _New branch `name`_ with _from_ and the branch it starts
  from (the default one; a native menu picks another) and _Create_ (or Enter); a name git won't take is refused under
  the field. Opening a
  PR whose branch has a workspace makes that workspace the PR's, and so does opening a branch workspace once GitHub
  has a PR for its branch. While the project is being cloned, its initial pulses.

- **L2 — Navigator**, on the left of the canvas, under its own bar, as wide as it. Hidden at first; the panel button
  at the canvas bar's left, _View > Toggle Navigator_ or ⌘B shows it, and the same button at its bar's left hides it
  (it comes back as it was, on the Navigator or the commits pane). Its border can be dragged. A segmented control in its
  bar switches between _Changes N_ (N the number of changed files), the changed files as a tree with their status and
  +/− lines, _Files_, the whole file tree of the workspace, with folders that contain changes marked, and _Commits_
  (below). Both lists come from the worktree, so _Changes_ shows the PR's file diffs and local changes (e.g. an
  agent's) together, a file with local changes marked with an amber ● after its +/− lines, and reloads after each
  turn. Reviewed files are hidden unless _Show Reviewed Files_ is on, and then show a ✓; the bottom bar counts them.
  The display options list _Files as Tree_ or _Files as List_ (a flat list, each file's folder dimmed next to its +/−
  lines). A changed file with threads (yours, and the agent's while its view shows) shows a speech bubble after its +/−
  lines (hovering says how many of each kind). Selecting a file in _Changes_ scrolls the canvas to its file diff; selecting one in _Files_ shows the whole
  file in the canvas, until the control goes back to _Changes_.

  _View > Command Palette…_ (⌘K) opens the command palette over the window, starting with `>`: typing after the `>`
  finds an action by name (fuzzy, best match first, its shortcut on the right), ↑/↓ pick, Enter runs it. Without the
  `>` it finds files: _File > Open Quickly…_ (⌘⇧O), or the magnifier left of the canvas bar's display options, opens it that way.
  Typing filters the worktree's files by path (fuzzy: a match in the file name, then elsewhere, then its letters in
  order), and Enter opens the file in the canvas and shows the Navigator on _Files_, with the file selected and its
  folders open. Esc or a click outside closes it. Actions it lists: Back and Forward, show or hide the Navigator and Commits,
  show the diff or a view, each New View, Unified or Split diffs, show or hide reviewed files, open a workspace, New
  Workspace, switch project, Add Project, Settings. Actions that can't run now (Back at the start) aren't listed.

  _View > Back_ (⌥⌘←) and _View > Forward_ (⌥⌘→), or the chevrons in the canvas bar, step through what the canvas
  showed (ADR 0025): each whole file opened (from _Files_, Open Quickly, Go to Definition or Find Usages), each file
  picked in _Changes_, each switch between _Changes_ and _Files_, each commit or view picked, and each workspace opened;
  Back into another workspace's step opens that workspace again. Picking a workspace in the sidebar restores its
  last canvas selection and scroll, with one loading state for an uncached destination. Reviewed files do not briefly
  appear before the review state loads. Each step comes back scrolled where it was left, the
  file diffs by the one at the top. The keys work wherever the focus is, the Navigator included; the menu items and
  chevrons are greyed out at either end.

  _Commits_ in the pane's bar shows the commits pane in the Navigator's place (one or the other): _All Changes_,
  then, if any agent turn changed the worktree, _Agent turns_ (when, and the turn's first message) and _Commits_: the
  PR's commits (and local ones on top, marked _local_), newest first. Picking a commit shows its commit diff on the
  canvas, and picking a turn its turn diff (glossary); the _Diff_ tab's range then names the commit or _Turn: …_, with ✕
  back to all changes. At the top, how
  many commits aren't pushed, with _Push_ (confirmed; never forced) or, for a branch workspace without a PR, _Open Pull
  Request…_ (confirmed: pushes, opens a draft PR into its base branch and shows it in the browser). A push that fails
  says why there.

  **Range.** The _Diff_ tab carries what the diff shows, always, a view showing or not, so the chips after it never
  move: the scope (glossary) _All_, _PR_ (_Pushed_ for a branch without a PR) or _Local_, or the commit or turn picked.
  Clicking it opens a native menu: _All Changes_, _The PR's Changes_ (_Pushed Changes_), _Local Changes_, and _Commit
  or Agent Turn…_, which shows the commits pane. Picking a scope shows the diff. _PR_ is pinned like a commit; _Local_
  is live.

- **L3 — Canvas.** All file diffs of the workspace one after another, to scroll through. The display options (sliders)
  in its bar open a native menu: _Unified_ or _Split_ file diffs, _Show Reviewed Files_, and the Navigator's _Files as
  Tree_ or _Files as List_; off, reviewed file diffs are hidden, and
  when all are, the canvas says _All N files reviewed_ with _Show them_. A file diff's header has a _Reviewed_
  checkbox.

  **Go to Definition.** Holding ⌘ over a name or a relative import path in a file diff or a whole file underlines it;
  ⌘-click shows the file where it's defined on the canvas, scrolled to that line and with the line selected, and the
  Navigator on _Files_. With several matches, a native menu lists them (file, line and the line's code) to pick one.
  Right-clicking a name opens a native menu with _Go to Definition_ and _Find Usages_; _Find Usages_ lists every line
  of the worktree with that name as a whole word in the same kind of menu (the first 30, then _N more_), and picking
  one shows it the same way. The menu shows even for one line, and says _No usages found_ or _No definition found_
  when there are none.

  **Threads.** The workspace's entries (glossary) go between the lines while they're current, i.e. their lines still
  read as the code they were written on; the header says _N outdated_ for the others, and a click shows them above
  the file diff with that code. Hovering a line shows a `+` in the gutter; clicking it (or dragging it over a range)
  opens a comment box: the lines at its top, ✕ at its top right to cancel (or Esc), the text, and at the bottom right
  a _Comment_ / _Agent_ toggle and a send button (Enter; Shift+Enter adds a line). The toggle is one global
  preference, kept across boxes and restarts. Sending starts a **thread** between the lines: every comment is one.
  Under its comments, a reply box adds another comment to the thread; a reply is always a note, with no toggle. Each
  comment is labelled _You_, or _You → agent_ when it went to the agent, and the agent's answers _Agent_.

  On _Comment_, a comment is a note. On _Agent_, it's a question: a turn in the agent pane's agent session
  (ADR 0021), which shows it as a card (_Comment on `path:lines` sent to Agent_, the comment, and _View thread_,
  which scrolls the canvas to the thread). The agent is given the thread's notes it hasn't seen (and the lines, if
  the thread began as a note): the reply streams into the thread, with each tool used as one line, and is kept as an
  answer when the turn ends. A tool use auto mode would block stops the turn with a permission prompt in the thread:
  what the agent wants to run and the agent's options (_Yes_, _No_, sometimes _Always_); the turn carries on once one
  is picked, or ends with _Stop_. Questions run one at a time, and not while the agent pane's own turn runs.

  The thread's header has a ✓ to resolve it: the thread folds to its header (_Resolved_ and its first comment), is
  left out of _Hand off_, and the ✓, green now, reopens it. Right of it, a ⋯ button with a native menu:
  _Edit_ (the first comment, in place, if it's yours), _Delete_ (the thread, after a confirmation), and _Send to Agent_, which makes the
  thread's latest note a question, with the notes before it since the last question; the answer comes in the thread.

  **The bottom bar** has the review at a glance on the left and _Hand off_ on the right. On the left: the thread
  toggle (a chevron, how many threads, and _● N waiting_ while the agent answers one), how many of the files are
  reviewed with a progress bar (_8/29 reviewed_), and the lines added and removed. The toggle opens the threads above
  the bar: a header with _Threads_ and _Open N_ · _Resolved N_, then the threads grouped under their file, one line
  each: its lines, its first comment, and a dot with how far it got (_agent answering_, _outdated_, _N answers_, _sent
  to agent_) and its replies. Clicking one scrolls the canvas to it.

  _Hand off N_ (N the open threads it takes: not resolved, and the agent's explanations and findings only once the user
  replied) opens a native menu: _Send to Agent_ sends them in one message to the agent pane's session: where each
  points, the code, and its comments and answers, asking the agent to make the changes and answer what's open. The
  chat shows it as a card (_Review sent to Agent · N threads_); the bar says _Agent working on N threads_ until the turn
  ends. _Copy as Prompt_ puts the same message on the clipboard instead (the bar says _Copied_). _Send to GitHub as a
  Review…_ is shown greyed out until it's built.

  **Views.** _Diff_ in the canvas's bar shows the diff without a view; it's on while no view shows. Next to it, a
  chip per view, oldest first, named by its title (_Guide_, _Data flow_; a repeated title gets a number, _Guide 2_; its
  tooltip says when it was made, its head, and _(stale)_ once the PR moved on), to switch between them. Right-clicking a
  chip offers _Remove View…_, which asks first and deletes the view with its explanations and findings; if it was
  showing, the canvas goes back to the diff. The dashed
  _New View_ chip (a layers-plus icon) makes new views: its menu lists the view prompts (ADR 0031), the built-in
  ones (_Guide_, _Review_ (a guide with findings), _Questions for the author_, _Data model_, _Data flow_), then the
  user's own, then _New View…_ (a view of whatever the user types) and _New Prompt…_ (Settings, at a new prompt's title;
  saved prompts are deleted there too). While the diff shows a commit, an agent
  turn or the _PR_/_Pushed_ or _Local_ scope, the menu's first line names it (_Of commit 1c8d547 (…)_, greyed out) and
  the view is of that range only, like the command palette's New View actions. Each attaches the prompt to the agent
  pane's composer as a card, which the user sends with an optional note on what to focus on; the agent pane's session makes the view with coxswain's
  tools (ADR 0023); asking for one in the agent pane's own words does the same. A view shows on the canvas as soon as
  the agent starts it, and fills in as it adds to it. While it's being written, a line above it, outside its scroll,
  says so with a spinner (_The agent is still writing this view. Read on; more may come._), its chip turns a spinner,
  and a guide's files in no section yet show under _Not yet in the guide_. The view shows its sections in order, each with its heading and how many file
  diffs it embeds, then its markdown (ADR 0026): prose, tables, mermaid diagrams, and embedded file diffs, which work
  as in the diff (threads, _Reviewed_). Laid out to skim: a line above each section; embedded file diffs as cards; prose
  close above the diff it leads into and apart from the one before; text at most 72 characters wide, diagrams and
  tables the column's width, a diagram on its own card. A diagram that doesn't parse shows its code and the error. A
  guide goes through every file: those no section embeds come after it under _Not in the guide_. Muted file diffs
  (tool-made, tests, what the user said doesn't matter), and sections of only those, are low-lighted, with no label:
  the heading says why. On the canvas's left, a table of contents: how many embedded file diffs are
  reviewed in all with a bar, then every section with how many of its file diffs are reviewed (✓ when all are) and, if
  any, how many threads are on them, yours and the agent's (a muted speech bubble and the number). The section being read is marked as you scroll; a click jumps
  to it, first showing reviewed file diffs if all of its are. Explanations (labelled _Explanation_) and, with review,
  findings (labelled _Finding_) are threads between the lines, which can be replied to like any other; they show only
  with their view. A view shows the changes as they were, local ones included (pinned to a snapshot, like a
  commit), and its _Reviewed_ ticks stay; once the worktree has moved on (new commits or edits), an amber bar says so. Picking a commit hides the view, and the other way round.

- **L4 — Agent pane**, left of the canvas, always shown; its border can be dragged. A chat with one of the
  workspace's agent sessions, the latest unless another is picked in the header. The header starts with the session's
  title (_Session N_ before its first message) and a chevron, whose native menu lists them all with their dates, then
  the session's agent, muted. At its right, a pencil button starts another agent session on the agent picked last; the
  chevron next to it picks another (_Claude Code_, _Codex_), which the session keeps. The chat shows its turns, with
  each tool the agent used as one line, and comments and reviews sent from the canvas as cards.

  The composer is one box at the bottom: _Ask Codex…_ (Enter sends, Shift+Enter adds a line), and along its bottom
  the agent picks (the model ✦ and the effort, each a button with a native menu of the agent's choices, kept per agent
  for all its sessions) and a round send button, greyed out while the box is empty. While a turn runs, _Working_ and a
  round stop button take its place. Commands the agent left running in the background sit on top of the box, one line
  each with a spinner, what it does and × to stop it, until they end, and so do its subagents (_Agent_ and the
  subagent's task, without ×: the turn's stop button stops them); the agent's reply when one ends shows in the chat
  like a turn. A view prompt from _New View_ sits on top of the box as a card (_View_ and its
  title, then the first lines of the prompt, all of it on a click; × takes it off); the box then asks _What to focus on (optional)…_ and Send works
  with it empty. Sent, the chat shows it as a card with the note. When the agent wants a tool that auto mode would block, a permission prompt
  takes the place of _Working…_ in the chat: _Agent wants to:_, the command or file, and the agent's options as
  buttons (_Yes_, _Always_, _No_); the turn waits until one is picked.

Whole-code views (#31) work even when the workspace has no changes. The agent can trace a process with prose,
diagrams and source files pinned to the view's snapshot. Source-file headers have _Reviewed_ and support the same
line comments and explanations as diffs. A file's Reviewed mark is independent of its diff and survives into another
view only if its contents match. Reviewed source files hide under _Show Reviewed Files_ just like diffs. The table
of contents and bottom bar count the files and diffs in the view; the Navigator still represents the range's changes.
A prose-only view has no reviewable files. An empty view says _Nothing in this view yet_.

## Across all levels

- The borders of the agent pane and the Navigator can be dragged to resize them; the canvas takes the rest.
- **⌘K** is always available on the main screen, both to switch to anything (project, workspace, file; PRs not yet
  opened and agent sessions still to come) and to run any action.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4's picker in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Views:** should a view embed only some lines of a file diff, not the whole of it? Should a section get its own
   _Reviewed_? Does the agent pane need to show that a view is being made? Should the agent see the view as drawn
   (a screenshot), not only whether its diagrams draw?
3. **The review as a whole:** where do you write a comment that isn't on lines? _Post_ is still open. Should the PR's
   GitHub comments and reviews show in coxswain, and where?
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Earlier agent sessions are reachable from the header's picker, one at a time. Comments still go to the latest
   session, not the one shown.
5. **The local loop:** coxswain pushes and opens PRs, but doesn't commit; agents do, or the user in a terminal.
   Should it commit (with a message to write) too? Turn diffs pile up under _Agent turns_; should older ones fold away,
   and should the canvas say which turn a local change came from?
6. **The canvas:** what else it shows (the PR's description and history), and how the agent and the human switch
   between them. An annotation on lines is an entry (ADR 0023); the agent has tools to make views (ADR 0026), but not
   yet to navigate the app or read its context. Interactive views (Excalidraw and the like) are deferred.

## Continuity when navigating

- Opening and closing the command palette preserves the diagrams already drawn beneath it.
- A workspace remembers its selected agent session and unsent draft for the window's lifetime. Running turns,
  earlier messages, pending permissions and errors survive switching workspaces; the agent pane reattaches to the
  core's session state. A turn can finish while its pane is hidden.
- Picking a comment from the bottom bar or a chat card selects its view or recorded range and enables Show Reviewed
  Files before scrolling to its thread. The Reviewed mark stays. An outdated thread opens above its file with the
  original code, rather than leaving navigation at a hidden annotation.
