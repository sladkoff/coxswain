# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md).

Draft: only the main areas so far. Open questions are listed at the end.

## Layout

**Moving to an agent-first layout (prototype, 2026-09-26).** Opening a PR shows the agent pane on
the left and the canvas on the right. The canvas is one explorer that both the agent and the human
can annotate; what it can show is still to be decided. The agent will get tools to use the app
(navigate the canvas, read what's on it). The canvas shows *Changes*: the file diffs (the old *Diff* tab) with the Navigator, and a bar at its top with
their options. A row of tabs comes back once it shows a second thing. A bar at the bottom of
the canvas sums up the review: how many threads (and how many are outdated, resolved or waiting on the agent), the lines added
and removed, and how many of the files are reviewed, with a progress bar. Clicking the thread count opens every thread above
the bar, one line each: file and lines, the first comment, and whether it's outdated, answered (*N answers*), sent to
the agent, or has replies. Clicking one scrolls the canvas to it. *Send all to agent* on the bar sends every thread in one message to
the agent pane's session: where each points, the code, and its comments and answers, asking the agent to make the
changes and answer what's open. The chat shows it as a card (*Review sent to Claude · N threads*); the bar says
*Agent working…* until the turn ends.

*Guide*, next to *Commits* in the canvas's bar, opens a native menu: *Make a Guide*, *Make a Guide with Review*,
then *No Guide* and every guide made so far (when, its head, *(stale)* once the PR moved on). The two *Make* items
put a message in the agent pane's composer, to edit and send; the agent pane's session makes the guide with coxswain's tools (ADR 0023); asking for one in
the agent pane's own words does the same. A guide shows in *Changes* as soon as the agent starts it, and fills in as it
adds to it: its groups in reading order, each with its title, how many files and its description above its first file
diff, and each file note above its file diff; then the files in no group under *Not in the guide*; then the
*generated* groups, low-lighted. On the canvas's left, a table of contents: how many file diffs are reviewed in all
with a bar, then every group with how many of its file diffs are reviewed (✓ when all are) and, if any, how many notes
and questions are on them (`✎ 2`). The group being read is marked as you scroll; a click jumps to it, first showing
reviewed file diffs if all of its are. Explanations (labelled *Guide*) and, with review, findings (labelled *Finding*) are
threads between the lines, which can be replied to like any other; they show only with their guide. A guide shows
the PR as it was (its range, like a commit), and its *Reviewed* ticks stay; once the PR has new commits, an amber bar
says so. The button then reads *Guide · date*. Picking a commit hides the guide, and the other way round.

The *Overview* tab is gone, so the timeline can't be reached; the L3 and L4 notes below describe the old layout until
this settles.

```
┌──────────────────────────────┬──────────────────────────────────────────┐
│ Session 2 ▾    [New session] │ [Changes]                                │
├────┬─────────────────────────┼──────────────────────────────────────────┤
│    │                         │ Files 3  Commits                     ⚙   │
│    │                         ├──────────────────────────────────────────┤
│ L1 │ Agent pane              │ Canvas                                   │
│    │                         │                                          │
│ P  │ agent chat              │  file diffs, with notes and questions    │
│ ── │                         │  (the agent and the human annotate it)   │
│▌#12│                         │                                          │
│ #34│                         │                                          │
│ +  │ [message box]           ├──────────────────────────────────────────┤
│    │                         │ 3 threads · 1 waiting   +33 −0  ▰▱ 1 of 2 │
└────┴─────────────────────────┴──────────────────────────────────────────┘
          ⌘K from anywhere: switch to anything, do anything
```

## Levels

- **L1 — Current project and its workspaces.** At the top, an icon for the current project, like a
  Discord server icon. Clicking it opens the list of projects, to switch to one or add one from the
  user's GitHub repositories. The rest of the screen belongs to the current project. A project's
  repository must be git, local or cloned, and may be on GitHub.

  Below it, one icon per workspace of the project, in the order they were added, with the current
  one marked; `+` starts a new workspace. A workspace is either a PR or a local iteration, and has
  one worktree. For now `+` only offers the repository's open PRs.
- **L2 — Navigator**, on the left of L3's *Diff* tab. Hidden at first; the *Files N* toggle in the
  tab's bar (N the number of changed files), *View > Toggle Navigator* or ⌘B shows and hides it.
  Its border can be dragged. A toggle in its header switches between *Diffs*, the current workspace's changed
  files as a tree with their status and +/− lines, and *Files*, the whole file tree of the
  workspace, with folders that contain changes marked. Both come from the worktree, so *Diffs* shows
  the PR's file diffs and local changes (e.g. an agent's) together, and reloads after each turn.
  While the project is being cloned, its icon pulses and the Navigator says so. In *Diffs*, reviewed
  files are hidden; the top says how many of the files are reviewed, and a cog button opens a native
  menu: *As Tree* or *As List* (a flat list of the changed files, each with its folder dimmed
  next to its +/− lines). A changed file with notes or questions shows how many
  after its +/− lines (`✎ 2`; hovering says how many of each). *Show Reviewed Files* in the tab bar's cog menu (L3) shows reviewed files again
  with a ✓.
- **L3 — Viewer.** Tabs along the top: *Overview* (the PR's title and its timeline, the tab a
  workspace opens on), *Guide* and *Diff*, all file diffs side by side one after
  another, with the Navigator on their left. Selecting a file in *Diffs* scrolls to its file diff;
  selecting one in *Files* shows the whole file in their place, until the toggle goes back to *Diffs*. Under the tabs, a second bar
  that stays put holds the current tab's options. On *Diff*, next to *Files*, *Commits* shows and
  hides the commits pane, in the Navigator's place on the left: *All Changes*, then the PR's commits (and local ones on
  top), newest first. Picking a commit shows its commit diff in the file diffs (and in the Navigator once it's back), and the button then
  names the commit; the Guide keeps all changes. On *Guide* and *Diff* it has a cog button that
  opens a native menu: *Unified* or *Split* file diffs, and *Show Reviewed Files*, shared by the
  Navigator, the file diffs and the Guide: off, reviewed file diffs are hidden, and when all are, the canvas says *All N
  files reviewed* with *Show them*. A file diff's header has a
  *Reviewed* checkbox. The workspace's entries (glossary) go between the lines while
  they're current, i.e. their lines still read as the code they were written on; the header says *N
  outdated* for the others, and a click shows them above the file diff with that code. Hovering
  a line shows a `+` in the gutter; clicking it (or dragging it over a range) opens a comment box: the lines at its top, ✕ at its top right
  to cancel (or Esc), the text, and at the bottom right a *Comment* / *Agent* toggle and a send button (Enter; Shift+Enter
  adds a line). The toggle is one global preference, kept across boxes and restarts. Sending starts a **thread** between the lines: every comment is one. Under
  its comments, a reply box adds another comment to the thread; a reply is always a note, with no toggle. Each comment is labelled *You*, or *You → agent* when it went to the agent, and
  the agent's answers *Agent*. On *Comment*, a comment is a note. On *Agent*, it's a question: a turn in the agent pane's
  agent session (ADR 0021), which shows it as a card (*Comment on `path:lines` sent to Claude*, the comment, and
  *View thread*, which scrolls the canvas to the thread). The agent is given the thread's notes it hasn't seen (and the lines, if the
  thread began as a note): the reply streams into the thread, with each tool used as one line, and is kept as an
  answer when the turn ends. A tool use that would
  change something (a file edit, most shell commands) stops the turn with a permission prompt in the
  thread: what the agent wants to run and the agent's options (*Yes*, *No*, sometimes *Always*); the
  turn carries on once one is picked, or ends with *Stop*. Questions
  run one at a time, and not while the agent pane's own turn runs. The thread's header has a ✓ to resolve it: the thread folds to its
  header (*Resolved* and its first comment), is left out of *Send all to agent*, and the ✓, green now, reopens it. Right of it, a ⋯ button with a native
  menu: *Edit* (the first comment, in place, if it's yours), *Delete* (the thread), and *Send to Agent*, which makes the
  thread's latest note a question, with the notes before it since the last question; the answer comes in the thread.

  *Guide* was a tab of its own; guides now show in *Changes* (above).
  *Overview* shows the PR's title, author and when it was opened, then its **timeline**, newest first: the latest phase on top, and in each phase the latest event on top. Each
  phase starts with a header: *PR created*, *N new commits* or *Rebased*, when coxswain saw it, and its head commit.
  Under it, what it covers (*N files · +A −D · N commits*, the commits' subjects in a disclosure), then its change
  summary, a paragraph or two of prose on what the change sets out to do and why, which model wrote it, and
  *Regenerate*; *Summarising…* while it's made. The first
  phase also has the PR's description, folded. Then the phase's events, one line each, with the time: a note or
  question, with where it points and its text, its replies and answers folded under it; a GitHub comment or review, with its author, state (*approved*, *changes
  requested*, *commented*), text and how many review comments it has, linking to GitHub; and the PR being merged,
  closed, reopened, marked ready or draft, or force-pushed. The phase the PR is on now is marked *current*. If
  GitHub can't be reached, a line at the top says so and the timeline shows only what coxswain has.

  ```
  Add user stats and user management helpers  #1
  sladkoff opened this on 26 Sep
  ┃
  ● 2 new commits · 26 Sep 12:10                                d4e5f6a  current
  ┃  ...
  ● PR created · 26 Sep 10:36                                   a1b2c3d
  ┃  2 files · +34 −0 · 1 commit ▸
  ┃  This PR adds stats helpers (averages, top users, lookup by name,
  ┃  pagination) and helpers to delete and update users. Neither the
  ┃  description nor the commit says why they're needed.
  ┃  claude-haiku-4-5 · Regenerate
  ┃  Description ▸
  ┃  ○ 11:02  alice reviewed · changes requested · 3 comments  "..."
  ┃  ○ 10:42  Note · src/users.py:8       drop this helper
  ┃  ○ 10:40  Question · src/stats.py:4   what is this?     Answer ▸
  ```

- **L4 — Agents** on the right: the agent sessions of the current workspace. Hidden at first. The *Agent* toggle at the right of
  each tab's bar, *View > Toggle Agents* or ⌥⌘B shows and hides it. *Send to agent* shows it. Several can be open at
  once, e.g. as tabs in the pane. For now L4 is a chat with one agent session, the workspace's latest unless another is
  picked in the header's session picker (*Session N · date*):
  its turns, with each tool the agent used as one line, and a message box at the bottom (Enter
  sends, Shift+Enter adds a line). *New session* in the header starts another agent session with
  the next message; a running turn can be stopped. When the agent wants a tool that auto mode would block, a
  permission prompt takes the place of *Working…*: *Claude Code wants to:*, the command or file, and the agent's
  options as buttons (*Yes*, *Always*, *No*); the turn waits until one is picked.

## Across all levels

- The borders of the agent pane and the Navigator can be dragged to resize them; the canvas takes the rest.
- **⌘K** is always available, both to switch to anything (project, workspace, PR, file,
  agent session) and to run any command.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4 in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Guides:** should a guide group down to hunks, not whole file diffs? Should a group get its own *Reviewed* again?
   Does the agent pane need to show that a guide is being made?
3. **The review as a whole:** where do you write a comment that isn't on lines? *Post* is still open. GitHub's comments
   show on the timeline (ADR 0020); should review comments also show in the diff?
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Earlier agent sessions are reachable from the header's picker, one at a time. Comments still go to the latest
   session, not the one shown.
5. **PR changes vs local changes:** *Diffs* mixes the PR's file diffs with local changes (uncommitted,
   untracked, unpushed), so an agent's work isn't told apart from the PR's. Options: a marker per
   file, a third toggle (*Local*), or showing local changes on top of the PR's head separately.
6. **The timeline:** What else
   makes a summary again (new review activity), and should a phase get a recap of its events,
   not just of its code? Should bot comments (CI, Linear) be folded or hidden? Where do agent sessions go on
   it?
7. **The canvas:** what it shows besides file diffs (the timeline, a guide, a whole file, something the agent
   makes), and how the agent and the human switch between them. An annotation on lines is an entry (ADR 0023); the
   agent has tools to make guides, but not yet to navigate the app or read its context.
