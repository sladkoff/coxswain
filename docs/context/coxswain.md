# coxswain — ubiquitous language

The terms used in code, docs and conversation. One file per bounded context.
If a term's meaning changes, update it here first.

Draft: these are working definitions for finding out how the concepts relate. Open questions are
listed at the end.

## Terms

| Term | Meaning | Not to be confused with |
|------|---------|-------------------------|
| **Project** | A repository the user has added to coxswain, together with its worktrees, comments and agent sessions. The top-level thing you open. | *Repository*: the project is coxswain's view of a repository. |
| **Repository** | A git repository. Either local only, or hosted on GitHub (`owner/name`); only GitHub repositories have pull requests. | *Worktree*: the repository is shared; a worktree is one checkout of it. |
| **File** | A path in a repository, read at one revision or from a worktree. | *File diff*: a file is contents; a file diff is a change. |
| **Pull request (PR)** | A GitHub request to merge a head branch into a base branch of a repository. Has an author, reviewers, file diffs, review comments and a conversation. | *Branch*: a PR points at a branch but also carries review state and conversation. |
| **File diff** | The change to one file between two revisions: in a PR (base → head), or in a worktree (its base → working state). | *Diff*: the whole set of file diffs of a PR or worktree. |
| **Comment** | A remark anchored to a file diff line range (or to a whole PR or diff), stored in coxswain. Either a local comment or an imported comment. Comments are what coxswain gives to agents. | *Annotation*: don't use it as a separate term; a local comment is still a comment. |
| **Thread** | A comment and its replies. Can be resolved. | |
| **Local comment** | A comment written in coxswain, mainly for agents. Private to the user until published. Works on any diff: a PR, a worktree, an agent session's result, a local-only repository. | *Review comment*. |
| **Imported comment** | A comment copied into coxswain from GitHub (a review comment or a conversation comment), so it can be given to an agent. Remembers where it came from. | *Review comment*: the review comment is the original on GitHub; the imported comment is coxswain's copy. |
| **Import** | Copying a PR's GitHub comments into coxswain. | |
| **Publish** | Posting local comments to the PR on GitHub as review comments, usually at the end of iterating with an agent, so a collaborator can see them. | |
| **Outdated** | A comment whose lines have changed since it was written, e.g. after an agent's changes. Still visible, marked as no longer matching the code, like on GitHub. | *Resolved*: resolving is a decision; outdated is a fact about the code. |
| **Review comment** | A GitHub comment attached to a line or range of a file diff in a PR. | *Imported comment*. |
| **Conversation** | The PR's discussion thread (GitHub's "Conversation" tab): comments on the PR as a whole, not tied to a line. | *Review comment*; GitHub Discussions, which coxswain doesn't use. |
| **Ask** | Giving a set of comments (or a prompt) to an agent, with what you want back. Two kinds so far: *change* (implement it, producing file diffs) and *explain* (answer, without changing code). Starts an agent session. | *Prompt*: the prompt is the text an ask turns into. |
| **Session** | A unit of work in a project, as shown in the sidebar: either a PR being reviewed or a local iteration. Has one worktree, and its diff, open tabs, comments and agent sessions. Name not final ([UX](../UX.md)). | *Agent session*: one run of an agent; a session can have many. |
| **Worktree** | One checkout of a repository at a branch, where code can be changed. Every agent session works in exactly one worktree. | *Branch*: several worktrees can't share a branch; a branch exists without a worktree. |
| **PR worktree** | A worktree checked out on a PR's head branch. Changes made there become new commits on the PR once pushed. | |
| **User** | A GitHub account. Authors PRs and comments, reviews PRs. The *current user* is whoever is signed in to coxswain. | *Agent*: agent changes are made by a user's agent, but commits and comments show a user. |
| **Agent session** | One run of a local coding agent (Claude Code or Codex) in one worktree: the ask that started it, its transcript and its resulting changes or answer. | *Agent*: the tool (Claude Code, Codex); a session is one use of it. |

## How they relate

```
                 GitHub                              coxswain
  ─────────────────────────────────    ┃    ───────────────────────────────────────
  Pull request                         ┃
    ├── Review comment ──┐             ┃
    └── Conversation ────┴── import ──▶┃──▶ Imported comment ─┐
                                       ┃                      ├─▶ Comment ──ask──▶ Agent session
    Review comment ◀──── publish ──────┃◀── Local comment ────┘   (thread,          │ runs in
                                       ┃                           outdated)        ▼
                                       ┃                                        Worktree
                                       ┃                                   (PR worktree or
                                       ┃                                    feature worktree)
                                       ┃                                            │
                                       ┃        change → file diffs in the worktree ┘
                                       ┃        explain → reply in the thread
```

- A **project** has one repository and any number of worktrees. The repository may be local only;
  then there are no PRs, imports or publishing, but local comments and agents work the same.
- A **PR** belongs to one GitHub repository. Reviewing it uses a PR worktree on its head branch.
- All **comments** live in coxswain. GitHub is where some of them come from (import) and where
  some of them go (publish), not where coxswain reads them from.
- The expected loop: import the PR's comments, add local comments, ask the agent, look at the
  result, repeat; at the end, publish the local comments that a collaborator should see.
- An **agent session** runs in one worktree and starts from one ask. For a *change* ask, where the
  result goes depends on the worktree:
  - when reviewing a PR, the session works in the PR worktree, so its changes land on the PR's
    branch;
  - for feature work, the session works in its own worktree on a new branch.
- A worktree can have several agent sessions over time. Several sessions at once in one worktree
  would conflict, so parallel agents mean parallel worktrees, and so parallel sessions.

## Out of scope for now

- **Remote worktrees:** worktrees on connected remote machines. The core is built so this is
  possible later ([ADR 0002](../adr/0002-standalone-electron-app.md)); for now all worktrees are
  local.

## Open questions

1. **One PR, several sessions?** Each session has its own worktree. E.g. two agents trying different fixes for the same comments.
   If so, only one of them can be the PR worktree; the others need a way to bring their result
   onto the PR branch.
2. **When does a comment become outdated?** When any line in its range changes, when the agent's
   session for it ends, or when the change is committed or pushed?
3. **After an ask:** is the thread resolved, does the agent reply in it with what it did, or does
   the user decide? May differ between *change* and *explain*.
4. **Import:** one-off, or kept in sync as new GitHub comments arrive? What happens to an imported
   comment that is resolved or edited on GitHub?
5. **Publishing and GitHub identity:** published comments appear as the current user. Should a
   comment the agent wrote (e.g. an *explain* answer) be publishable, and marked as agent-written?
