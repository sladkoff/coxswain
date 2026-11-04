import { match, P } from "ts-pattern";
import type { Db } from "./db";
import { checkGitHub } from "./watch.ts";
import { onEvent } from "./events.ts";
import { startReviewDiscovery } from "./review-discovery.ts";
import { ensureGuide } from "./guides.ts";

// ADR 0038: what coxswain does in the background, and what sets it off: the one place a core event starts a job.
// Each job decides whether the current range needs an update.
export function startBackground(db: Db) {
  const opened = new Set<number>();
  let stopped = false;
  let checking = false;
  // Check sequentially so a large workspace list cannot flood git/GitHub with concurrent fetches.
  const refreshWorkspaces = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const workspaces = await db.selectFrom("workspaces").select("id").execute();
      for (const { id } of workspaces) {
        if (stopped) break;
        await checkGitHub(db, id).catch(() => {});
      }
    } finally {
      checking = false;
    }
  };
  const refresh = () => void refreshWorkspaces().catch(console.error);
  const timer = setInterval(refresh, 60_000);
  refresh();
  const stopDiscovery = startReviewDiscovery(db);
  const unsubscribe = onEvent((e) =>
    match(e)
      // Guides follow changes: the worktree was opened, its HEAD moved, an agent's turn ended.
      .with({ what: P.union("opened", "worktree"), workspaceId: P.select() }, (id) => {
        opened.add(id);
        void ensureGuide(db, id);
      })
      .with({ what: "guide" }, (e) => void ensureGuide(db, e.workspaceId, true, e.override))
      .with({ what: "github", workspaceId: P.select() }, (id) => void ensureGuide(db, id))
      .with({ what: "settings" }, () => {
        for (const id of opened) void ensureGuide(db, id);
      })
      .with(
        {
          what: P.union(
            "entries",
            "transcript",
            "sessions",
            "view",
            "reviewed",
            "projects",
            "workspaces",
            "commands",
            "guide-state",
          ),
        },
        () => {},
      )
      .exhaustive(),
  );
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    stopDiscovery();
  };
}
