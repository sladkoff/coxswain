import type { DatabaseSync } from 'node:sqlite'
import { diffFingerprints } from './git'

// Viewed file diffs (glossary). Each is stored with the fingerprint of the file diff's contents when it was marked
// (ADR 0014), so it counts as viewed only while those are unchanged. head: a pinned range's (a guide's); without it,
// the worktree's (the live Diff tab).
// ponytail: rows for fingerprints no longer in use stay; prune them if the table ever matters.

// The paths of the workspace's file diffs that are viewed and haven't changed since.
export async function listViewed(db: DatabaseSync, workspaceId: number, base: string, head?: string): Promise<string[]> {
  const rows = db.prepare('select path, fingerprint from viewed_files where workspace_id = ?').all(workspaceId) as {
    path: string
    fingerprint: string
  }[]
  const now = await diffFingerprints(db, workspaceId, base, [...new Set(rows.map((r) => r.path))], head)
  return [...new Set(rows.filter((r) => r.fingerprint === now.get(r.path)).map((r) => r.path))]
}

export async function setViewed(db: DatabaseSync, workspaceId: number, base: string, path: string, viewed: boolean, head?: string) {
  const fingerprint = (await diffFingerprints(db, workspaceId, base, [path], head)).get(path)!
  if (viewed)
    db.prepare('insert or ignore into viewed_files (workspace_id, path, fingerprint) values (?, ?, ?)').run(
      workspaceId,
      path,
      fingerprint,
    )
  else db.prepare('delete from viewed_files where workspace_id = ? and path = ? and fingerprint = ?').run(workspaceId, path, fingerprint)
}
