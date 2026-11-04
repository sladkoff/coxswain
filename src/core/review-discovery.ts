import { dismissedPullRequestKey } from "./workspaces.ts";
import type { Db } from "./db";
import { emit, onEvent } from "./events.ts";
import { listDirectReviewRequests } from "./github.ts";

const preferenceKey = "auto-review-workspaces";
export async function getAutoReviewWorkspaces(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", preferenceKey)
    .executeTakeFirst();
  return row?.value !== "false";
}
export async function setAutoReviewWorkspaces(db: Db, enabled: boolean): Promise<void> {
  const value = String(enabled === true);
  await db
    .insertInto("settings")
    .values({ key: preferenceKey, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
  emit({ what: "settings" });
}

// Like the remote watcher, discovery owns its cadence in the core. No checkout or agent is started.
export function startReviewDiscovery(db: Db) {
  let stopped = false;
  let running = false;
  const check = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (!(await getAutoReviewWorkspaces(db))) return;
      const projects = await db.selectFrom("projects").select(["id", "github"]).execute();
      for (const project of projects) {
        if (stopped) break;
        if (!project.github) continue;
        const [owner, repo] = project.github.split("/");
        const result = await listDirectReviewRequests(owner, repo);
        if (result.status !== "ok") continue;
        for (const pr of result.pulls) {
          if (stopped || !(await getAutoReviewWorkspaces(db))) break;
          const dismissed = await db
            .selectFrom("settings")
            .select("key")
            .where("key", "=", dismissedPullRequestKey(project.id, pr.number))
            .executeTakeFirst();
          if (dismissed) continue;
          const existing = await db
            .selectFrom("workspaces")
            .select("id")
            .where("project_id", "=", project.id)
            .where((eb) => eb.or([eb("pr_number", "=", pr.number), eb("branch", "=", pr.headRef)]))
            .executeTakeFirst();
          if (existing) continue;
          const added = await db
            .insertInto("workspaces")
            .values({
              project_id: project.id,
              pr_number: pr.number,
              last_opened_at: "1970-01-01T00:00:00.000Z",
            })
            .onConflict((oc) => oc.columns(["project_id", "pr_number"]).doNothing())
            .returning("id")
            .executeTakeFirst();
          if (added) emit({ what: "workspaces" });
        }
      }
    } finally {
      running = false;
    }
  };
  const refresh = () => void check().catch(console.error);
  const unsubscribe = onEvent((e) => {
    if (e.what === "projects" || e.what === "settings") refresh();
  });
  const timer = setInterval(refresh, 60_000);
  refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
}
