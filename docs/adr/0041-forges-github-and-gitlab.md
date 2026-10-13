# 41. Forges: GitHub and GitLab

Date: 2026-10-13

## Status

Accepted

## Context

Everything coxswain does with PRs is GitHub's ([ADR 0006](0006-github-integration.md),
[ADR 0037](0037-pull-request-sync-and-posting.md)): `core/github.ts` and the GraphQL in `core/pull-requests.ts` and
`core/review.ts`, a project's `github` (`owner/name`), the entries' `github_*` columns, `github.com` in clone URLs,
remote detection and permalinks, and "GitHub" in the UI's texts. A project on another host works only as a local
repository ([ADR 0040](0040-local-repositories-and-optional-github.md)), which deferred a forge interface until a second
forge could shape it.

Users with a self-hosted GitLab (Community Edition, 19.x) want review threads, posting and checks there too. GitLab
calls a PR a merge request and its review threads discussions; it identifies a project by a path of any depth
(`group/subgroup/name`) and an MR by its `iid`; it has draft notes where GitHub has a pending review, pipelines and jobs
where GitHub has checks, and a merge method per project rather than per merge. Many GitLab users already have its CLI
(`glab`) signed in, as GitHub users have `gh`.

## Decision

1. **A forge is where a project's PRs are: GitHub or GitLab.** A project has a `forge` (`github` | `gitlab`), the
   forge's `host` and the `repo` path there, or none of them (a local repository on no forge). Both forges work side
   by side, decided per project; nothing is chosen globally.
2. **One interface in the core** (`core/forge.ts`), with an implementation per forge (`core/forges/github.ts`,
   `core/forges/gitlab.ts`). Everything outside them talks to the interface: reading a PR in the shape ADR 0037 mirrors
   (state, description, people, labels, conversation, review threads with their anchors, checks), finding and opening
   a PR, posting a review or a comment, resolving, editing and deleting comments, changing the PR, a check's log, a
   permalink, the clone URL, the repository list and the current user. What a forge can't do it says so in its
   capabilities (e.g. merge methods, verdicts), and the UI offers only those.
3. **GitLab hosts are those `glab` is signed in to.** The core reads a host's token with
   `glab config get token --host <host>` each time it needs it, as ADR 0006 does with `gh`, and never stores it; the
   protocol for clones is `glab config get git_protocol --host <host>`. A local repository whose `origin` is on such a
   host is a GitLab project. Settings lists the hosts and says how to add one (`glab auth login --hostname …`); coxswain
   keeps no list of its own. github.com stays the only GitHub host.
4. **GitLab through its REST API (v4)**, with `fetch` in the core and hand-written types for the fields read, as
   `core/github.ts` types GitHub's. A PR's read is a handful of requests (the MR, its discussions page by page, its
   approvals, its head pipeline's jobs).
5. **How ADR 0037 maps onto GitLab:** a review thread is a resolvable discussion whose first note has a diff position;
   the conversation is the MR's other notes; _Submit Review_ is draft notes published together
   (`draft_notes/bulk_publish`), with _Request Changes_ as its reviewer state and _Approve_ as an approval; a draft
   note is recorded as `draft:<id>` until then and found again once published, and replies to a thread started in the
   review are posted after it; _Post to GitHub_ is a note posted at once; checks are
   the head pipeline's jobs, a commit's dot its pipeline's state, and a failed job's log its trace; ready is clearing
   draft. A comment off the MR's diff goes into the conversation with the code quoted, as GitLab doesn't render a
   permalink as code.
6. **The UI says what the project's forge says**: PR or MR, _on GitHub_ or _on GitLab_, from the forge, not from
   hard-coded text. The glossary and the code keep **pull request** for both.
7. **Columns name the forge, not GitHub.** The entries' `github_*` become `forge_*`; whether a posted comment is in
   the conversation is stored, not read from its URL. Existing projects become `github` projects on `github.com`, and
   their clones don't move; a GitLab project's clone is `~/coxswain/repos/<host>/<repo>/`.

## Alternatives considered

- **One forge for the whole app**, picked in Settings. No forge per project, but a global switch that hides one forge
  everywhere is more work than a field per project, and users have repositories on both.
- **GitLab's GraphQL API** for the read, in one request as for GitHub. Fewer requests, but REST documents every write
  needed (draft notes, approvals, discussions), and one API keeps the GitLab code in one shape.
- **A pasted personal access token, stored with `safeStorage`.** Works without `glab`, but asks the user for a secret
  that `glab` already has. Revisit, with native OAuth for both forges (ADR 0006 decision 2), if `glab` keeps its token
  in the system keyring where `glab config get` can't read it.
- **`@gitbeaker/rest`**, a typed GitLab client. A large dependency for about twenty endpoints.

## Consequences

- GitLab features need `glab` installed and signed in to the host.
- GitLab Free has one assignee and one reviewer per MR and no approval rules; the PR panel shows what the forge returns.
- What GitLab can't do as GitHub does (a merge method per merge) isn't offered on GitLab projects: the panel offers
  the project's method, and squashing where the project allows it.
- Fork MRs aren't supported, as fork PRs aren't (ADR 0008).
- ADRs 0006 and 0037 describe the GitHub forge; 0040's projects have a forge instead of `github`.
