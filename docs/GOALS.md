# coxswain — goals

coxswain is a local mini IDE for reviewing and building code with local coding agents.

**Main selling point:** turn review comments into agent work. Pick comments on a PR, hand them to
a local coding agent (Claude Code or Codex) to implement, and see the resulting diff.

Requirements reference goals by ID (e.g. "serves G3"). Tick a goal when it is met.

## Goals

- [x] **G1 — Runs locally.** coxswain is a local app working on local checkouts. Code stays on
      your machine.
- [ ] **G2 — GitHub pull requests.** Connect to GitHub, open PRs and navigate them: files,
      diffs and comment threads.
- [ ] **G3 — AI-assisted review.** Use local Claude Code and Codex during code review.
- [ ] **G4 — Comments to implementation.** Send review comments to a local coding agent,
      let it implement the feedback, and show the resulting diff. _(Main selling point.)_
- [x] **G5 — Feature development.** Not review-only: also use coxswain, with the same agents,
      to build new features.

## Non-goals

- A full general-purpose IDE. coxswain is a _mini_ IDE centred on diffs, PRs and agents.
