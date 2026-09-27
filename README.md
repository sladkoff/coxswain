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
- **Comments become agent work.** Leave notes on lines of the diff, then _Send all to agent_: the agent implements
  them in the PR's worktree, and its changes show up in the same diff, next to the PR's own.
- **Ask about the code.** Send a comment as a question and the agent answers in the thread, right between the lines
  it's about.
- **Guided reviews.** Ask the agent for a guide and it sorts the diff into themed groups in a sensible reading order,
  with a note on each file and explanations on the tricky lines. Generated files go last.
- **Agent reviews, on request.** Ask for a review and the agent leaves findings on lines: bugs, risks and
  suggestions, each its own thread.
- **Claude Code and Codex.** Both run in the agent pane over the [Agent Client Protocol](https://agentclientprotocol.com),
  using your own local installs and sign-ins. Pick the model and the effort per agent.
- **Track what you've reviewed.** Mark file diffs as reviewed; they stay reviewed until their contents change, for
  instance after an agent's edit.
- **Just enough IDE.** Browse the whole file tree, Open Quickly (⌘⇧O), Go to Definition (⌘-click) and Find Usages.
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

Download the build for your system from [Releases](https://github.com/sladkoff/coxswain/releases). Builds aren't
signed yet: on macOS, right-click the app and choose _Open_ the first time (or run `xattr -cr coxswain.app`).

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
