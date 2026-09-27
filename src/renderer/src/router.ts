import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import type { Commit } from "../../core/git";
import { App } from "./App";

// What the canvas shows, as the location's search (ADR 0025). Each change is a history entry, so View > Back and
// Forward step through them. Left out: the defaults (the live file diffs, the Navigator on Diffs, no guide chosen).
export type CanvasSearch = {
  ws?: number; // the workspace; Back into another workspace's entry opens it again
  view?: "files"; // the Navigator's toggle on Files
  file?: string; // a whole file, shown in place of the file diffs while the toggle is on Files
  line?: number; // … scrolled to and selected when it's opened, not on Back or Forward
  at?: string; // the file diff picked in Diffs
  commit?: Commit; // one commit's diff in place of all changes
  guide?: number | null; // the guide shown; null: none, chosen by the user; left out: the newest if not stale
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
