import type { Db } from "./db";
import { workspaceEntries, type Row } from "./entries.ts";
import { emit } from "./events.ts";

// Capture the whole conversation so a reply or edit during generation invalidates its assessment.
export async function resolutionCandidates(db: Db, workspaceId: number) {
  const entries = await workspaceEntries(db, workspaceId);
  return entries
    .filter((e) => !e.parentId && !e.resolvedAt && e.path && e.kind !== "explanation")
    .map((root) => ({
      id: root.id,
      entries: entries.filter((e) => e.id === root.id || e.parentId === root.id),
    }));
}
export type ResolutionCandidate = { id: number; entries: Row[] };

export function parseResolutions(value: unknown, candidates: ResolutionCandidate[]) {
  if (!Array.isArray(value)) throw new Error("resolutions must be an array");
  const seen = new Set<number>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid thread resolution");
    const { thread_id: id, summary } = item as Record<string, unknown>;
    if (
      typeof id !== "number" ||
      !candidates.some((c) => c.id === id) ||
      seen.has(id) ||
      typeof summary !== "string" ||
      !summary.trim() ||
      summary.trim().length > 1000
    )
      throw new Error(
        "Each resolution needs a unique candidate thread_id and a short nonempty summary",
      );
    seen.add(id);
    return { id, summary: summary.trim() };
  });
}

// Automatic assessments are local review state; Submit Review owns their publication to GitHub.
export async function applyResolutions(
  db: Db,
  workspaceId: number,
  candidates: ResolutionCandidate[],
  resolutions: { id: number; summary: string }[],
) {
  await db.transaction().execute(async (tx) => {
    const current = await resolutionCandidates(tx, workspaceId);
    for (const resolution of resolutions) {
      const before = candidates.find((c) => c.id === resolution.id);
      const now = current.find((c) => c.id === resolution.id);
      if (!now || JSON.stringify(before) !== JSON.stringify(now)) continue;
      await tx
        .updateTable("entries")
        .set({ resolved_at: new Date().toISOString(), resolution_summary: resolution.summary })
        .where("id", "=", resolution.id)
        .execute();
    }
  });
  if (resolutions.length) emit({ workspaceId, what: "entries" });
}
