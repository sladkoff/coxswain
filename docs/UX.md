# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md).

Draft: only the main areas so far. Open questions are listed at the end.

## Layout

A Discord-style layout: the current project and its workspaces in a narrow column on the far left,
then the workspace's files, the work in the middle and the agents on the right.

```
┌─────────────────────┬─────────────────────────────────┬──────────────────┐
│                     │ [tab] [tab] [tab]               │ [agent] [agent]  │
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
- **L2 — Navigator.** A toggle at the top switches between *Diffs*, the current workspace's changed
  files as a tree with their status and +/− lines, and *Files*, the whole file tree of the
  workspace, with folders that contain changes marked.
- **L3 — Viewer.** Shows what was opened in the navigator: selecting a file in *Diffs* shows its
  file diff side by side, selecting one in *Files* shows the whole file. Comments will go between the
  lines. A workspace can have several open tabs along the top (details to be decided).
- **L4 — Agents** on the right: the agent sessions of the current workspace. Several can be open at
  once, e.g. as tabs in the pane. For now L4 is a chat with the workspace's latest agent session:
  its turns, with each tool the agent used as one line, and a message box at the bottom (Enter
  sends, Shift+Enter adds a line). *New session* in the header starts another agent session with
  the next message; a running turn can be stopped.

## Across all levels

- **⌘K** is always available, both to switch to anything (project, workspace, PR, file,
  agent session) and to run any command.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4 in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Tabs in L3:** what goes in a tab (files, diffs, agent sessions?), and do tabs belong to a
   workspace and come back when you return to it?
3. **Comments list:** where do you see all comments of a workspace, to pick which ones to ask the
   agent about? To be explored.
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Only the latest agent session is reachable so far; earlier ones need a way back.
