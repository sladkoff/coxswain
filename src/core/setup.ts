import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeOnPath } from "./agents";
import { ghToken } from "./github";

// A tool coxswain needs that is missing or not set up, with how to fix it.
export type SetupProblem = { tool: "git" | "gh" | "claude"; problem: string; fix: string };
export type SetupCheck = { problems: SetupProblem[]; path: string };

// The startup check: git, the GitHub CLI signed in, and Claude Code, all on the PATH the app was started with.
// Local only, so it passes offline. ponytail: doesn't check that `claude` is signed in; its first turn says so.
export async function checkSetup(): Promise<SetupCheck> {
  const problems: SetupProblem[] = [];
  try {
    await promisify(execFile)("git", ["--version"]);
  } catch {
    problems.push({
      tool: "git",
      problem: "git is not installed or not on PATH.",
      fix: "xcode-select --install",
    });
  }
  try {
    if (!(await ghToken()))
      problems.push({
        tool: "gh",
        problem: "The GitHub CLI is not signed in.",
        fix: "gh auth login",
      });
  } catch {
    problems.push({
      tool: "gh",
      problem: "The GitHub CLI (gh) is not installed or not on PATH.",
      fix: "brew install gh && gh auth login",
    });
  }
  try {
    claudeOnPath();
  } catch {
    problems.push({
      tool: "claude",
      problem: "Claude Code (claude), the agent, is not installed or not on PATH.",
      fix: "curl -fsSL https://claude.ai/install.sh | bash",
    });
  }
  return { problems, path: process.env.PATH ?? "" };
}
