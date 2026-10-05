# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md). Open questions are listed at the end.

## Layout

Agent-first. Opening a PR shows the project column (L1), the agent pane (L4) on the left and the canvas (L3) on the
right. The canvas is one explorer that both the agent and the human annotate; for now it shows _Changes_, the
workspace's file diffs, with the Navigator (L2) or the commits pane on its left. The top bar follows the columns: over
the left pane, its own bar (hide it, and _Changes_ · _Files_ · _Commits_ · _Turns_ to switch it); over the canvas, what the canvas
shows — the PR's chip (_#12_ with its checks' dot), _Diff_ with its range, a chip per view, a dashed _New View_ chip — then Back and Forward chevrons, a magnifier
(Open Quickly), the display options (sliders) and Activity (a pulse icon; see below). A bar at its bottom sums up the
review.

```
┌────┬─────────────────────────┬──────────────────────────────────────────┐
│    │ Fix auth · Codex [New▾] │▣ Changes|Files|Comm…│#12● Diff·All▾ [+] ∿│
│ L1 ├─────────────────────────┼─────────────────────┼────────────────────┤
│    │ [Find…] 1/4 ↑ ↓ ×       │ L2 Navigator        │ [Find…] 3/12 ↑ ↓ × │
│    │ L4 Agent pane           │                     │ L3 Canvas          │
│ P  │                         │ or Commits          │                    │
│ ── │ agent chat              │                     │ files, diffs and   │
│▌#12│                         │                     │ diagrams (the agent│
│ #34│                         │                     │ and the human      │
│ +  │ [attachments ×]         │                     │ annotate it)       │
│    │ [message box] [📎] [↑]  ├─────────────────────┴────────────────────┤
│    │                         │▾ 3 threads │ 1/2 │ +33 −0   Submit Review│
└────┴─────────────────────────┴──────────────────────────────────────────┘
          ⌘K overlays the canvas; existing diagrams stay in place
```

## Find

⌘F (Edit > Find… or the command palette) opens a Find bar under the last-used pane's header. Only one bar is
open at a time; canvas and chat remember separate queries for the window's lifetime. Enter / ⇧Enter or
⌘G / ⇧⌘G move forward and backward, wrapping at the ends. Escape or × closes Find and restores focus. Literal,
case-insensitive matching is the default, with an Aa toggle for Match Case. Matches are highlighted, the active
match more strongly, with its position and the total count beside the field.

- **Canvas:** searches all the files/file diffs in the selected range or view, in reading order, including
  files below the viewport. The bar says _Find in canvas_ and names the current match's file; with one file it
  names that file. File diffs include added and removed lines and shown context; split context counts once.
  Collapsed unchanged regions are excluded until expanded. Reviewed files hidden by the display setting are
  excluded. A whole file opened from Files or Open Quickly searches its full contents. View prose and diagrams
  are outside this initial code-search scope.
- **Agent pane:** searches the selected session's messages, code blocks, tool titles and comment/view cards.
  It excludes the unsent composer. A match in clipped card/tool text reveals the text; closing Find restores
  clipping. Streaming refreshes matches without scrolling the chat away from the selected result.

The bar shows _Searching…_ while off-screen file contents load, and reports unreadable files instead of implying
that a partial search is complete. Binary files have no searchable code. Next/Previous reveals the matching file
and line without changing the selected range, marking files Reviewed, or adding Back/Forward history entries.
Switching workspace, view, range or selected agent session clears that search's results. Scrolling and clicking
another file do not change the search scope.

## Activity

The last button in the canvas bar shows what coxswain does in the background: its jobs (glossary,
[ADR 0038](adr/0038-background-jobs-and-core-events.md)), which summarise files and conclude threads. It's a pulse
icon, a turning ring while a job runs, with a red dot when one failed since the list was last opened. Clicking it opens
the list under it, the latest 50 jobs of every workspace, newest first, kept across restarts. Each shows what it does
(_Summarising_ or _Concluding_, then _Summarised_ or _Concluded_, _Failed_ or _Stopped_), the workspace, _ahead_,
_for a view_ or _for Submit Review_, how long it took and when; a progress bar (full and red once failed); the files
or threads that had one, were done and failed; the agent, the model it ran on, runs and, for files, the range; what is
being worked on now; the last error; and Stop while it runs. Its header names the summary agent and model, with
_Settings…_; under it, _This workspace_: how many of the workspace on screen's committed file diffs have a summary at
its HEAD, with _Up to date_, _Summarising…_, _Not yet_ or _For views only_. Esc or a click outside closes it.

Settings has _File summaries_: the agent (_Claude Code_ · _Codex_), the model (a native menu of what the agent offers,
asked in the workspace on screen; greyed out without one) and _Work_: _Ahead_ or _Only when needed_.

## Before the main screen

At startup the app checks for `git`, the GitHub CLI (`gh`, signed in) and Claude Code (`claude`) on its PATH. If any
is missing, a full-window screen lists each problem with the command that fixes it, the PATH it looked on, and
_Check again_; nothing else shows until all are there. Then, with no project yet, the welcome screen.

## Levels

- **L1 — Current project and its workspaces**, a sidebar about 230 px wide; its top bar holds the macOS window
  buttons and, at its right, a panel button that hides the sidebar entirely; the same button then shows at the agent
  pane header's left (after the window buttons) to bring it back, and the command palette has _Show or Hide the
  Sidebar_. At the top, the current project: its initial, name and where it is (its GitHub owner, or the folder its repository is in). Clicking it opens a native menu of the user's projects, the current one
  checked, to switch to one; _Add Project…_ at its bottom opens the _Open a project_
  dialog over the window: a search field, _Add Local Repository…_ and _New Project…_ (native folder and save
  dialogs, [ADR 0040](adr/0040-local-repositories-and-optional-github.md)), the user's projects (initial, name, where, _Current_), then their GitHub
  repositories, most recently pushed first (owner/name, a lock if private, the description, when pushed: _3 days ago_),
  to add one. Esc, ✕ or a click outside closes it, as it does the New workspace dialog. The rest of the screen belongs to the current project. A project's
  repository must be git, cloned or local, and may be on GitHub; one that isn't has no PRs, so its New workspace
  dialog lists only branches, and its Commits pane offers Push (to `origin`, if it has one) instead of Open Pull Request….

  Below it, under _Workspaces_, one row per workspace of the project, in the order they were added, the current one
  filled: the PR's title (from GitHub; its number until it's loaded or when offline), then `#number · branch` in small
  type, and an icon for an open, draft, merged or closed PR, or a branch, with a dot under it for its agent status
  (amber: waiting on a permission, pulsing blue: working, green: done; none when idle; a row is always two lines, so the dot has room); _+ New Workspace_ at the end, and a + next to _Workspaces_ (in reach however long the list), start one. Right-clicking a workspace offers _Remove Workspace…_, which asks
  first: its comments, reviewed files and agent sessions go, its worktree stays on disk. A workspace is either a PR or a branch (ADR 0028), and has
  one worktree; a branch workspace's row shows its branch name. _New Workspace_ opens the _New workspace_
  dialog over the window, the project under its title, with one search field. It finds the repository's open PRs (by
  title, number, author or branch), each with a PR icon (grey for a draft), its title, `#number · author · branch`,
  when it was updated, and _Has a workspace_ if it does; and its branches on GitHub without an open PR (the default one
  and those with a workspace marked), where picking one works on it as it is there. What's typed that isn't a branch
  gets a row _New branch `name`_, spaces made dashes (`some improvement` → `some-improvement`), with _from_ and the
  branch it starts from (the default one; a native menu picks another) and _Create_ (or Enter, when nothing was found);
  a name git won't take is refused under the field. Opening a
  PR whose branch has a workspace makes that workspace the PR's, and so does opening a branch workspace once GitHub
  has a PR for its branch. While the project is being cloned, its initial pulses.

- **L2 — Navigator**, on the left of the canvas, under its own bar, as wide as it. Hidden at first; the panel button
  at the canvas bar's left, _View > Toggle Navigator_ or ⌘B shows it, and the same button at its bar's left hides it
  (it comes back as it was, on the Navigator, the commits or the turns). Its border can be dragged. A segmented control in its
  bar switches between _Changes N_ (N the number of changed files), the changed files as a tree with their status and
  +/− lines, _Files_, the whole file tree of the workspace, with folders that contain changes marked, _Commits_
  and _Turns_ (below). Both lists come from the worktree, so _Changes_ shows the PR's file diffs and local changes (e.g. an
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

  _Commits_ in the pane's bar shows the commits pane in the Navigator's place (one or the other): _All Changes_, then
  _Uncommitted changes_ while the worktree has any (its files and lines added and removed; picking it shows only them,
  live, as the scope _Uncommitted_), then the PR's commits (and local ones on top, marked _not pushed_), newest first, each
  on two lines: its subject (and _merge_ for a merge commit), then its short sha, author (_+N_ for co-authors), how
  long ago, and its lines added and removed. Its tooltip has the whole message, the author's email and date,
  co-authors, who committed it if someone else, and how many files it changed. Picking a commit shows its commit diff
  on the canvas. _Turns_ shows, the same way, _All Changes_ and then the agent turns that changed the worktree, newest
  first: the turn's first message over the agent that ran it (_Claude Code_, _Codex_; _Agent_ for turns from before
  that was recorded), how long ago, and its lines added and removed. Picking one shows its turn diff (glossary); the
  _Diff_ tab's range then names the commit or _Turn: …_, with ✕ back to all changes. At the top of _Commits_, how many
  commits aren't pushed, with _Push_ (confirmed; never forced) or, for a branch workspace without a PR, _Open Pull
  Request…_ (confirmed: pushes, opens a draft PR into its base branch and shows it in the browser). A push that fails
  says why there.

  **Range.** The _Diff_ tab carries what the diff shows, always, a view showing or not, so the chips after it never
  move: the scope (glossary) _All_, _PR_ (_On GitHub_ for a branch without a PR), _Not Pushed_ or _Uncommitted_, or the
  commit or turn picked. Clicking it opens a native menu: _All Changes_, then the layers that add up to it, each with
  how much it has and greyed out when it has nothing: _In the PR (3 commits)_ (_On GitHub_), _Not Pushed (2 commits)_
  and _Uncommitted (4 files)_; then _Commit…_ and _Agent Turn…_, which show the commits or the turns. Picking a scope
  shows the diff. _PR_ and _Not Pushed_ are pinned like a commit; _Uncommitted_ is live.

- **L3 — Canvas.** All file diffs of the workspace one after another, to scroll through. The display options (sliders)
  in its bar open a native menu: _Unified_ or _Split_ file diffs, _Show Reviewed Files_, and the Navigator's _Files as
  Tree_ or _Files as List_; off, reviewed file diffs are hidden, and
  when all are, the canvas says _All N files reviewed_ with _Show them_. A file diff's header has a _Reviewed_
  checkbox.

  **Go to Definition.** Holding ⌘ over a name or an import path in a file diff or a whole file underlines it;
  ⌘-click shows the file where it's defined on the canvas, scrolled to that line and with the line selected, and the
  Navigator on _Files_. The file's language server answers (ADR 0034), at the side clicked: the old side of a file diff
  asks about the base, so a result there opens that file as it was at the base. With several definitions (e.g.
  overloads), a native menu lists them (file, line and the line's code) to pick one. Right-clicking a name opens a
  native menu with _Go to Definition_ and _Find Usages_; _Find Usages_ lists every reference the language server
  finds in the same kind of menu (the first 30, then _N more_), and picking one shows it the same way. The menu shows
  even for one line, and says _No usages found_, _No definition found_ or, in a file no language server takes (so far only
  TypeScript, JavaScript and Python), _No language server for .go files_.

  **Threads.** The workspace's entries (glossary) go between the lines wherever their lines are, unchanged, in the
  range on screen, having moved with lines added above them. One outdated there (its own commit diff) says so after
  its lines. The header says _N outdated_ for the file's outdated threads that aren't, and a click shows them above
  the file diff with the code they were about (_Then_) and what stands there now (_Now_). Hovering a line shows a `+` in the gutter; clicking it (or dragging it over a range)
  opens a comment box: the lines at its top, ✕ at its top right to cancel (or Esc), the text, and at the bottom right
  a _Comment_ / _Agent_ toggle and a send button (Enter; Shift+Enter adds a line). The toggle is one global
  preference, kept across boxes and restarts. Sending starts a **thread** between the lines, and the toggle decides
  which kind for good: _Comment_ a **comment thread**, what the review says to the PR's author; _Agent_ an **agent
  thread**, for exploring or changing the code with the agent. The agent's explanations and findings start agent
  threads too. Under its comments, a reply box adds another comment to the thread. In a comment thread it has no
  toggle: a reply is a comment. In an agent thread it has its own _Comment_ / _Agent_ toggle: on _Agent_ after the
  agent's answer, explanation or finding, so a conversation carries on with Enter; otherwise the saved preference.
  Changing it there changes only that box. With a PR, a box on _Comment_ (a new comment thread, or a reply in one) has
  a _Post to GitHub_ checkbox on its left, one global preference like the toggle: on, sending posts the comment to the
  PR at once as plain discussion, no review (on its lines, or in the PR's conversation); off, it waits for _Submit Review_. A post that fails leaves the comment here and
  says why in a sheet. Each comment is labelled _You_, or _You → agent_ when it went to the agent, and the agent's
  answers _Agent_.

  In a comment thread, a comment is a note. In an agent thread, on _Comment_ it's a note for the agent, sent with the
  next question; on _Agent_ it's a question: a turn in the agent pane's agent session
  (ADR 0021), which shows it as a card (_Comment on `path:lines` sent to Agent_, the comment, and _View thread_,
  which scrolls the canvas to the thread). The agent is given what it hasn't seen of the thread: in the session its last
  question went to, the notes since; in any other (a new session since, or the other agent), the lines and the whole
  thread so far: the reply streams into the thread, with each tool used as one line, and is kept as an
  answer when the turn ends. A tool use auto mode would block stops the turn with a permission prompt in the thread:
  what the agent wants to run and the agent's options (_Yes_, _No_, sometimes _Always_); the turn carries on once one
  is picked, or ends with _Stop_. A question asked while the session's turn runs queues behind it: the thread says
  _Queued_ instead of _Working…_, and _Don't Send_ in place of _Stop_ takes it off the queue. A question taken off,
  there or with × in the agent pane, becomes a note again, so _Send to Agent_ can send it later. Stop on a thread
  stops only its own turn.

  The thread's header has a ✓ to resolve it: the thread folds to its header (_Resolved_ and its first comment), is
  left out of _Submit Review_, and the ✓, green now, reopens it. Right of it, a ⋯ button with a native menu:
  _Edit_ (the first comment, in place, if it's yours; once posted, on GitHub too), _Delete_ (the thread, after a
  confirmation; the user's comments posted from it are deleted on GitHub too), and in an agent thread _Send to Agent_,
  which makes the thread's latest note a question, with the notes before it since the last question (the answer comes
  in the thread), and _Summarize as Comment_. That one has the summary model write the review comment the thread comes
  to: _Summarizing as a comment…_ under the thread, then the comment in a box to edit, under _A new comment on these
  lines, for the review_, with _Cancel_ and _Save_; saving adds it as a comment thread on the same lines or passage. A
  failed edit, delete or summary says why under the thread.

  **Threads on a view's prose** ([ADR 0036](adr/0036-threads-on-view-prose.md)). Right-click on text selected in a
  view's prose (or on a paragraph, list or table, for all of it) and pick _Comment_: the same comment box opens after
  that block, with the passage quoted at its top and highlighted in the text. The thread stays there, the passage
  highlighted until it's resolved. If the agent rewrites the section, the thread goes outdated and moves to the top of
  the section. The threads list shows these threads under the view's title, each with its section (_§ 2_).

  **The bottom bar** has the review at a glance on the left and _Submit Review_ on the right. On the left: the thread
  toggle (a chevron, how many open threads, or _All N resolved_ once none is open, and _● N waiting_ while the agent answers one), how many of the files are
  reviewed with a progress bar (_8/29 reviewed_), and the lines added and removed. The toggle opens the threads above
  the bar: a header with _Threads_ and _Open N_ · _Resolved N_, then the threads grouped under their file, one line
  each: its lines, its first comment, and a dot with how far it got (_agent answering_, _outdated_, _N answers_, _sent
  to agent_) and its replies; one whose lines aren't in the range on screen is muted and says where it was written
  (_in All_, _in abc1234_, _in a view_) instead, then a ✓ that resolves it (under _Resolved_, green, reopens it; not while the agent
  answers). Clicking one scrolls the canvas to it.

  _Submit Review N_ (N the open comment threads; on with open comment threads or a PR) opens a dialog, like GitHub's
  _Finish your review_. Agent threads aren't in it. The comment threads, compact: a checkbox, where it is and its first
  comment (a click closes the dialog and shows the thread), how many entries it has and what posting does with it
  (_comment on the lines_, _in the review's text_, _reply_, _resolve_ or _reopen_, _on GitHub already_), and under it
  each of its comments not on GitHub yet in a box to edit, which edits the comment. With none, it says _No open comment
  threads. Agent threads become one with Summarize as Comment._ At the bottom, with a PR, a summary for the review and
  _Comment_ · _Approve_ · _Request Changes_ (not on your own PR), then three buttons. _Copy as Prompt_ puts the picked
  threads on the clipboard as the message the agent would get (the bar says _Copied_). _Send to Agent_ sends them in
  one message to the agent pane's session: where each points, the code and its comments, asking the agent to make the
  changes and answer what's open; the chat shows it as a card (_Review sent to Agent · N threads_) and the bar says
  _Agent working on N threads_ until the turn ends. _Post to GitHub…_ (only with a PR) asks, then posts the picked
  threads' comments as written, in one review; the dialog closes once posted. A thread posted on its lines is the
  thread on GitHub from then on: replies there show in it, and it resolves with GitHub's. One posted in the review's
  text is resolved here.

  **Threads from GitHub** ([ADR 0037](adr/0037-pull-request-sync-and-posting.md)). A PR's review threads show between
  the lines like any thread, their header saying _on GitHub_, each comment under its author (_@ana on GitHub_). Replies
  are the user's comments, posted as written; _Edit_ and _Delete_ are off unless the thread is the user's own,
  posted from here, and _Open on GitHub_ is in the ⋯ menu. Resolving one is local until posted. A comment posted from
  here says _posted_.

  **The PR panel.** The PR's chip in the canvas bar (_#12_, a dot for its checks: green, red, amber running, grey)
  shows the PR in the canvas in place of the diff; any other pick leaves it. It is laid out like the PR's page on
  GitHub. At the top: the title, its state, who merges what into what, _Open on GitHub_. Under it two columns, the
  side one going under the main one in a narrow canvas. The main column, from the top: the description, a card with
  _Edit_ (⌘Enter or _Save to GitHub_). _Conversation_: comments, reviews' verdicts and summaries, and comments on whole
  files, oldest first, a card each. _Checks_: the head's failing and running
  ones, each with _Details_, the rest folded under _12 passed, 3 skipped_; a failing one has _Send to Agent_, which
  sends it with the end of its log to the agent pane's session (a card in the chat); under them _Ready for Review_ (a
  draft) or the merge state and _Merge…_ (a menu of the repository's merge methods, then a confirmation). Last, _Add
  a comment_: a box and _Comment on GitHub_. The side column: _Reviewers_ with where they are, _Assignees_ with
  _Assign yourself_, _Labels_. The Commits pane shows
  each pushed commit's checks as a dot before its sha.

  **Views.** _Diff_ in the canvas's bar shows the diff without a view; it's on while no view shows. Next to it, a
  chip per view, oldest first, named by its title (_Guide_, _Data flow_; a repeated title gets a number, _Guide 2_; its
  tooltip says when it was made, its head, and _(stale)_ once the PR moved on), to switch between them. Right-clicking a
  chip offers _Remove View…_, which asks first and deletes the view with its explanations and findings; if it was
  showing, the canvas goes back to the diff. A stale view says so in a bar above it, which stays while the view
  scrolls, with _Update View_: it attaches a request to make the view again, of the code as it is now, to the agent
  pane's composer, like _New View_; the new view gets the same title and a chip of its own. The dashed
  _New View_ chip (a layers-plus icon) makes new views: its menu lists the view prompts (ADR 0031), the built-in
  ones (_Guide_, _Review_ (a guide with findings), _Questions for the author_, _Data model_, _Data flow_), then the
  user's own, then _New View…_ (a view of whatever the user types) and _New Prompt…_ (Settings, at a new prompt's title;
  saved prompts are deleted there too). While the diff shows a commit, an agent
  turn or a scope other than _All_, the menu's first line names it (_Of commit 1c8d547 (…)_, greyed out) and
  the view is of that range only, like the command palette's New View actions. Each attaches the prompt to the agent
  pane's composer as a card, which the user sends with an optional note on what to focus on; the agent pane's session makes the view with coxswain's
  tools (ADR 0023); asking for one in the agent pane's own words does the same. A view shows on the canvas as soon as
  the agent starts it, and fills in as it adds to it. While it's being written, a line above it, outside its scroll,
  says so with a spinner (_The agent is still writing this view. Read on; more may come._), its chip turns a spinner,
  and a guide's files in no section yet show under _Not yet in the guide_. The view shows its sections in order, each with its heading, how many file
  diffs it embeds and a _Reviewed_ checkbox that marks them all (ticked once all are; unticking unmarks them all), then its markdown (ADR 0026): prose, tables, mermaid diagrams, and embedded file diffs, which work
  as in the diff (threads, _Reviewed_), except that a reviewed one collapses to its header rather than hiding, so the
  prose leading into it still has it under it (_Show Reviewed Files_ expands them). Laid out to skim: a line above each section; embedded file diffs as cards; prose
  close above the diff it leads into and apart from the one before; text at most 72 characters wide, diagrams and
  tables the column's width, a diagram on its own card. A diagram that doesn't parse shows its code and the error. A
  guide goes through every file: those no section embeds come after it under _Not in the guide_. Muted file diffs
  (tool-made, tests, what the user said doesn't matter), and sections of only those, are low-lighted, with no label:
  the heading says why. On the canvas's left, a table of contents: how many embedded file diffs are
  reviewed in all with a bar, then every section with how many of its file diffs are reviewed (✓ when all are) and, if
  any, how many threads are on them, yours and the agent's (a muted speech bubble and the number). The section being read is marked as you scroll; a click jumps
  to it, and a right-click offers _Reviewed_, which marks all of the section's files as its header's box does. Explanations (labelled _Explanation_) and, with review,
  findings (labelled _Finding_) are threads between the lines, which can be replied to like any other; they show only
  with their view. A view shows the changes as they were, local ones included (pinned to a snapshot, like a
  commit), and its _Reviewed_ ticks stay; once the worktree has moved on (new commits or edits), an amber bar says so. Picking a commit hides the view, and the other way round.

- **L4 — Agent pane**, left of the canvas, always shown; its border can be dragged. A chat with one of the
  workspace's agent sessions: the current one, the one last used (made, picked in the header or sent a message),
  also after a restart. Picking one makes it current, so comments from the canvas go to the session shown. The header starts with the session's
  title (_Session N_ before its first message) and a chevron, whose native menu lists them all with their dates, then
  the session's agent, muted. At its right, a pencil button starts another agent session on the agent picked last; the
  chevron next to it picks another (_Claude Code_, _Codex_), which the session keeps. The chat shows its turns, with
  each tool the agent used as one line, and comments and reviews sent from the canvas as cards.

  The composer is one box at the bottom: _Ask Codex…_ (Enter sends, Shift+Enter adds a line; Home and End go to the start and end of the text, as in every text box; `/` lists the session's slash commands above the box, ↑↓ to pick, Tab or Enter to complete, Esc to hide), and along its bottom
  an attachment button (paperclip) on the left, the agent picks (the model ✦ and the effort, each a button with a native menu of the agent's choices, kept per agent
  for all its sessions) and a round send button, greyed out while the box and attachments are empty. While a turn runs, _Working_ and a
  round stop button take its place, and the send button comes back beside them once something is typed or attached:
  sending then queues the message. Queued messages sit on top of the box, one line each (_Queued_, the message,
  _Send now_ and ×), and run as the next turns, in order, when the running one ends (also after Stop). _Send now_
  steers: the message goes into the running turn, which carries on with it. Comments and reviews sent from the canvas
  while a turn runs queue the same way; a comment has no _Send now_, since the running turn's reply is kept as its
  own thread's answer and the comment's would never reach its thread. Commands the agent left running in the background sit on top of the box, one line
  each with a spinner, what it does and × to stop it, until they end, and so do its subagents (_Agent_ and the
  subagent's task, without ×: the turn's stop button stops them); the agent's reply when one ends shows in the chat
  like a turn. A view prompt from _New View_ sits on top of the box as a card (_View_ and its
  title, then the first lines of the prompt, all of it on a click; × takes it off); the box then asks _What to focus on (optional)…_ and Send works
  with it empty. Sent, the chat shows it as a card with the note.
  Files can be picked with the native file dialog, dropped onto the composer, or pasted (including screenshots), also while a turn runs.
  Attachments sit above the text as removable previews: thumbnails for images, names for files. Up to ten files,
  20 MB total, with images up to 5 MB each. Small UTF-8 text files are included directly; other files reference their
  original local path (shown in the tooltip as _Local file reference_), which must remain available to the agent.
  Send works with attachments alone and with a view prompt. Unsupported images show an error before sending;
  preparation and send errors retain the draft. Sent previews return when the session is reopened.
  Unsent attachments follow their workspace for the window's lifetime, like the draft. When the agent wants a tool that auto mode would block, a permission prompt
  takes the place of _Working…_ in the chat: _Agent wants to:_, the command or file, and the agent's options as
  buttons (_Yes_, _Always_, _No_); the turn waits until one is picked.

Whole-code views (#31) work even when the workspace has no changes. The agent can trace a process with prose,
diagrams and source files pinned to the view's snapshot. Source-file headers have _Reviewed_ and support the same
line comments and explanations as diffs. A file's Reviewed mark is independent of its diff and survives into another
view only if its contents match. Reviewed source files collapse under _Show Reviewed Files_ just like diffs. The table
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
3. **The review as a whole:** a comment that isn't on lines goes in the PR panel's conversation; should it be a
   thread of its own, sendable to the agent? Should the PR's description be written by the agent?
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Earlier agent sessions are reachable from the header's picker, one at a time.
5. **The local loop:** coxswain pushes and opens PRs, but doesn't commit; agents do, or the user in a terminal.
   Should it commit (with a message to write) too? Turn diffs pile up under _Turns_; should older ones fold away,
   and should the canvas say which turn a local change came from?
6. **The canvas:** what else it shows (the PR's history), and how the agent and the human switch
   between them. An annotation on lines is an entry (ADR 0023); the agent has tools to make views (ADR 0026), but not
   yet to navigate the app or read its context. Interactive views (Excalidraw and the like) are deferred.

## Continuity when navigating

- Opening and closing the command palette preserves the diagrams already drawn beneath it.
- A workspace remembers its selected agent session and unsent draft for the window's lifetime. Running turns,
  earlier messages, pending permissions and errors survive switching workspaces; the agent pane reattaches to the
  core's session state. A turn can finish while its pane is hidden.
- Picking a comment from the bottom bar or a chat card selects its view or recorded range and enables Show Reviewed
  Files before scrolling to its thread, or stays where it is if the thread is on screen there. The Reviewed mark
  stays. An outdated thread opens above its file with its code then and now, rather than leaving navigation at a
  hidden annotation.
