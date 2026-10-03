import type { Db } from "./db";
import { emit } from "./events.ts";
import { diffFingerprints } from "./git.ts";

// Reviewed files and file diffs (glossary). Each is stored with the fingerprint of the file diff's contents when it was marked
// (ADR 0014), so it counts as reviewed only while those are unchanged. head: a pinned range's (a view's); without it,
// the worktree's (the live diff). Whole files use a separate fingerprint of their contents, independent of base.
// ponytail: rows for fingerprints no longer in use stay; prune them if the table ever matters.

// The paths of the workspace's file diffs that are reviewed and haven't changed since.
export async function listReviewed(
  db: Db,
  workspaceId: number,
  base: string,
  head?: string,
  kind: "diff" | "file" = "diff",
): Promise<string[]> {
  const rows = await db
    .selectFrom("reviewed_files")
    .select(["path", "fingerprint"])
    .where("workspace_id", "=", workspaceId)
    .execute();
  const now = await diffFingerprints(
    db,
    workspaceId,
    base,
    [...new Set(rows.map((r) => r.path))],
    head,
    kind,
  );
  return [...new Set(rows.filter((r) => r.fingerprint === now.get(r.path)).map((r) => r.path))];
}

export async function setReviewed(
  db: Db,
  workspaceId: number,
  base: string,
  path: string,
  reviewed: boolean,
  head?: string,
  kind: "diff" | "file" = "diff",
) {
  const fingerprint = (await diffFingerprints(db, workspaceId, base, [path], head, kind)).get(
    path,
  )!;
  if (reviewed)
    await db
      .insertInto("reviewed_files")
      .orIgnore()
      .values({ workspace_id: workspaceId, path, fingerprint })
      .execute();
  else
    await db
      .deleteFrom("reviewed_files")
      .where("workspace_id", "=", workspaceId)
      .where("path", "=", path)
      .where("fingerprint", "=", fingerprint)
      .execute();
  emit({ workspaceId, what: "reviewed" });
}
