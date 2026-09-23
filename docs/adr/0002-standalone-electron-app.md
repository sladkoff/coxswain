# 2. Standalone Electron app with a UI-free core

Date: 2026-09-23

## Status

Accepted

## Context

coxswain is a local mini IDE (see [GOALS](../GOALS.md)). It must:

- run local coding agents (Claude Code, Codex) and stream their output (G3, G4, G5);
- work with git checkouts and the GitHub API (G2);
- render diffs and PR comment threads well;
- feel native;
- be portable to the web later in some form.

A browser cannot spawn `claude` or `codex` on the user's machine, so any web version needs a
coxswain backend running somewhere — locally, or on a remote machine or sandbox.

## Decision

1. **Standalone app, not a VS Code extension.** The review-first interface — PR comments, agent
   runs and the diff as the main view, several agents running side by side — is part of the
   product. An extension would be confined to VS Code's file-centred layout of panels, tree
   views and webviews.
2. **Electron, TypeScript and React.** Electron has Node built in, which the TypeScript agent SDKs
   (Claude Agent SDK, Codex SDK) and `node-pty` need. The Chromium renderer is what the best
   diff editors (Monaco, CodeMirror 6) are tuned for.
3. **The UI does no work of its own.** All git, GitHub and agent work lives in a core that knows
   nothing about the UI and runs in Node. The UI talks to it only through one typed interface:
   Electron IPC for now, a WebSocket later. Hosting that same core is how coxswain moves to the
   web.

Which diff component and which RPC library to use are left to later ADRs.

## Alternatives considered

- **VS Code extension.** Most of G2 and G5 already exist there, installing is easy and a web
  version comes almost free. Rejected: we could not control the layout, and we would be building
  a feature on top of extensions owned by GitHub and Microsoft, who can easily copy it.
- **Tauri.** Much smaller app and lower memory use. Rejected: its backend is Rust while the agent
  SDKs are TypeScript, so we would ship a Node process alongside it anyway, and on macOS it uses
  WebKit for rendering, where diff views have more quirks.
- **Native Swift/SwiftUI.** Feels the most native, but it is macOS-only and cannot move to the web.

## Consequences

- The app is a larger download and uses more memory than a Tauri or native app. We make it feel
  native through craft instead: native menus and window chrome, keyboard-first use, fast startup.
- Any UI code that does git, GitHub or agent work directly breaks the rule above and blocks a
  web version. The interface between UI and core must stay the only way between them.
- A web version is possible if we host the core, but it is not free: we will still need to
  decide on authentication, and on where the agents and code checkouts live.
