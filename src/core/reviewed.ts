import type { Db } from "./db";
import { emit } from "./events.ts";
import { diffFingerprints, compatibleDiffFingerprints, listChangedFiles } from "./git.ts";

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
  const accepted = await acceptedFingerprints(db, workspaceId, base, rows, head, kind);
  return [
    ...new Set(rows.filter((r) => accepted.get(r.path)?.has(r.fingerprint)).map((r) => r.path)),
  ];
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
  if (reviewed) {
    await db
      .insertInto("reviewed_files")
      .orIgnore()
      .values({ workspace_id: workspaceId, path, fingerprint })
      .execute();
    if (kind === "diff")
      await saveBaselines(db, workspaceId, new Map([[path, fingerprint]]), false);
  } else {
    const rows = await db
      .selectFrom("reviewed_files")
      .select(["path", "fingerprint"])
      .where("workspace_id", "=", workspaceId)
      .where("path", "=", path)
      .execute();
    const accepted = await acceptedFingerprints(db, workspaceId, base, rows, head, kind);
    await db
      .deleteFrom("reviewed_files")
      .where("workspace_id", "=", workspaceId)
      .where("path", "=", path)
      .where("fingerprint", "in", [...(accepted.get(path) ?? new Set([fingerprint]))])
      .execute();
  }
  emit({ workspaceId, what: "reviewed" });
}

async function acceptedFingerprints(
  db: Db,
  workspaceId: number,
  base: string,
  rows: { path: string; fingerprint: string }[],
  head: string | undefined,
  kind: "diff" | "file",
): Promise<Map<string, Set<string>>> {
  const paths = [...new Set(rows.map((row) => row.path))];
  if (kind === "diff" && rows.some((row) => /^[a-f0-9]{40}$/.test(row.fingerprint))) {
    const [jobs, views] = await Promise.all([
      db
        .selectFrom("jobs")
        .select("base")
        .distinct()
        .where("workspace_id", "=", workspaceId)
        .execute(),
      db
        .selectFrom("views")
        .select("base")
        .distinct()
        .where("workspace_id", "=", workspaceId)
        .execute(),
    ]);
    return compatibleDiffFingerprints(
      db,
      workspaceId,
      base,
      paths,
      head,
      [...jobs, ...views].map((row) => row.base),
    );
  }
  const now = await diffFingerprints(db, workspaceId, base, paths, head, kind);
  return new Map([...now].map(([path, hash]) => [path, new Set([hash])]));
}

type ReviewRange = { base: string; head: string };
const baselineKey = (workspaceId: number) => `review.change-baselines.${workspaceId}`;
async function readBaselines(db: Db, workspaceId: number): Promise<Record<string, string>> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", baselineKey(workspaceId))
    .executeTakeFirst();
  return Object.assign(Object.create(null), row ? JSON.parse(row.value) : {});
}
async function saveBaselines(
  db: Db,
  workspaceId: number,
  values: Map<string, string>,
  onlyMissing: boolean,
) {
  if (!values.size) return;
  await db.transaction().execute(async (tx) => {
    const baselines = await readBaselines(tx, workspaceId);
    for (const [path, fingerprint] of values) {
      if (!onlyMissing || !Object.hasOwn(baselines, path)) baselines[path] = fingerprint;
    }
    const key = baselineKey(workspaceId);
    const value = JSON.stringify(baselines);
    await tx
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
      .execute();
  });
}

// Called before replacing a Guide; its publisher emits the view change after completion.
// Keep the first observed contents until Reviewed explicitly acknowledges a newer version.
export async function rememberGuideReviewBaseline(db: Db, workspaceId: number, next: ReviewRange) {
  const previous = await db
    .selectFrom("views")
    .select(["base", "head"])
    .where("workspace_id", "=", workspaceId)
    .where("guide", "=", 1)
    .orderBy("id", "desc")
    .executeTakeFirst();
  const files = await listChangedFiles(db, workspaceId, next.base, next.head);
  if (files.status !== "ok") throw new Error(files.message);
  const range = previous ?? next;
  const fingerprints = await diffFingerprints(
    db,
    workspaceId,
    range.base,
    files.files.map((f) => f.path),
    range.head,
  );
  await saveBaselines(db, workspaceId, fingerprints, true);
}

export async function listChangedSinceReview(
  db: Db,
  workspaceId: number,
  base: string,
  head?: string,
): Promise<string[]> {
  const [baselines, rows] = await Promise.all([
    readBaselines(db, workspaceId),
    db
      .selectFrom("reviewed_files")
      .select("path")
      .where("workspace_id", "=", workspaceId)
      .where("fingerprint", "not like", "file:%")
      .execute(),
  ]);
  const candidates = new Set([...Object.keys(baselines), ...rows.map((row) => row.path)]);
  if (!candidates.size) return [];
  const files = await listChangedFiles(db, workspaceId, base, head);
  if (files.status !== "ok") throw new Error(files.message);
  const paths = files.files.map((file) => file.path).filter((path) => candidates.has(path));
  if (!paths.length) return [];
  const [now, reviewed] = await Promise.all([
    diffFingerprints(db, workspaceId, base, paths, head),
    listReviewed(db, workspaceId, base, head),
  ]);
  const priorReview = new Set(rows.map((row) => row.path));
  const currentReview = new Set(reviewed);
  return paths.filter(
    (path) =>
      !currentReview.has(path) &&
      (Object.hasOwn(baselines, path) ? baselines[path] !== now.get(path) : priorReview.has(path)),
  );
}
