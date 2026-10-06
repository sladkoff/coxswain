import { match, P } from "ts-pattern";
import type { Db } from "./db";
import { onEvent } from "./events.ts";
import { summariseAhead } from "./summaries.ts";

// ADR 0038: what coxswain does in the background, and what sets it off: the one place a core event starts a job.
// Each is work ahead, which Settings can turn off, and decides for itself whether there's anything to do.
export function startBackground(db: Db) {
  return onEvent((e) =>
    match(e)
      // Committed changes are summarised: the worktree was opened, its HEAD moved, an agent's turn ended.
      .with(
        { what: P.union("opened", "worktree"), workspaceId: P.select() },
        (id) => void summariseAhead(db, id),
      )
      .with(
        {
          what: P.union(
            "entries",
            "transcript",
            "sessions",
            "view",
            "reviewed",
            "github",
            "projects",
            "workspaces",
            "settings",
            "commands",
          ),
        },
        () => {},
      )
      .exhaustive(),
  );
}
