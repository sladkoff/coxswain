import type { DatabaseSync } from 'node:sqlite'
import { diffFingerprint } from './git'

// Viewed file diffs (glossary). Each is stored with the fingerprint of the file diff when it was marked, so it
// counts as viewed only while the file diff is unchanged.

// The paths of the workspace's file diffs that are viewed and haven't changed since.
export function listViewed(db: DatabaseSync, workspaceId: number, mergeBase: string): string[] {
  const rows = db.prepare('select path, fingerprint from viewed_files where workspace_id = ?').all(workspaceId) as {
    path: string
    fingerprint: string
  }[]
  return rows.filter((r) => r.fingerprint === diffFingerprint(db, workspaceId, mergeBase, r.path)).map((r) => r.path)
}

export function setViewed(db: DatabaseSync, workspaceId: number, mergeBase: string, path: string, viewed: boolean) {
  if (!viewed) return void db.prepare('delete from viewed_files where workspace_id = ? and path = ?').run(workspaceId, path)
  db.prepare(
    `insert into viewed_files (workspace_id, path, fingerprint) values (?, ?, ?)
     on conflict (workspace_id, path) do update set fingerprint = excluded.fingerprint`,
  ).run(workspaceId, path, diffFingerprint(db, workspaceId, mergeBase, path))
}
