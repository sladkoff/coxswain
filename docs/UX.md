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
│ ── │ src/           │  with comments between lines    │                  │
│▌#12│   a.ts   +3    │                                 │ several agent    │
│ #34│   b.ts   -1    │                                 │ sessions         │
│ +  │                │                                 │                  │
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
  next to its +/− lines), and *Show Viewed Files*, which shows viewed files again with a ✓.
- **L3 — Viewer.** Tabs along the top: *Overview* (the PR's title and description, the tab a
  workspace opens on), *Guide* and *Diff*, all file diffs side by side one after
  another, with the Navigator on their left. Selecting a file in *Diffs* scrolls to its file diff;
  selecting one in *Files* shows the whole file in their place, until the toggle goes back to *Diffs*. Under the tabs, a second bar
  that stays put holds the current tab's options (none yet). A file diff's header has a
  *Viewed* checkbox. Local comments go between
  the lines: hovering a line shows a `+` in the gutter; clicking it (or dragging it over a range)
  opens a box to write the comment. A saved comment has *Send to agent*, which puts it in the L4
  message box, and shows *Sent to agent* once an ask included it. The comment box also has *Ask
  agent* (⇧⌘Enter), which saves the comment and asks the agent about it right away, in an agent
  session of its own: the replies stream into the comment's thread, between the lines, with a box to
  answer. These agent sessions don't show in L4.

  *Guide* shows the workspace's guide: its guide groups one after another, each a title, a short
  description and then the group's file diffs, each with its file note above it, the same file diffs as in *Diff* (Viewed checkbox,
  comments, *Ask agent*). A group has its own *Viewed* checkbox, which marks all its file diffs.
  Viewed file diffs are hidden, and so is a group once all its file diffs are; the top says how many
  are viewed, with *Show viewed* to show them again, as in the Navigator. On the left, a table of
  contents lists every group with how many of its file diffs are viewed (✓ when all are), marks the
  group being read as you scroll, and jumps to a group when clicked (showing viewed ones if it's
  hidden). Above it, a bar of how many file diffs are viewed in all. Changed files the guide doesn't mention (changed since it was
  made) come next, under *Not in the guide*. Groups tagged *generated* (glossary) come last, low-lighted, their title
  marked *Generated*. The first time the tab opens it shows an approximate progress
  bar while Claude Code summarises and groups the files, labelled
  *Summarising files: N of M batches* and then *Grouping files…*. The guide then shows right away,
  its groups reading *Describing…* until their descriptions and file notes arrive, and the top says
  *describing groups: N of M*. After that the stored guide shows at once. At the top: which models
  made it, when, how long it took, and *Regenerate*. The prompt, the model and the summary model are in Settings, under *Guide*.
- **L4 — Agents** on the right: the agent sessions of the current workspace. Hidden at first. The *Agent* toggle at the right of
  each tab's bar, *View > Toggle Agents* or ⌥⌘B shows and hides it. *Send to agent* shows it. Several can be open at
  once, e.g. as tabs in the pane. For now L4 is a chat with the workspace's latest agent session:
  its turns, with each tool the agent used as one line, and a message box at the bottom (Enter
  sends, Shift+Enter adds a line). Comments sent from L3 sit above the message box as chips, can be
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
3. **Comments list:** where do you see all comments of a workspace, to pick which ones to ask the
   agent about? To be explored.
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Only the latest agent session is reachable so far; earlier ones need a way back.
5. **PR changes vs local changes:** *Diffs* mixes the PR's file diffs with local changes (uncommitted,
   untracked, unpushed), so an agent's work isn't told apart from the PR's. Options: a marker per
   file, a third toggle (*Local*), or showing local changes on top of the PR's head separately.
