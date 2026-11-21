import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ADR 0005: the folder coxswain keeps its clones, worktrees, checkouts and downloaded language servers in. ~/coxswain,
// unless COXSWAIN_HOME names another, e.g. for a second coxswain with a COXSWAIN_USER_DATA of its own. That one is made
// and taken by its real path, as git lists worktrees by theirs: through a symlink (macOS's /tmp) coxswain wouldn't know
// its own worktrees.
function named(path: string) {
  mkdirSync(path, { recursive: true });
  return realpathSync(path);
}

export const coxswainHome = process.env.COXSWAIN_HOME
  ? named(resolve(process.env.COXSWAIN_HOME))
  : join(homedir(), "coxswain");
