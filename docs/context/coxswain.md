# coxswain — ubiquitous language

The terms used in code, docs and conversation. One file per bounded context.
If a term's meaning changes, update it here first.

Draft: these are working definitions for finding out how the concepts relate. Open questions are
listed at the end.

## Terms

| Term | Meaning | Not to be confused with |
|------|---------|-------------------------|
| **Project** | A repository the user has added to coxswain, together with its worktrees, entries and agent sessions. The top-level thing you open. | *Repository*: the project is coxswain's view of a repository. |
| **Repository** | A git repository. Either local only, or hosted on GitHub (`owner/name`); only GitHub repositories have pull requests. | *Worktree*: the repository is shared; a worktree is one checkout of it. |
| **File** | A path in a repository, read at one revision or from a worktree. | *File diff*: a file is contents; a file diff is a change. |
| **Pull request (PR)** | A GitHub request to merge a head branch into a base branch of a repository. Has an author, reviewers, file diffs, review comments and a conversation. | *Branch*: a PR points at a branch but also carries review state and conversation. |
| **File diff** | The change to one file between two revisions: in a PR (base → head), or in a worktree (its base → working state). | *Diff*: the whole set of file diffs of a PR or worktree. |
| **Commit diff** | The file diffs of one commit: its first parent → the commit. The *Diff* tab shows one in place of all changes when a commit is picked under *Commits*. | *Diff*: all changes, merge base → worktree. |
| **Comment** | A GitHub comment on a PR: a review comment or a comment in the conversation. Written for a collaborator to read and answer. coxswain doesn't store comments; it reads them from GitHub, and *post* makes them. | *Note*: yours, private, in coxswain. The rule: a note is yours, a comment is on GitHub. |
| **Entry** | One comment of a workspace's review, in coxswain: a note, a question or an answer. Belongs to its workspace ([ADR 0022](../adr/0022-no-review-rounds.md)). Has an anchor, or is a reply in a thread. Records the view it was written in: a guide's or commit diff's range, or the worktree. Shows between the lines only while it's current. The UI never shows the word *entry*. | *Chat entry*: a line of an agent session's transcript in the agent pane. |
| **Note** | An entry written by the user: what should happen here ("change this to do xyz"). Private. Notes are what you give to agents, and what may later be posted as comments. | *File note*: the guide's one sentence on a file diff, written by an agent. *Comment*. |
| **Question** | A comment sent to the agent: an entry sent as a turn to the workspace's current agent session, the agent pane's ([ADR 0021](../adr/0021-comments-go-to-the-agent-pane.md)). The agent pane shows it as a card with *View thread*; the agent's reply is kept as an answer in the thread. The agent may act on it. | *Note*: a comment that stays with you. |
| **Answer** | An entry holding the agent's reply to a question. | |
| **Thread** | Every anchored note or question starts a thread: its replies (more notes, follow-up questions) and the agent's answers, in order, shown between the lines at its anchor. A reply sent to the agent is a follow-up question; otherwise a note. | |
| **Anchor** | Where an entry points: a line range on one side of a file diff, with the code as it was then. Line numbers drift as the worktree changes; the code doesn't. | |
| **Post** | Turning notes into comments on the PR on GitHub, so a collaborator can see them. Always an explicit action. Not built yet. | |
| **Outdated** | An anchored entry whose lines, in the view at hand, no longer read as the code it was written on, e.g. after an agent's changes. Not shown between the lines; its file diff's header says *N outdated* and shows it with the code it was about. Its opposite is **current**. | *Viewed*: a decision about a file diff; outdated is a fact about the code. |
| **Review comment** | A GitHub comment attached to a line or range of a file diff in a PR. One kind of comment. | *Note*. |
| **Conversation** | The PR's discussion thread (GitHub's "Conversation" tab): comments on the PR as a whole, not tied to a line. | *Review comment*; GitHub Discussions, which coxswain doesn't use. |
| **Ask** | A message to the agent session in the agent pane, with what you want done, usually a change producing file diffs. | *Question*: a comment sent to the agent from a thread. *Prompt*: the text an ask turns into. |
| **Workspace** | A unit of work in a project, as shown in the sidebar: either a PR being reviewed or a local iteration. Has one worktree, and its diff, entries and agent sessions. | *Agent session*: one run of an agent; a workspace can have many. *Project*: a project has many workspaces. |
| **Agent pane** | The chat with the workspace's agent session, on the left of the main screen whenever a PR is open. Replaces L4. | *Canvas*: the agent pane is where you talk to the agent; the canvas is what you both look at. |
| **Canvas** | The right side of the main screen: one explorer that shows the workspace's contents and that both the agent and the human can annotate. Replaces the Viewer and its tabs. For now it shows the file diffs. | *Viewer*: the old main pane with tabs. |
| **Navigator** | The file list on the left of the canvas (formerly the Diff tab) ([UX](../UX.md) L2), shown with its *Files* toggle. A toggle at its top switches between *Diffs*, the workspace's changed files, and *Files*, the whole file tree of the workspace. | *Viewer*: the navigator lists files; the viewer shows the one you open. |
| **Viewer** | *Being replaced by the canvas.* The main pane ([UX](../UX.md) L3), with the workspace's tabs along its top: *Overview*, *Guide* and *Diff*, plus a tab for a whole file opened from *Files*. | *Navigator*. |
| **Overview** | The Viewer tab that shows the PR's title and its timeline. | *Conversation*: GitHub's, which the timeline takes in along with the rest. |
| **Timeline** | The history of a workspace's PR, split into phases, as the Overview shows it, newest first. It starts with *PR created*, at the bottom. It takes in what coxswain stores (change summaries, entries) and what GitHub has (comments, reviews, merged or closed). Put together each time it's read, not stored. | *Thread*: a thread is about one anchor; the timeline holds every thread, placed in the phase it started in. |
| **Phase** | One version of the PR on the timeline: from a PR head coxswain saw until it saw the next. The first is *PR created*; each later one is *N new commits*, or *Rebased* when the new head doesn't build on the old one. Holds the events that happened while its head was the PR's. coxswain only sees a head while it's open, so several pushes made while it was closed show as one phase. | *Guide group*. |
| **Change summary** | What a phase changed, written by an agent as a short piece of prose: what the change sets out to do and why, from the description, commit messages and the GitHub reviews and comments before it. Intent and why are what the prompt asks for, not fields. Shown with the lines, files and commits it covers, which are counted, not written. The first phase's covers merge base → head; a later phase's, the previous head → its head, or merge base → head after a rebase. Made on its own when a phase starts. | *File summary*: one sentence per file diff, for grouping. *Guide*: a reading order, made on request. |
| **Event** | One item in a phase on the timeline: a thread's first note or question (with its replies and answers), a GitHub comment or review, or the PR being merged, closed, reopened or force-pushed. | *Entry*: an entry is one kind of event. *Chat entry*. |
| **Context** | What coxswain knows about a workspace's PR, as an agent would read it: the timeline as text. Not built yet; later it goes to the agent. | *Prompt*: the context is part of what a prompt carries. |
| **Guide** | A reading order for a workspace's diff, or for one commit diff, made by an agent: its file diffs sorted into guide groups. Pinned to the diff it was made from (the merge base → the PR head then, or a commit's parent → the commit) and shows that, not the live diff; local changes aren't in it. **Stale** once the PR head moves on. Stored with that range, the models that made it and how long it took; the tab shows the latest, and a guide to all changes from another merge base isn't shown. Shown once grouped, and filled in as its groups are described. Also the Viewer tab that shows it. | *Overview*: the PR's own description, written by its author. |
| **Guide group** | A set of file diffs in a guide that share one theme, with a title, a short description of what the reviewer is looking at, and a *file note* on each of its file diffs. Every file diff is in at most one group. A group is viewed when all its file diffs are. | *Thread*, *folder*: a group is by theme, not by place in the tree. |
| **Guide tag** | A label the agent puts on a guide group. The only one is *generated*: the group's files are made by a tool (lockfiles, generated clients, snapshots), not written by hand. A generated group is low-lighted and comes last, after *Not in the guide*. | *Label*: GitHub's labels are on the PR, not on a group. |
| **File note** | One sentence in a guide group on what to look at in one of its file diffs, shown above it. | *File summary*: says what changed, and isn't shown. *Note*: written by the user. |
| **Guide prompt** | The instructions a guide is made with, changeable in Settings. The changed files, their diffs, the step and the answer's shape are added by coxswain and can't be changed. Used twice: to group the files, then to describe each group. | *Ask*: making a guide isn't an agent session in L4 or a question. |
| **File summary** | One sentence on what changed in a file diff, made on the *summary model* before grouping, and what the files are grouped from. Kept while the file diff is unchanged, so a new guide reuses it. | *File note*: what to look at, shown in the guide. |
| **Diff tab** | The Viewer tab that shows all file diffs of the workspace one after another, to scroll through. Opening a changed file in *Diffs* scrolls to it. | *Diff*: the tab shows the diff. |
| **Viewed** | A file diff the user has marked as seen, in the Viewer. Belongs to the file diff's contents: stays viewed while they're unchanged. In the live *Diff* tab an agent's edit or new PR commits on that file make it unviewed again; in a guide, which is pinned, it stays, and a new guide keeps it for file diffs that didn't change. Local to coxswain for now, not synced with GitHub's own *Viewed* checkbox. | *Outdated*: that is for entries, not files. |
| **Worktree** | One checkout of a repository at a branch, where code can be changed. Every agent session works in exactly one worktree. | *Branch*: several worktrees can't share a branch; a branch exists without a worktree. |
| **PR worktree** | A worktree checked out on a PR's head branch. Changes made there become new commits on the PR once pushed. | |
| **Local change** | A change in a worktree that isn't on the PR: uncommitted or untracked files, or commits not pushed yet. An agent session's changes are local changes until they're pushed. | *File diff* of the PR: what's on GitHub. *Diffs* shows both together for now. |
| **Clone** | coxswain's own copy of a project's repository, in `~/coxswain/repos/<owner>/<name>/` ([ADR 0008](../adr/0008-clones-and-pr-worktrees.md)). The project's worktrees are made from it. | The user's own checkouts, which coxswain doesn't touch. |
| **User** | A GitHub account. Authors PRs and comments, reviews PRs. The *current user* is whoever is signed in to coxswain. | *Agent*: agent changes are made by a user's agent, but commits and comments show a user. |
| **Agent session** | One run of a local coding agent (Claude Code or Codex) in one worktree: the ask that started it, its transcript and its resulting changes or answer. | *Agent*: the tool (Claude Code, Codex); an agent session is one use of it. |
| **Turn** | One message from the user to an agent session and the agent's reply to it, including the tools the agent used on the way. | *Ask*: an ask starts an agent session; later messages in it are further turns. A question is one turn of the workspace's agent session. |
| **Permission prompt** | An agent's request to use a tool it isn't allowed to use on its own, shown in L4 or in a question's thread with the agent's options (e.g. *Yes*, *Always*, *No*). The turn waits for the user's pick. In L4 only what auto mode would block asks; in a thread, anything that would change something. | *Ask*: the user's message to an agent; a permission prompt is the agent asking the user. |

## How they relate

```
                 GitHub                              coxswain
  ─────────────────────────────────    ┃    ───────────────────────────────────────
  Pull request                         ┃    Workspace
    ├── Review comment ──┐             ┃      └── Entries: note │ question │ answer, in threads
    └── Conversation ────┴── Comment ◀─┃─post──       │ anchored to a file diff
                                       ┃              │
                                       ┃        ask ──────────▶ Agent session (agent pane) ──▶ file diffs
                                       ┃        question ─────▶ the same session  ──▶ answer
                                       ┃                                        │ runs in
                                       ┃                                        ▼
                                       ┃                                    Worktree
```

- A **project** has one repository and any number of worktrees. The repository may be local only;
  then there are no PRs, comments or posting, but notes, questions and agents work the same.
- A **PR** belongs to one GitHub repository. Reviewing it uses a PR worktree on its head branch.
- **Entries** live in coxswain; **comments** live on GitHub. A note becomes a comment only when the
  user posts it.
- The expected loop: review the diff, leaving comments and sending some to the agent; the agent
  answers or changes code; look at the result; at the end, post what a collaborator should see.
- A workspace's **timeline** has one phase per PR head coxswain saw, each with its change summary. Events
  from both sides of the line above (comments and reviews on GitHub; entries in coxswain) go in
  the phase they happened in.
- **Questions** are turns of the agent pane's session, so a question on one file diff can build on
  earlier ones and on the chat (ADR 0021).
- An **agent session** runs in one worktree. For an *ask* that changes code, where the result goes
  depends on the worktree:
  - when reviewing a PR, the agent session works in the PR worktree, so its changes land on the PR's
    branch;
  - for feature work, the agent session works in its own worktree on a new branch.
- A worktree can have several agent sessions over time. Several agent sessions at once in one
  worktree would conflict, so parallel agents mean parallel worktrees, and so parallel workspaces.

## Out of scope for now

- **Remote worktrees:** worktrees on connected remote machines. The core is built so this is
  possible later ([ADR 0002](../adr/0002-standalone-electron-app.md)); for now all worktrees are
  local.

## Open questions

1. **One PR, several workspaces?** Each workspace has its own worktree. E.g. two agents trying different fixes for the same notes.
   If so, only one of them can be the PR worktree; the others need a way to bring their result
   onto the PR branch.
2. *Answered by ADR 0015:* an entry is outdated wherever any line in its anchor reads differently.
3. *Dropped with review rounds (ADR 0022).*
4. **Comments in coxswain.** Show a PR's comments in the diff next to entries? Turn a comment into
   a note with one click, so notes stay the one queue? Posting appears as the current user: can an
   answer be posted, marked as agent-written?
