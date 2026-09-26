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
| **Commit diff** | The file diffs of one commit: its first parent → the commit. The canvas shows one in place of all changes when a commit is picked under *Commits*. | *Diff*: all changes, merge base → worktree. |
| **Comment** | A GitHub comment on a PR: a review comment or a comment in the conversation. Written for a collaborator to read and answer. coxswain doesn't store comments; it reads them from GitHub, and *post* makes them. | *Note*: yours, private, in coxswain. The rule: a note is yours, a comment is on GitHub. |
| **Entry** | One comment of a workspace's review, in coxswain: a note, a question, an answer, an explanation or a finding. Belongs to its workspace ([ADR 0015](../adr/0015-entries-pinned-and-outdated.md)). Has an anchor, or is a reply in a thread. Records the view it was written in: a guide's or commit diff's range, or the worktree. An explanation or finding belongs to its guide too, and shows only while that guide does. Shows between the lines only while it's current. The UI never shows the word *entry*. | *Chat entry*: a line of an agent session's transcript in the agent pane. |
| **Note** | An entry written by the user: what should happen here ("change this to do xyz"). Private. Notes are what you give to agents, and what may later be posted as comments. | *File note*: the guide's one sentence on a file diff, written by an agent. *Comment*. |
| **Question** | A comment sent to the agent: an entry sent as a turn to the workspace's current agent session, the agent pane's ([ADR 0021](../adr/0021-comments-go-to-the-agent-pane.md)). The agent pane shows it as a card with *View thread*; the agent's reply is kept as an answer in the thread. The agent may act on it. A note becomes one when its thread is sent to the agent. | *Note*: a comment that stays with you. |
| **Answer** | An entry holding the agent's reply to a question. | |
| **Explanation** | An entry the agent writes on lines while making a guide, saying what they do and why, to help the user read them. Starts a thread like a note. | *Finding*: an explanation only helps; it doesn't judge. *File note*: on a whole file diff. |
| **Finding** | An entry the agent writes on lines when asked to review: a bug, a risk, a question or a suggestion of its own. Opt-in: only when the user asks for a review. | *Review comment*: GitHub's. *Explanation*. |
| **Thread** | Every anchored note, question, explanation or finding starts a thread: its replies (more notes, follow-up questions) and the agent's answers, in order, shown between the lines at its anchor. A reply sent to the agent is a follow-up question; otherwise a note. | |
| **Anchor** | Where an entry points: a line range on one side of a file diff, with the code as it was then. Line numbers drift as the worktree changes; the code doesn't. | |
| **Post** | Turning notes into comments on the PR on GitHub, so a collaborator can see them. Always an explicit action. Not built yet. | |
| **Resolved** | A thread the user has marked done. It folds to one line between the lines, is left out of *Send all to agent*, and can be reopened. Stored on the thread's first entry. | *Outdated*: a fact about the code; resolved is the user's decision. |
| **Outdated** | An anchored entry whose lines, in the view at hand, no longer read as the code it was written on, e.g. after an agent's changes. Not shown between the lines; its file diff's header says *N outdated* and shows it with the code it was about. Its opposite is **current**. | *Reviewed*: a decision about a file diff; outdated is a fact about the code. |
| **Review comment** | A GitHub comment attached to a line or range of a file diff in a PR. One kind of comment. | *Note*. |
| **Conversation** | The PR's discussion thread (GitHub's "Conversation" tab): comments on the PR as a whole, not tied to a line. | *Review comment*; GitHub Discussions, which coxswain doesn't use. |
| **Ask** | A message to the agent session in the agent pane, with what you want done, usually a change producing file diffs. | *Question*: a comment sent to the agent from a thread. *Prompt*: the text an ask turns into. |
| **Workspace** | A unit of work in a project, as shown in the sidebar: either a PR being reviewed or a local iteration. Has one worktree, and its diff, entries and agent sessions. | *Agent session*: one run of an agent; a workspace can have many. *Project*: a project has many workspaces. |
| **Agent pane** | The chat with the workspace's agent session, on the left of the main screen whenever a PR is open ([UX](../UX.md) L4). | *Canvas*: the agent pane is where you talk to the agent; the canvas is what you both look at. |
| **Canvas** | The right side of the main screen ([UX](../UX.md) L3): one explorer that shows the workspace's contents and that both the agent and the human can annotate. For now it shows *Changes*: all file diffs one after another, a commit diff, or a guide over them; or a whole file opened from *Files*. | *Agent pane*. |
| **Navigator** | The file list on the left of the canvas ([UX](../UX.md) L2), shown with its *Files* toggle. A toggle at its top switches between *Diffs*, the workspace's changed files, and *Files*, the whole file tree of the workspace. | *Canvas*: the navigator lists files; the canvas shows them. |
| **Guide** | A reading order for a workspace's diff, made by the agent pane's session with coxswain's tools ([ADR 0023](../adr/0023-guides-made-by-the-agent-pane.md)): its file diffs sorted into guide groups, and explanations on lines. Asked for in the agent pane, or with *Guide* in the canvas's bar; with review, it has findings too. Pinned to the merge base → the PR head then, and shown in *Changes* over that range, not the live diff; local changes aren't in it. **Stale** once the PR head moves on. Every guide is kept; the newest shows, and older ones can be shown again. | *PR description*: written by its author. *Review*: findings are the review part, and opt-in. |
| **Guide group** | A set of file diffs in a guide that share one theme, with a title, a short description of what the reviewer is looking at, and a *file note* on each of its file diffs. Every file diff is in at most one group. Files in no group come after the groups, under *Not in the guide*. | *Thread*, *folder*: a group is by theme, not by place in the tree. |
| **Guide tag** | A label the agent puts on a guide group. The only one is *generated*: the group's files are made by a tool (lockfiles, generated clients, snapshots), not written by hand. A generated group is low-lighted and comes last. | *Label*: GitHub's labels are on the PR, not on a group. |
| **File note** | One sentence in a guide group on what to look at in one of its file diffs, shown above it. | *Explanation*: on lines. *Note*: written by the user. |
| **Reviewed** | A file diff the user has marked as reviewed, on the canvas. Belongs to the file diff's contents ([ADR 0014](../adr/0014-reviewed-follows-file-diff-contents.md)): stays reviewed while they're unchanged. In the live diff an agent's edit or new PR commits on that file make it unreviewed again; in a guide, which is pinned, it stays, and a new guide keeps it for file diffs that didn't change. Local to coxswain for now, not synced with GitHub's own *Viewed* checkbox. | *Viewed*: its old name. *Outdated*: that is for entries, not files. A GitHub PR review ("alice reviewed") is about the PR, not a file diff. |
| **Worktree** | One checkout of a repository at a branch, where code can be changed. Every agent session works in exactly one worktree. | *Branch*: several worktrees can't share a branch; a branch exists without a worktree. |
| **PR worktree** | A worktree checked out on a PR's head branch. Changes made there become new commits on the PR once pushed. | |
| **Local change** | A change in a worktree that isn't on the PR: uncommitted or untracked files, or commits not pushed yet. An agent session's changes are local changes until they're pushed. | *File diff* of the PR: what's on GitHub. *Diffs* shows both together for now. |
| **Clone** | coxswain's own copy of a project's repository, in `~/coxswain/repos/<owner>/<name>/` ([ADR 0008](../adr/0008-clones-and-pr-worktrees.md)). The project's worktrees are made from it. | The user's own checkouts, which coxswain doesn't touch. |
| **User** | A GitHub account. Authors PRs and comments, reviews PRs. The *current user* is whoever is signed in to coxswain. | *Agent*: agent changes are made by a user's agent, but commits and comments show a user. |
| **Agent session** | One run of a local coding agent (Claude Code or Codex) in one worktree: the ask that started it, its transcript and its resulting changes or answer. | *Agent*: the tool (Claude Code, Codex); an agent session is one use of it. |
| **Turn** | One message from the user to an agent session and the agent's reply to it, including the tools the agent used on the way. | *Ask*: an ask starts an agent session; later messages in it are further turns. A question is one turn of the workspace's agent session. |
| **Permission prompt** | An agent's request to use a tool it isn't allowed to use on its own, shown in the agent pane or in a question's thread with the agent's options (e.g. *Yes*, *Always*, *No*). The turn waits for the user's pick. Only what auto mode would block asks. | *Ask*: the user's message to an agent; a permission prompt is the agent asking the user. |

## How they relate

```
                 GitHub                              coxswain
  ─────────────────────────────────    ┃    ───────────────────────────────────────
  Pull request                         ┃    Workspace
    ├── Review comment ──┐             ┃      └── Entries: note │ question │ answer │ explanation │ finding, in threads
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
2. **Comments in coxswain.** Show a PR's comments in the diff next to entries? Turn a comment into
   a note with one click, so notes stay the one queue? Posting appears as the current user: can an
   answer be posted, marked as agent-written?
