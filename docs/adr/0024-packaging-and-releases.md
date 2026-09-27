# 24. Packaging and releases

Date: 2026-09-27

## Status

Accepted

## Context

coxswain only ran from a checkout (`pnpm dev`, `pnpm start`). People who want to try it need a download, and a bug
report needs to say which build it's from. Every change should also pass the checks in [AGENTS.md](../../AGENTS.md)
before it lands, not only on the author's machine.

The app has no native Node modules (SQLite is `node:sqlite`), and the agents it runs are the user's own `claude` and
`codex` ([ADR 0018](0018-agents-over-acp.md)), so a package needs only our JavaScript and Electron.

## Decision

1. **electron-builder packages the app**, configured in `package.json` (`build`): a `.dmg` and `.zip` for macOS
   (arm64 and x64), an NSIS installer for Windows x64, an AppImage for Linux x64. The agent SDKs' bundled
   `claude` and `codex` binaries are left out; the user's own are used.
2. **A pushed `v*` tag is a release.** `.github/workflows/release.yml` sets the version from the tag, builds on one
   runner per OS and creates the GitHub release with the files and generated notes. A tag with a pre-release part
   (`v0.1.0-rc.1`) makes a GitHub pre-release.
3. **The build knows its version and commit**: `__VERSION__` (from `package.json`, i.e. the tag) and `__COMMIT__`
   (`GITHUB_SHA`, or `git rev-parse` locally) are defined in the renderer and shown in Settings.
4. **CI runs typecheck, lint, format check and build** on every push to `main` and every pull request
   (`.github/workflows/ci.yml`).
5. **Unsigned for now.** macOS builds aren't signed or notarized, so Gatekeeper blocks the first launch
   (right-click → Open, or `xattr -cr coxswain.app`). Windows builds aren't signed either.
6. **A packaged app takes the login shell's `PATH`** at startup (macOS and Linux), because one started from the
   Dock or a launcher gets a bare `PATH` without `gh`, `claude` or `codex`.

## Alternatives considered

- **Electron Forge**: the official tool, but its makers and publishers are more setup for the same three targets;
  electron-builder is one config block and builds macOS x64 on an arm64 runner.
- **electron-builder's own publishing**: it drafts one release per runner and races; one job creating the release
  from every runner's files is simpler to follow.

## Consequences

- Releases are a `git tag` and a `git push --tags` away; nothing to run locally.
- First launches on macOS need the Gatekeeper workaround until we sign with a Developer ID and notarize (secrets in
  the release workflow, `mac.identity` in the config).
- No auto-update: users download new releases by hand.
