import type { Commit } from "../../core/git";
import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { App } from "./App";

// What the canvas shows, as the location's search (ADR 0025). Each change is a history entry, so View > Back and
// Forward step through them. Left out: the defaults (the live file diffs, the Navigator on Diffs, no view chosen).
export type CanvasSearch = {
  thread?: number; // a thread to reveal and scroll to, including in a reviewed file
  ws?: number; // the workspace; Back into another workspace's entry opens it again
  view?: "files"; // the Navigator's toggle on Files
  file?: string; // a whole file, shown in place of the file diffs while the toggle is on Files
  line?: number; // … scrolled to and selected when it's opened, not on Back or Forward
  fileAt?: string; // … at this commit, not the worktree: where Go to Definition or Find Usages found it (ADR 0034)
  at?: string; // the file diff picked in Diffs
  commit?: Commit; // one commit's diff (or an agent turn's) in place of all changes
  // One layer of the diff: what's on GitHub, the commits not pushed yet (ADR 0028), or what isn't committed; left out:
  // all of it.
  scope?: "pushed" | "unpushed" | "uncommitted";
  viewId?: number | null; // the view shown (ADR 0026); null: none, chosen by the user; left out: the newest if not stale
};

// One route: the canvas has no pages, only this state. Memory history: an Electron window has no address bar.
const root = createRootRoute({ component: App, validateSearch: (s): CanvasSearch => s });

export const router = createRouter({
  routeTree: root,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
