# 6. GitHub integration

Date: 2026-09-24

## Status

Accepted

## Context

coxswain connects to GitHub to open and navigate PRs (G2) and, later, to import and publish comments
(G4). The first step is to connect to the repositories the current user can see on GitHub and turn
them into projects.

A project's repository must be a git repository, local or cloned (see
[the glossary](../context/coxswain.md) and [UX](../UX.md)). [ADR 0002](0002-standalone-electron-app.md)
requires that all GitHub work runs in the core, and [ADR 0005](0005-local-data-storage.md) keeps
secrets out of the database.

For signing in, a native OAuth flow means registering an OAuth App and building the sign-in screens.
That is too much work before we can even test the rest. Many developers already have the GitHub CLI
(`gh`) signed in, and its token can read every repository the user can see.

## Decision

1. **Sign in through `gh` for now.** The core runs `gh auth token` to get the current user's token
   for github.com. It asks `gh` again each time it needs the token and never stores it. If `gh` is
   missing or not signed in, coxswain says so and tells the user to run `gh auth login`.
2. **Long term, coxswain signs in natively with OAuth.** The plan is an OAuth App using the device
   flow (the user enters a code on github.com), with the token stored through `safeStorage` as
   ADR 0005 says. This needs its own ADR, which also decides who registers the app. Until then,
   `gh` is a requirement for GitHub features.
3. **Projects from GitHub repositories, two ways:**
   - **Clone:** picking a GitHub repository that isn't on the machine clones it into
     `~/coxswain/repos/<owner>/<name>/`, next to the worktrees folder from ADR 0005.
   - **Detect:** adding a local repository reads its `git remote`s, and if one points at
     github.com, the project remembers its `owner/name`.
4. **Git uses the user's own git setup.** Clone, fetch and push run plain `git`, with the user's SSH
   keys or credential helper. coxswain doesn't pass its token to git. Clones use the protocol from
   `gh config get git_protocol` (HTTPS by default, which `gh`'s credential helper covers).
5. **Octokit, in the core.** GraphQL where only GraphQL has what we need (review threads with their
   resolved and outdated state), REST where it is simpler (listing repositories).
6. **Lists are paged and searchable.** A user can see thousands of repositories, so the list of
   repositories is fetched page by page and searched, never loaded in full up front.
7. **Freshness by polling.** A local app can't receive webhooks, so the core polls, with conditional
   requests (ETags) so that unchanged responses don't count against the rate limit.
8. **One GitHub account, github.com only.**

## Alternatives considered

- **Native OAuth from the start.** The right end state, but it needs an app registration and
  sign-in screens before anything else can be tested. Deferred, not rejected (see decision 2).
- **A GitHub App.** Fine-grained permissions, but it only sees repositories where it is installed,
  and in organisations an admin must install it. That works against "every repository the user can
  see".
- **A pasted personal access token.** Manual, and a poor first experience.
- **Passing coxswain's token to git.** Would make clone and push work without any git setup, but
  would override how the user already authenticates git. Revisit with native OAuth, when `gh`'s
  credential helper may no longer be there.

## Consequences

- GitHub features need `gh` installed and signed in, until native OAuth lands.
- Which organisations' repositories appear depends on `gh`'s token: organisations that restrict
  OAuth apps or require SAML single sign-on may hide some. We don't handle that for now.
- The core must handle the token going away (`gh auth logout`), the same way it handles other
  missing things.
- Replacing `gh` with native OAuth changes only where the core gets its token; everything else in
  this ADR stays.
- Several accounts, or GitHub Enterprise, would need a new ADR.
