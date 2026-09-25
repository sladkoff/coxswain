import type { Db } from './db'

// A workspace is a unit of work in a project; for now always a PR being reviewed.
// Its worktree's path follows from its IDs (git.ts worktreePath), so it isn't stored.
// ponytail: add a kind column when local iterations arrive.
export type Workspace = { id: number; projectId: number; prNumber: number; lastOpenedAt: string }

const columns = ['id', 'project_id as projectId', 'pr_number as prNumber', 'last_opened_at as lastOpenedAt'] as const

// In the order they were added, so icons don't move; the most recently opened one is current.
export function listWorkspaces(db: Db, projectId: number): Promise<Workspace[]> {
  return db.selectFrom('workspaces').select(columns).where('project_id', '=', projectId).orderBy('id').execute()
}

// Adds the PR's workspace if it's new, and makes it the current one.
export function openPullRequestWorkspace(db: Db, projectId: number, prNumber: number): Promise<Workspace> {
  return db
    .insertInto('workspaces')
    .values({ project_id: projectId, pr_number: prNumber, last_opened_at: new Date().toISOString() })
    .onConflict((oc) =>
      oc.columns(['project_id', 'pr_number']).doUpdateSet((eb) => ({ last_opened_at: eb.ref('excluded.last_opened_at') })),
    )
    .returning(columns)
    .executeTakeFirstOrThrow()
}

// The repository and PR a workspace is about.
export async function getWorkspaceRepo(db: Db, workspaceId: number) {
  const row = await db
    .selectFrom('workspaces as w')
    .innerJoin('projects as p', 'p.id', 'w.project_id')
    .select(['p.owner', 'p.name', 'w.pr_number as prNumber'])
    .where('w.id', '=', workspaceId)
    .executeTakeFirst()
  if (!row) throw new Error(`No workspace ${workspaceId}`)
  return row
}
