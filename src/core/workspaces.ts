import type { DatabaseSync } from 'node:sqlite'

// A workspace is a unit of work in a project; for now always a PR being reviewed.
// Its worktree's path follows from its IDs (git.ts worktreePath), so it isn't stored.
// ponytail: add a kind column when local iterations arrive.
export type Workspace = { id: number; projectId: number; prNumber: number; lastOpenedAt: string }

const columns = 'id, project_id as projectId, pr_number as prNumber, last_opened_at as lastOpenedAt'

// In the order they were added, so icons don't move; the most recently opened one is current.
export function listWorkspaces(db: DatabaseSync, projectId: number): Workspace[] {
  return db
    .prepare(`select ${columns} from workspaces where project_id = ? order by id`)
    .all(projectId) as Workspace[]
}

// Adds the PR's workspace if it's new, and makes it the current one.
export function openPullRequestWorkspace(db: DatabaseSync, projectId: number, prNumber: number): Workspace {
  return db
    .prepare(
      `insert into workspaces (project_id, pr_number, last_opened_at) values (?, ?, ?)
       on conflict (project_id, pr_number) do update set last_opened_at = excluded.last_opened_at
       returning ${columns}`,
    )
    .get(projectId, prNumber, new Date().toISOString()) as Workspace
}

// The repository and PR a workspace is about.
export function getWorkspaceRepo(db: DatabaseSync, workspaceId: number) {
  const row = db
    .prepare(
      `select p.owner, p.name, w.pr_number as prNumber from workspaces w
       join projects p on p.id = w.project_id where w.id = ?`,
    )
    .get(workspaceId) as { owner: string; name: string; prNumber: number } | undefined
  if (!row) throw new Error(`No workspace ${workspaceId}`)
  return row
}
