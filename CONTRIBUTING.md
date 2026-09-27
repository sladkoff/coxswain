# Contributing to coxswain

Thanks for wanting to help. coxswain is a proof of concept, so things move fast and break often.

## Issues first

Pull requests are welcome, but **open an issue before you start**, for bugs and features alike. Say what you want to
change and why; it saves you building something that doesn't fit. Small fixes (typos, obvious bugs) can go straight
to a PR.

## Using AI

AI coding agents are welcome here; coxswain is built with them. You are still the author: read and understand every
line you submit, and be ready to explain it in review. [AGENTS.md](AGENTS.md) is written for agents and humans alike,
so point your agent at it.

## Before you open a PR

1. Read [AGENTS.md](AGENTS.md). It lists the docs that are the source of truth and the architecture rules.
2. Keep the docs current in the same PR: new terms in [the glossary](docs/context/coxswain.md), decisions in an
   [ADR](docs/adr/), UX changes in [UX.md](docs/UX.md), and a line in [the devlog](docs/DEVLOG.md).
3. Run the checks and try the change in the running app:

   ```sh
   pnpm typecheck
   pnpm lint
   pnpm format
   pnpm build
   pnpm dev
   ```

4. Keep PRs small and about one thing.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
