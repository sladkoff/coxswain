import type { Db } from './db'
import { diffFingerprints } from './git'

// Viewed file diffs (glossary). Each is stored with the fingerprint of the file diff's contents when it was marked
// (ADR 0014), so it counts as viewed only while those are unchanged. head: a pinned range's (a guide's); without it,
// the worktree's (the live Diff tab).
// ponytail: rows for fingerprints no longer in use stay; prune them if the table ever matters.

// The paths of the workspace's file diffs that are viewed and haven't changed since.
export async function listViewed(db: Db, workspaceId: number, base: string, head?: string): Promise<string[]> {
  const rows = await db.selectFrom('viewed_files').select(['path', 'fingerprint']).where('workspace_id', '=', workspaceId).execute()
  const now = await diffFingerprints(db, workspaceId, base, [...new Set(rows.map((r) => r.path))], head)
  return [...new Set(rows.filter((r) => r.fingerprint === now.get(r.path)).map((r) => r.path))]
}

export async function setViewed(db: Db, workspaceId: number, base: string, path: string, viewed: boolean, head?: string) {
  const fingerprint = (await diffFingerprints(db, workspaceId, base, [path], head)).get(path)!
  if (viewed)
    await db.insertInto('viewed_files').orIgnore().values({ workspace_id: workspaceId, path, fingerprint }).execute()
  else
    await db
      .deleteFrom('viewed_files')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', path)
      .where('fingerprint', '=', fingerprint)
      .execute()
}
