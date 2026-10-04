import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeOnPath } from "./agents";

// A tool coxswain needs that is missing or not set up, with how to fix it.
export type SetupProblem = { tool: "git" | "claude"; problem: string; fix: string };
export type SetupCheck = { problems: SetupProblem[]; path: string };

// The startup check: git and Claude Code, on the PATH the app was started with. Local only, so it passes offline. The
// GitHub CLI isn't checked: a project needn't be on GitHub (ADR 0040), and where GitHub is used it says what's wrong. ponytail: doesn't check that `claude` is signed in; its first turn says so.
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
