# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md). Open questions are listed at the end.

## Layout

Agent-first. Opening a PR shows the project column (L1), the agent pane (L4) on the left and the canvas (L3) on the
right. The canvas is one explorer that both the agent and the human annotate; for now it shows *Changes*, the
workspace's file diffs, with the Navigator (L2) or the commits pane on its left. A bar at the canvas's top holds
*Files*, *Commits*, *Guide* and the cog; a bar at its bottom sums up the review.

```
┌────┬─────────────────────────┬──────────────────────────────────────────┐
│    │ Session 2 ▾ [New session]│ Files 3  Commits  Guide              ⚙   │
│ L1 ├─────────────────────────┼─────────┬────────────────────────────────┤
│    │ L4 Agent pane           │ L2      │ L3 Canvas                      │
│ P  │                         │ Navi-   │                                │
│ ── │ agent chat              │ gator   │  file diffs, with threads      │
│▌#12│                         │ or      │  (the agent and the human      │
│ #34│                         │ Commits │   annotate it)                 │
│ +  │ [message box]           │         ├────────────────────────────────┤
│    │                         │         │ 3 threads · 1 waiting  +33 −0  │
│    │                         │         │ ▰▱ 1 of 2 reviewed  Send all   │
└────┴─────────────────────────┴─────────┴────────────────────────────────┘
          ⌘K from anywhere: switch to anything, do anything
```

## Levels

- **L1 — Current project and its workspaces.** At the top, an icon for the current project, like a
  Discord server icon. Clicking it opens the list of projects, to switch to one or add one from the
  user's GitHub repositories. The rest of the screen belongs to the current project. A project's
  repository must be git, local or cloned, and may be on GitHub.

  Below it, one icon per workspace of the project, in the order they were added, with the current
  one marked; `+` starts a new workspace. A workspace is either a PR or a local iteration, and has
  one worktree. For now `+` only offers the repository's open PRs. While the project is being cloned,
  its icon pulses.
- **L2 — Navigator**, on the left of the canvas. Hidden at first; *Files N* in the canvas's bar (N the number of
  changed files), *View > Toggle Navigator* or ⌘B shows and hides it. Its border can be dragged. A toggle in its
  header switches between *Diffs*, the changed files as a tree with their status and +/− lines, and *Files*, the
  whole file tree of the workspace, with folders that contain changes marked. Both come from the worktree, so
  *Diffs* shows the PR's file diffs and local changes (e.g. an agent's) together, and reloads after each turn. The
  top says how many of the files are reviewed; reviewed files are hidden unless *Show Reviewed Files* is on, and then
  show a ✓. A cog button opens a native menu: *As Tree* or *As List* (a flat list, each file's folder dimmed next to
  its +/− lines). A changed file with notes or questions shows how many after its +/− lines (`✎ 2`; hovering says how
  many of each). Selecting a file in *Diffs* scrolls the canvas to its file diff; selecting one in *Files* shows the
  whole file in the canvas, until the toggle goes back to *Diffs*.

  *Commits* in the canvas's bar shows the commits pane in the Navigator's place (one or the other): *All Changes*,
  then the PR's commits (and local ones on top), newest first. Picking a commit shows its commit diff on the canvas,
  and the button then names the commit.
- **L3 — Canvas.** All file diffs of the workspace one after another, to scroll through. The cog in its bar opens a
  native menu: *Unified* or *Split* file diffs, and *Show Reviewed Files*; off, reviewed file diffs are hidden, and
  when all are, the canvas says *All N files reviewed* with *Show them*. A file diff's header has a *Reviewed*
  checkbox.

  **Threads.** The workspace's entries (glossary) go between the lines while they're current, i.e. their lines still
  read as the code they were written on; the header says *N outdated* for the others, and a click shows them above
  the file diff with that code. Hovering a line shows a `+` in the gutter; clicking it (or dragging it over a range)
  opens a comment box: the lines at its top, ✕ at its top right to cancel (or Esc), the text, and at the bottom right
  a *Comment* / *Agent* toggle and a send button (Enter; Shift+Enter adds a line). The toggle is one global
  preference, kept across boxes and restarts. Sending starts a **thread** between the lines: every comment is one.
  Under its comments, a reply box adds another comment to the thread; a reply is always a note, with no toggle. Each
  comment is labelled *You*, or *You → agent* when it went to the agent, and the agent's answers *Agent*.

  On *Comment*, a comment is a note. On *Agent*, it's a question: a turn in the agent pane's agent session
  (ADR 0021), which shows it as a card (*Comment on `path:lines` sent to Claude*, the comment, and *View thread*,
  which scrolls the canvas to the thread). The agent is given the thread's notes it hasn't seen (and the lines, if
  the thread began as a note): the reply streams into the thread, with each tool used as one line, and is kept as an
  answer when the turn ends. A tool use auto mode would block stops the turn with a permission prompt in the thread:
  what the agent wants to run and the agent's options (*Yes*, *No*, sometimes *Always*); the turn carries on once one
  is picked, or ends with *Stop*. Questions run one at a time, and not while the agent pane's own turn runs.

  The thread's header has a ✓ to resolve it: the thread folds to its header (*Resolved* and its first comment), is
  left out of *Send all to agent*, and the ✓, green now, reopens it. Right of it, a ⋯ button with a native menu:
  *Edit* (the first comment, in place, if it's yours), *Delete* (the thread), and *Send to Agent*, which makes the
  thread's latest note a question, with the notes before it since the last question; the answer comes in the thread.

  **The bottom bar** sums up the review: how many threads (and how many are outdated, resolved or waiting on the
  agent), the lines added and removed, and how many of the files are reviewed, with a progress bar. Clicking the
  thread count opens every thread above the bar, one line each: file and lines, the first comment, and whether it's
  outdated, answered (*N answers*), sent to the agent, or has replies. Clicking one scrolls the canvas to it. *Send
  all to agent* sends every thread in one message to the agent pane's session: where each points, the code, and its
  comments and answers, asking the agent to make the changes and answer what's open. The chat shows it as a card
  (*Review sent to Claude · N threads*); the bar says *Agent working…* until the turn ends.

  **Guides.** *Guide* in the canvas's bar opens a native menu: *Make a Guide*, *Make a Guide with Review*, then *No
  Guide* and every guide made so far (when, its head, *(stale)* once the PR moved on). The two *Make* items put a
  message in the agent pane's composer, to edit and send; the agent pane's session makes the guide with coxswain's
  tools (ADR 0023); asking for one in the agent pane's own words does the same. A guide shows on the canvas as soon
  as the agent starts it, and fills in as it adds to it: its groups in reading order, each with its title, how many
  files and its description above its first file diff, and each file note above its file diff; then the files in no
  group under *Not in the guide*; then the *generated* groups, low-lighted. On the canvas's left, a table of
  contents: how many file diffs are reviewed in all with a bar, then every group with how many of its file diffs are
  reviewed (✓ when all are) and, if any, how many notes and questions are on them (`✎ 2`). The group being read is
  marked as you scroll; a click jumps to it, first showing reviewed file diffs if all of its are. Explanations
  (labelled *Guide*) and, with review, findings (labelled *Finding*) are threads between the lines, which can be
  replied to like any other; they show only with their guide. A guide shows the PR as it was (its range, like a
  commit), and its *Reviewed* ticks stay; once the PR has new commits, an amber bar says so. The button then reads
  *Guide · date*. Picking a commit hides the guide, and the other way round.
- **L4 — Agent pane**, left of the canvas, always shown; its border can be dragged. A chat with one of the
  workspace's agent sessions, the latest unless another is picked in the header's session picker (*Session N ·
  date*): its turns, with each tool the agent used as one line, comments and reviews sent from the canvas as cards,
  and a message box at the bottom (Enter sends, Shift+Enter adds a line). *New session* in the header starts another
  agent session. A running turn can be stopped. When the agent wants a tool that auto mode would block, a permission
  prompt takes the place of *Working…*: *Claude Code wants to:*, the command or file, and the agent's options as
  buttons (*Yes*, *Always*, *No*); the turn waits until one is picked.

## Across all levels

- The borders of the agent pane and the Navigator can be dragged to resize them; the canvas takes the rest.
- **⌘K** is always available, both to switch to anything (project, workspace, PR, file,
  agent session) and to run any command.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4's picker in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Guides:** should a guide group down to hunks, not whole file diffs? Should a group get its own *Reviewed* again?
   Does the agent pane need to show that a guide is being made?
3. **The review as a whole:** where do you write a comment that isn't on lines? *Post* is still open. Should the PR's
   GitHub comments and reviews show in coxswain, and where?
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Earlier agent sessions are reachable from the header's picker, one at a time. Comments still go to the latest
   session, not the one shown.
5. **PR changes vs local changes:** *Diffs* mixes the PR's file diffs with local changes (uncommitted,
   untracked, unpushed), so an agent's work isn't told apart from the PR's. Options: a marker per
   file, a third toggle (*Local*), or showing local changes on top of the PR's head separately.
6. **The canvas:** what it shows besides file diffs (the PR's description and history, a whole file, something the agent
   makes), and how the agent and the human switch between them. An annotation on lines is an entry (ADR 0023); the
   agent has tools to make guides, but not yet to navigate the app or read its context.
