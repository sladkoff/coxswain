import type { Db } from "./db";
import { emit } from "./events.ts";

// A workspace is a unit of work in a project (ADR 0028): a PR, or a branch started in coxswain, which gets a PR once
// one is opened for it. Its worktree's path follows from its repository and its branch or PR number (git.ts
// worktreePath), so it isn't stored.
// branch, baseBranch: set for a workspace started on a branch, kept once it has a PR. A PR's branch comes from GitHub.
export type Workspace = {
  id: number;
  projectId: number;
  prNumber: number | null;
  branch: string | null;
  baseBranch: string | null;
  lastOpenedAt: string;
};

const columns = [
  "id",
  "project_id as projectId",
  "pr_number as prNumber",
  "branch",
  "base_branch as baseBranch",
  "last_opened_at as lastOpenedAt",
] as const;

// In the order they were added, so icons don't move; the most recently opened one is current.
export function listWorkspaces(db: Db, projectId: number): Promise<Workspace[]> {
  return db
    .selectFrom("workspaces")
    .select(columns)
    .where("project_id", "=", projectId)
    .orderBy("id")
    .execute();
}

const now = () => new Date().toISOString();

// Makes a workspace the current one.
export async function openWorkspace(db: Db, workspaceId: number): Promise<void> {
  await db
    .updateTable("workspaces")
    .set({ last_opened_at: now() })
    .where("id", "=", workspaceId)
    .execute();
  emit({ what: "workspaces" });
}

// Adds the PR's workspace if it's new, and makes it the current one. A workspace on the PR's head branch becomes the
// PR's, so its worktree isn't taken from it.
export async function openPullRequestWorkspace(
  db: Db,
  projectId: number,
  prNumber: number,
  headRef: string,
): Promise<Workspace> {
  const onBranch = await db
    .updateTable("workspaces")
    .set({ pr_number: prNumber, last_opened_at: now() })
    .where("project_id", "=", projectId)
    .where("branch", "=", headRef)
    .where("pr_number", "is", null)
    .returning(columns)
    .executeTakeFirst();
  const workspace =
    onBranch ??
    (await db
      .insertInto("workspaces")
      .values({ project_id: projectId, pr_number: prNumber, last_opened_at: now() })
      .onConflict((oc) =>
        oc
          .columns(["project_id", "pr_number"])
          .doUpdateSet((eb) => ({ last_opened_at: eb.ref("excluded.last_opened_at") })),
      )
      .returning(columns)
      .executeTakeFirstOrThrow());
  emit({ what: "workspaces" });
  return workspace;
}

// Git's rules for a branch name (git check-ref-format --branch), the ones a typed name breaks; and a name git can't
// take for an option. Both come from the user, and go to git as arguments.
export function branchNameProblem(name: string): string | null {
  if (!name) return "Give the branch a name";
  const control = [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (control || name === "@" || /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$|\/\./.test(name))
    return `“${name}” isn't a valid branch name`;
  return null;
}

// Adds a workspace on a branch, new or already on GitHub, and makes it the current one. Its worktree branches off
// baseBranch when it's opened, unless the branch exists (git.ts openWorktree).
export async function openBranchWorkspace(
  db: Db,
  projectId: number,
  branch: string,
  baseBranch: string,
): Promise<Workspace> {
  const problem =
    branchNameProblem(branch) ??
    branchNameProblem(baseBranch) ??
    (branch === baseBranch ? "The branch must differ from the one it starts from" : null);
  if (problem) throw new Error(problem);
  const workspace = await db
    .insertInto("workspaces")
    .values({
      project_id: projectId,
      branch,
      base_branch: baseBranch,
      last_opened_at: now(),
    })
    .onConflict((oc) =>
      oc
        .columns(["project_id", "branch"])
        .doUpdateSet((eb) => ({ last_opened_at: eb.ref("excluded.last_opened_at") })),
    )
    .returning(columns)
    .executeTakeFirstOrThrow();
  emit({ what: "workspaces" });
  return workspace;
}

// A branch workspace's PR, once one is opened for its branch (here or on GitHub).
export async function setWorkspacePullRequest(db: Db, workspaceId: number, prNumber: number) {
  await db
    .updateTable("workspaces")
    .set({ pr_number: prNumber })
    .where("id", "=", workspaceId)
    .execute();
  emit({ what: "workspaces" });
}

// The repository a workspace is about, and its PR or branch.
export async function getWorkspaceRepo(db: Db, workspaceId: number) {
  const row = await db
    .selectFrom("workspaces as w")
    .innerJoin("projects as p", "p.id", "w.project_id")
    .select([
      "p.owner",
      "p.name",
      "w.pr_number as prNumber",
      "w.branch",
      "w.base_branch as baseBranch",
    ])
    .where("w.id", "=", workspaceId)
    .executeTakeFirst();
  if (!row) throw new Error(`No workspace ${workspaceId}`);
  return row;
}

// Takes the workspace out of the sidebar, with its entries, reviewed files and agent sessions (the cascade). The
// worktree stays on disk; adding the PR or branch again adopts it (git.ts).
export async function removeWorkspace(db: Db, workspaceId: number): Promise<void> {
  await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
  emit({ what: "workspaces" });
}
