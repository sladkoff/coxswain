# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md).

Draft: only the main areas so far. Open questions are listed at the end.

## Layout

A Discord-style layout: the project menu at the top left, a narrow column of sessions, then the
session's files, the work in the middle and the agents on the right.

```
┌─────────────────────┬─────────────────────────────────┬──────────────────┐
│ ▾ Project           │ [tab] [tab] [tab]               │ [agent] [agent]  │
├────┬────────────────┤─────────────────────────────────┤──────────────────┤
│ L1 │ L2             │ L3                              │ L4               │
│    │ Diff  │ Files  │                                 │                  │
│ ◉  │                │  main area:                     │ agent chat       │
│ ◉  │ src/           │  diff, file, …                  │                  │
│ ◉  │   a.ts   +3    │  with comments between lines    │ several agent    │
│ ◉  │   b.ts   -1    │                                 │ sessions         │
│ +  │                │                                 │                  │
└────┴────────────────┴─────────────────────────────────┴──────────────────┘
          ⌘K from anywhere: switch to anything, do anything
```

## Levels

- **L0 — Project menu** at the top left, like Linear's workspace menu. Picks the project; the rest
  of the screen belongs to it. A project's repository must be git, local or cloned, and may be on
  GitHub.
- **L1 — Sessions of the selected project.** A session is either a PR or a local iteration, and
  has one worktree. Shown as a column of icons; one static icon for now.
- **L2 — The selected session's diff,** as a list of changed files. Can switch to a file tree of
  the whole worktree.
- **L3 — Main area.** Shows whatever is focused: a diff or a file, with comments between the lines.
  A session can have several open tabs along the top (details to be decided).
- **L4 — Agents** on the right: the agent sessions of the current session. Several can be open at
  once, e.g. as tabs in the pane.

## Across all levels

- **⌘K** is always available, both to switch to anything (project, session, PR, file, agent
  session) and to run any command.
- Projects, repositories and PRs must be quick to reach: the project menu, L1, and ⌘K.
- Agent sessions must be quick to reach: L4 in the current session, and ⌘K for all of them.

## Open questions

1. **Workspace:** is "workspace" the name for the top level picked in the project menu? If so, is a
   workspace one project, or a group of projects?
2. **Name for a session.** "Session" already means an agent session, and "workspace" may be taken
   by the top level. Keep *session* and always say *agent session* for the other one, or find
   another word.
3. **Inbox:** where do you find PRs that aren't sessions yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
4. **Tabs in L3:** what goes in a tab (files, diffs, agent sessions?), and do tabs belong to a
   session and come back when you return to it?
5. **Comments list:** where do you see all comments of a session, to pick which ones to ask the
   agent about? To be explored.
6. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
