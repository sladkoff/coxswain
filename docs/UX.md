# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md).

Draft: only the main areas so far. Open questions are listed at the end.

## Layout

A Discord-style layout: the current project and its workspaces in a narrow column on the far left,
then the workspace's files, the work in the middle and the agents on the right.

```
┌─────────────────────┬─────────────────────────────────┬──────────────────┐
│                     │ Overview  Guide  Diff           │ [agent] [agent]  │
├────┬────────────────┤─────────────────────────────────┤──────────────────┤
│ L1 │ L2 Navigator   │ L3 Viewer                       │ L4               │
│    │ Diffs │ Files  │                                 │                  │
│ P  │                │  diff or file,                  │ agent chat       │
│ ── │ src/           │  with notes and questions       │                  │
│▌#12│   a.ts   +3    │                                 │ several agent    │
│ #34│   b.ts   -1    │                                 │ sessions         │
│ +  │                ├─────────────────────────────────┤                  │
│    │                │ Round 1 · 2 notes    [Wrap up]  │                  │
└────┴────────────────┴─────────────────────────────────┴──────────────────┘
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
  While the project is being cloned, its icon pulses and the Navigator says so. In *Diffs*, viewed
  files are hidden; the top says how many of the files are viewed, and a cog button opens a native
  menu: *As Tree* or *As List* (a flat list of the changed files, each with its folder dimmed
  next to its +/− lines). A changed file with notes or questions in the current round shows how many
  after its +/− lines (`✎ 2`; hovering says how many of each). *Show Viewed Files* in the tab bar's cog menu (L3) shows viewed files again
  with a ✓.
- **L3 — Viewer.** Tabs along the top: *Overview* (the PR's title and description, the tab a
  workspace opens on), *Guide* and *Diff*, all file diffs side by side one after
  another, with the Navigator on their left. Selecting a file in *Diffs* scrolls to its file diff;
  selecting one in *Files* shows the whole file in their place, until the toggle goes back to *Diffs*. Under the tabs, a second bar
  that stays put holds the current tab's options. On *Diff*, next to *Files*, *Commits* opens a
  native menu: *All Changes*, or one of the PR's commits (and local ones on top), newest first.
  Picking a commit shows its commit diff in the Navigator and the file diffs, and the button then
  names the commit; the Guide keeps all changes. On *Guide* and *Diff* it has a cog button that
  opens a native menu: *Unified* or *Split* file diffs, and *Show Viewed Files*, shared by the
  Navigator and the Guide. A file diff's header has a
  *Viewed* checkbox. Entries of the current review round (glossary) go between the lines while
  they're current, i.e. their lines still read as the code they were written on; the header says *N
  outdated* for the others, and a click shows them above the file diff with that code. A wrapped-up
  round's entries don't show. Hovering
  a line shows a `+` in the gutter; clicking it (or dragging it over a range) opens a box with two
  actions. *Note* (⌘Enter) saves a note. A saved note has *Send to agent*, which puts it in the L4
  message box, and shows *Sent to agent* once an ask included it. *Ask agent* (⇧⌘Enter) asks a
  question about those lines in the round's agent session, which knows the round's earlier questions:
  the reply streams into the question's thread between the lines, with each tool used as one line,
  and is kept as an answer when the turn ends. A box under it asks a follow-up. The round's questions
  run one at a time. These agent sessions don't show in L4.

  At the bottom of *Guide* and *Diff*, once the round has an entry, a bar for the **review round**:
  *Round N*, how many notes and questions it has, and *Wrap up*. Wrapping up (*Wrapping up…* while
  the agent works) ends the round and opens its action items above the bar: numbered, each with where
  it points and its text, which a click edits (⌘Enter or leaving the box saves, Esc cancels), and ✕ to
  delete. Then the bar says *wrapped up, N action items*, with *Show/Hide action items*, *Wrap up
  again*, which replaces them, and *Send to agent*, which hands the round off: it puts *Round N · N
  action items* in the L4 message box, like a note, and the next message carries the items and the
  round's stream to the current agent session. The next note or question starts the next round.

  *Guide* shows the workspace's guide: its guide groups one after another, each a title, a short
  description and then the group's file diffs, each with its file note above it, the same file diffs as in *Diff* (Viewed checkbox,
  notes, *Ask agent*). A group has its own *Viewed* checkbox, which marks all its file diffs.
  Viewed file diffs are hidden, and so is a group once all its file diffs are; the top says how many
  are viewed; *Show Viewed Files* in the bar's cog menu shows them again, as in the Navigator. On the left, a table of
  contents lists every group with how many of its file diffs are viewed (✓ when all are) and, if any,
  how many notes and questions are on its file diffs (`✎ 2`), marks the
  group being read as you scroll, and jumps to a group when clicked (showing viewed ones if it's
  hidden). Above it, a bar of how many file diffs are viewed in all. Changed files the guide doesn't mention (changed since it was
  made) come next, under *Not in the guide*. Groups tagged *generated* (glossary) come last, low-lighted, their title
  marked *Generated*. Without a guide the tab offers *Create guide*; it isn't made on its own,
  since it takes minutes and costs tokens. *Create guide* and *Regenerate* open the Commits menu
  first: *All Changes*, or one commit for a guide to its commit diff. While it's made the tab shows an approximate progress
  bar while Claude Code summarises and groups the files, labelled
  *Summarising files: N of M batches* and then *Grouping files…*. The guide then shows right away,
  its groups reading *Describing…* until their descriptions and file notes arrive, and the top says
  *describing groups: N of M*. After that the stored guide shows at once. At the top: what it's
  to (*All changes* or *Commit abc1234*), which models made it, when, how long it took, and
  *Regenerate*. A guide shows the PR as it was when made, and its *Viewed* ticks stay as they were;
  once the PR has new commits, an amber bar above it says so, with *Regenerate*. A new guide keeps the
  ticks of file diffs that didn't change. The prompt, the model and the summary model are in Settings, under *Guide*.
- **L4 — Agents** on the right: the agent sessions of the current workspace. Hidden at first. The *Agent* toggle at the right of
  each tab's bar, *View > Toggle Agents* or ⌥⌘B shows and hides it. *Send to agent* shows it. Several can be open at
  once, e.g. as tabs in the pane. For now L4 is a chat with the workspace's latest agent session:
  its turns, with each tool the agent used as one line, and a message box at the bottom (Enter
  sends, Shift+Enter adds a line). Notes sent from L3 sit above the message box as chips, can be
  removed, and go in front of the next message, making it an ask. *New session* in the header starts another agent session with
  the next message; a running turn can be stopped.

## Across all levels

- The borders of L2 and L4 can be dragged to resize the panes; L3 takes the rest.
- **⌘K** is always available, both to switch to anything (project, workspace, PR, file,
  agent session) and to run any command.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4 in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Tabs in L3:** which options go in each tab's bar? Should *Regenerate* move to the Guide's bar?
   Should a guide group down to hunks, not whole file diffs?
3. **The review round as a whole:** where do you see a round's whole stream, and earlier rounds with
   their action items? Where do you write an entry that floats on the round rather than on lines?
   Hand-off from the action items: all of them go to L4 (*Send to agent*); one at a time, and *Post*,
   are still open. And where do a PR's
   GitHub comments show? To be explored.
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Only the latest agent session is reachable so far; earlier ones need a way back.
5. **PR changes vs local changes:** *Diffs* mixes the PR's file diffs with local changes (uncommitted,
   untracked, unpushed), so an agent's work isn't told apart from the PR's. Options: a marker per
   file, a third toggle (*Local*), or showing local changes on top of the PR's head separately.
