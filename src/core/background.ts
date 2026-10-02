import { match } from "ts-pattern";
import type { Db } from "./db";
import { onEvent } from "./events.ts";
import { isAsking } from "./review";
import { concludeAhead } from "./review-draft.ts";
import { summariseAhead } from "./summaries.ts";

// ADR 0038: what coxswain does in the background, and what sets it off: the one place a core event starts a job.
// Each is work ahead, which Settings can turn off, and decides for itself whether there's anything to do.
export function startBackground(db: Db) {
  return onEvent((e) =>
    match(e.what)
      // Committed changes are summarised: the worktree was opened, its HEAD moved, an agent's turn ended.
      .with("opened", "worktree", () => void summariseAhead(db, e.workspaceId))
      // Threads that changed are concluded, for Submit Review.
      .with("entries", () => concludeAhead(db, e.workspaceId, isAsking))
      .with("transcript", "sessions", "view", () => {})
      .exhaustive(),
  );
}
