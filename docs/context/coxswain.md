# coxswain — ubiquitous language

The terms used in code, docs and conversation. One file per bounded context.
If a term's meaning changes, update it here first.

Draft: these are working definitions for finding out how the concepts relate. Open questions are
listed at the end.

## Terms

| Term | Meaning | Not to be confused with |
|------|---------|-------------------------|
| **Project** | A repository the user has added to coxswain, together with its worktrees, review rounds and agent sessions. The top-level thing you open. | *Repository*: the project is coxswain's view of a repository. |
| **Repository** | A git repository. Either local only, or hosted on GitHub (`owner/name`); only GitHub repositories have pull requests. | *Worktree*: the repository is shared; a worktree is one checkout of it. |
| **File** | A path in a repository, read at one revision or from a worktree. | *File diff*: a file is contents; a file diff is a change. |
| **Pull request (PR)** | A GitHub request to merge a head branch into a base branch of a repository. Has an author, reviewers, file diffs, review comments and a conversation. | *Branch*: a PR points at a branch but also carries review state and conversation. |
| **File diff** | The change to one file between two revisions: in a PR (base → head), or in a worktree (its base → working state). | *Diff*: the whole set of file diffs of a PR or worktree. |
| **Comment** | A GitHub comment on a PR: a review comment or a comment in the conversation. Written for a collaborator to read and answer. coxswain doesn't store comments; it reads them from GitHub, and *post* makes them. | *Note*: yours, private, in coxswain. The rule: a note is yours, a comment is on GitHub. |
| **Review round** | One pass of the user over a workspace's diff: a stream of entries in the order they were made. Ends when wrapped up; the next entry starts a new round. A workspace has any number of rounds over time; the latest is the current one. Its questions share one agent session, so each question knows the earlier ones. The UI says *Round* ("Round 2") and never shows the word *entry*. | *Agent session*: a round has one for its questions but is not one. GitHub's *review*: a set of comments posted at once. |
| **Entry** | One item in a review round: a note, a question or an answer. Has an anchor, or floats on the round. | *Chat entry*: a line of an agent session's transcript in L4. |
| **Note** | An entry written by the user: what should happen here ("change this to do xyz"). Private. Notes are what you give to agents, and what may later be posted as comments. | *File note*: the guide's one sentence on a file diff, written by an agent. *Comment*. |
| **Question** | An entry asking the round's agent session about its anchor ("what is this?"), or a follow-up to one. Never changes code. | *Ask*: an ask in L4 may change code; a question doesn't. |
| **Answer** | An entry holding the agent's reply to a question. | |
| **Thread** | A question with its follow-ups and answers, shown between the lines at its anchor. | *Review round*: the round holds every entry; a thread is the part about one anchor. |
| **Anchor** | Where an entry points: a line range on one side of a file diff, with the code as it was then. Line numbers drift as the worktree changes; the code doesn't. | |
| **Wrap up** | Ending a review round: an agent reads the round's whole stream and drafts its action items, which the user then edits. Can be done again on the ended round, replacing the draft. | *Hand off*: what comes after, giving the action items to an agent or posting them. |
| **Action item** | One thing to change, drafted by wrap up from a round's entries: a self-contained instruction, anchored where its entries were, and remembering which entries it came from. The user can edit or delete it. | *Note*: what the user wrote; an action item is the agent's reading of the whole round, merging notes and turning answers into tasks. |
| **Hand off** | Giving a round's action items to an agent to implement, or posting them as comments. To an agent it is an ask carrying the items, with their anchors, and the round's whole stream as context. Posting isn't built yet. | *Ask*: a hand-off to an agent is an ask. |
| **Post** | Turning notes into comments on the PR on GitHub, so a collaborator can see them. Always an explicit action. Not built yet. | |
| **Outdated** | An anchored entry whose lines have changed since it was written, e.g. after an agent's changes. Still visible, marked as no longer matching the code, like on GitHub. | *Resolved*: resolving is a decision; outdated is a fact about the code. |
| **Review comment** | A GitHub comment attached to a line or range of a file diff in a PR. One kind of comment. | *Note*. |
| **Conversation** | The PR's discussion thread (GitHub's "Conversation" tab): comments on the PR as a whole, not tied to a line. | *Review comment*; GitHub Discussions, which coxswain doesn't use. |
| **Ask** | Giving a set of notes (or a prompt) to an agent session in L4, with what you want done, usually a change producing file diffs. | *Question*: asked in a thread, never changes code. *Prompt*: the text an ask turns into. |
| **Workspace** | A unit of work in a project, as shown in the sidebar: either a PR being reviewed or a local iteration. Has one worktree, and its diff, open tabs, review rounds and agent sessions. | *Agent session*: one run of an agent; a workspace can have many. *Project*: a project has many workspaces. |
| **Navigator** | The file list on the left of the Diff tab ([UX](../UX.md) L2), shown with its *Files* toggle. A toggle at its top switches between *Diffs*, the workspace's changed files, and *Files*, the whole file tree of the workspace. | *Viewer*: the navigator lists files; the viewer shows the one you open. |
| **Viewer** | The main pane ([UX](../UX.md) L3), with the workspace's tabs along its top: *Overview*, *Guide* and *Diff*, plus a tab for a whole file opened from *Files*. | *Navigator*. |
| **Overview** | The Viewer tab that shows the PR's title and description. | *Conversation*: the overview is only the PR's description for now. |
| **Guide** | A reading order for a workspace's diff, made by an agent: its file diffs sorted into guide groups. Stored with the merge base it was made from, the models that made it and how long it took; a guide from another merge base isn't shown. Shown once grouped, and filled in as its groups are described. Also the Viewer tab that shows it. | *Overview*: the PR's own description, written by its author. |
| **Guide group** | A set of file diffs in a guide that share one theme, with a title, a short description of what the reviewer is looking at, and a *file note* on each of its file diffs. Every file diff is in at most one group. A group is viewed when all its file diffs are. | *Thread*, *folder*: a group is by theme, not by place in the tree. |
| **Guide tag** | A label the agent puts on a guide group. The only one is *generated*: the group's files are made by a tool (lockfiles, generated clients, snapshots), not written by hand. A generated group is low-lighted and comes last, after *Not in the guide*. | *Label*: GitHub's labels are on the PR, not on a group. |
| **File note** | One sentence in a guide group on what to look at in one of its file diffs, shown above it. | *File summary*: says what changed, and isn't shown. *Note*: written by the user. |
| **Guide prompt** | The instructions a guide is made with, changeable in Settings. The changed files, their diffs, the step and the answer's shape are added by coxswain and can't be changed. Used twice: to group the files, then to describe each group. | *Ask*: making a guide isn't an agent session in L4 or a question. |
| **File summary** | One sentence on what changed in a file diff, made on the *summary model* before grouping, and what the files are grouped from. Kept while the file diff is unchanged, so a new guide reuses it. | *File note*: what to look at, shown in the guide. |
| **Diff tab** | The Viewer tab that shows all file diffs of the workspace one after another, to scroll through. Opening a changed file in *Diffs* scrolls to it. | *Diff*: the tab shows the diff. |
| **Viewed** | A file diff the user has marked as seen, in the Viewer. Stays viewed only while the file diff is unchanged: an agent's edit or new PR commits on that file make it unviewed again. Local to coxswain for now, not synced with GitHub's own *Viewed* checkbox. | *Resolved*: that is for threads, not files. |
| **Worktree** | One checkout of a repository at a branch, where code can be changed. Every agent session works in exactly one worktree. | *Branch*: several worktrees can't share a branch; a branch exists without a worktree. |
| **PR worktree** | A worktree checked out on a PR's head branch. Changes made there become new commits on the PR once pushed. | |
| **Local change** | A change in a worktree that isn't on the PR: uncommitted or untracked files, or commits not pushed yet. An agent session's changes are local changes until they're pushed. | *File diff* of the PR: what's on GitHub. *Diffs* shows both together for now. |
| **Clone** | coxswain's own copy of a project's repository, in `~/coxswain/repos/<owner>/<name>/` ([ADR 0008](../adr/0008-clones-and-pr-worktrees.md)). The project's worktrees are made from it. | The user's own checkouts, which coxswain doesn't touch. |
| **User** | A GitHub account. Authors PRs and comments, reviews PRs. The *current user* is whoever is signed in to coxswain. | *Agent*: agent changes are made by a user's agent, but commits and comments show a user. |
| **Agent session** | One run of a local coding agent (Claude Code or Codex) in one worktree: the ask that started it, its transcript and its resulting changes or answer. | *Agent*: the tool (Claude Code, Codex); an agent session is one use of it. |
| **Turn** | One message from the user to an agent session and the agent's reply to it, including the tools the agent used on the way. | *Ask*: an ask starts an agent session; later messages in it are further turns. A question is one turn of its round's agent session. |

## How they relate

```
                 GitHub                              coxswain
  ─────────────────────────────────    ┃    ───────────────────────────────────────
  Pull request                         ┃    Workspace
    ├── Review comment ──┐             ┃      └── Review round (many over time)
    └── Conversation ────┴── Comment ◀─┃─post──     └── Entries: note │ question │ answer
                                       ┃                   │ anchored to a file diff, or floating
                                       ┃                   │
                                       ┃        notes ──ask──▶ Agent session (L4) ──▶ file diffs
                                       ┃        question ─────▶ the round's agent session ──▶ answer
                                       ┃                                        │ runs in
                                       ┃                                        ▼
                                       ┃                                    Worktree
```

- A **project** has one repository and any number of worktrees. The repository may be local only;
  then there are no PRs, comments or posting, but notes, questions and agents work the same.
- A **PR** belongs to one GitHub repository. Reviewing it uses a PR worktree on its head branch.
- **Entries** live in coxswain; **comments** live on GitHub. A note becomes a comment only when the
  user posts it.
- The expected loop: review the diff in a round, leaving notes and asking questions; ask an agent to
  implement the notes; look at the result in a new round; at the end, post what a collaborator
  should see.
- A round's **questions** are turns of one agent session, so a question on one file diff can build
  on earlier ones. The session starts with the round's first question.
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
2. **When does an entry become outdated?** When any line in its anchor changes, when the agent's
   session for it ends, or when the change is committed or pushed?
3. **What a round reviews.** Should a round be tied to what was on screen, e.g. the head commit,
   merge base or guide it was made against, so a round can go stale when the code changes and a new
   one is due? For now a round starts with the first entry after the last one was wrapped up.
4. **Comments in coxswain.** Show a PR's comments in the diff next to entries? Turn a comment into
   a note with one click, so notes stay the one queue? Posting appears as the current user: can an
   answer be posted, marked as agent-written?
