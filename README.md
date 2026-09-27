# coxswain

> **cox·swain** /ˈkɒks(ə)n/ _noun_
> The one in the boat who doesn't row. They steer, call the stroke and keep the crew in time.
>
> Your agents are the rowers. You are the coxswain.

![coxswain reviewing a pull request with an agent](docs/screenshot.png)

coxswain is a local mini IDE for reviewing and building code with the coding agents you already run: Claude Code and
Codex. Pick review comments on a pull request, hand them to an agent to implement, and review the diff it comes back
with, all without leaving the PR.

> [!NOTE]
> coxswain is a proof of concept. Expect rough edges, and expect things to change.

## Motivation

Pull requests are getting huge, and more and more of them are written by AI. Checks and AI review already catch a lot
of what used to take a reviewer's time. What's left for the human is the part that matters most: understanding the
change and reviewing its fine details. GitHub's PR view isn't built for that kind of close reading, especially not on
a large diff.

coxswain leans heavily on the diff review experience of Linear, but runs locally, on your own
checkout, and lets you bring your own AI subscription: the Claude Code or Codex you already pay for and are signed in
to.

## Features

- **Pull requests as workspaces.** Add a GitHub repository, open any of its PRs, and coxswain checks it out in its
  own git worktree. Code stays on your machine.
- **Build on a branch.** Start a workspace on a new branch, let the agent work, see each turn's diff and what's only
  local versus pushed, then open a draft PR from it.
- **Comments become agent work.** Leave notes on lines of the diff, then _Send all to agent_: the agent implements
  them in the PR's worktree, and its changes show up in the same diff, next to the PR's own. Or _Copy as prompt_ and
  paste them into any other agent.
- **Ask about the code.** Send a comment as a question and the agent answers in the thread, right between the lines
  it's about.
- **Views of the PR.** Ask the agent for a view and it writes one: markdown sections with tables, mermaid diagrams
  and the file diffs they're about embedded, threads and all. A _guide_ sorts the whole diff into themed groups in a
  sensible reading order, with a note on each file and explanations on the tricky lines; generated files go last.
  Ask for a data model or data flow view, or anything else. Each view gets a chip in the canvas bar.
- **Agent reviews, on request.** Ask for a review and the agent leaves findings on lines: bugs, risks and
  suggestions, each its own thread.
- **Claude Code and Codex.** Both run in the agent pane over the [Agent Client Protocol](https://agentclientprotocol.com),
  using your own local installs and sign-ins. Pick the model and the effort per agent.
- **Track what you've reviewed.** Mark file diffs as reviewed; they stay reviewed until their contents change, for
  instance after an agent's edit.
- **Just enough IDE.** Browse the whole file tree, Open Quickly (⌘⇧O), Go to Definition (⌘-click) and Find Usages.
  Back and Forward (⌥⌘← ⌥⌘→) step through what the canvas showed, scroll kept.
- **Command palette.** ⌘K, then `>` and a few letters, runs any action; without `>` it opens a file.
- **Light and dark mode.** Follows your system's appearance automatically.

## Requirements

- [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io), to run from source
- `git`
- The [GitHub CLI](https://cli.github.com), signed in: `gh auth login`. coxswain borrows its token and never stores
  it.
- [Claude Code](https://claude.com/claude-code) (`claude`) and, optionally, [Codex](https://github.com/openai/codex)
  (`codex`), signed in

coxswain checks for these at startup and tells you how to fix anything missing. It is an Electron app and should run
wherever Electron does, but so far it has only been tested on macOS.

## Getting started

On macOS or Linux, install the latest release with:

```sh
curl -fsSL https://raw.githubusercontent.com/sladkoff/coxswain/main/install.sh | sh
```

It puts `coxswain.app` in `/Applications` (or `~/Applications`) on macOS, and the AppImage at `~/.local/bin/coxswain`
on Linux. Add a version to install that one instead: `… | sh -s -- 0.2.0-rc.1`. Run it again to update.

On Windows, or to download by hand, take the build for your system from
[Releases](https://github.com/sladkoff/coxswain/releases). Builds aren't signed yet: on macOS, a downloaded app needs
right-click → _Open_ the first time (or `xattr -cr coxswain.app`); the install script doesn't.

To run from source:

```sh
git clone https://github.com/sladkoff/coxswain.git
cd coxswain
pnpm install   # also downloads Electron
pnpm dev       # run with hot reload
```

`pnpm start` builds and runs without hot reload; `pnpm dist` packages the app into `dist/`. coxswain keeps its clones and worktrees in `~/coxswain/`, and its
own data in a SQLite database in the app's data folder. It stores only what GitHub and git don't have: your notes, the
agent's answers and which files you've reviewed.

## Docs

| Doc                                  | What it holds                                  |
| ------------------------------------ | ---------------------------------------------- |
| [GOALS.md](docs/GOALS.md)            | What coxswain is for, and what it isn't.       |
| [Glossary](docs/context/coxswain.md) | Every term used in the code, UI and docs.      |
| [UX.md](docs/UX.md)                  | The screen layout and open UX questions.       |
| [ADRs](docs/adr/)                    | Architecture decisions, one file each.         |
| [DEVLOG.md](docs/DEVLOG.md)          | What has been built so far, and the tech debt. |

## Contributing

Pull requests are welcome; open an issue first. AI-assisted contributions are fine. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Leonid Rousseau
