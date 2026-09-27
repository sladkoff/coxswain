import type { Commit } from "../../core/git";
import type { View } from "../../core/views";
import { Button, ToggleButton } from "./components/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CogIcon,
  LayersPlusIcon,
  SearchIcon,
} from "./components/icons";
import { cn, divider, titleBar } from "./components/styles";

type Props = {
  files: number | undefined; // how many file diffs are on the canvas
  leftPane: "files" | "commits" | null;
  onToggleLeftPane: (pane: "files" | "commits") => void;
  ready: boolean; // the PR's commits are loaded, so Commits and the views can open
  commit: Commit | null;
  view: View | null;
  views: View[]; // newest first
  prHead: string | undefined;
  onShowView: (id: number | null) => void; // null: the diff, no view
  onRemoveView: (view: View, label: string) => void;
  onNewView: () => void;
  onOpenQuickly: () => void;
  onViewOptions: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
};

// The canvas's bar: Files, Commits, Diff, a chip per view and New View on the left; Back, Forward, Open Quickly and the view options on the right. It also
// drags the window, so it lines up with the agent pane's. ponytail: no tabs row until the canvas shows a second thing.
export function CanvasBar(props: Props) {
  const titles = viewTitles(props.views);
  return (
    <div
      className={cn(
        titleBar,
        "gap-1 border-b px-2 text-xs [&_button]:[-webkit-app-region:no-drag]",
        divider,
      )}
    >
      <ToggleButton
        title="Show or hide the files (⌘B)"
        on={props.leftPane === "files"}
        onClick={() => props.onToggleLeftPane("files")}
      >
        Files {props.files ?? ""}
      </ToggleButton>
      <ToggleButton
        title="Show or hide the commits, to see one commit's changes"
        disabled={!props.ready}
        className="max-w-80 truncate"
        on={props.leftPane === "commits" || !!props.commit}
        onClick={() => props.onToggleLeftPane("commits")}
      >
        {props.commit ? `${props.commit.sha.slice(0, 7)} ${props.commit.subject}` : "Commits"}
      </ToggleButton>
      <ToggleButton
        title="Show the diff without a view"
        disabled={!props.ready}
        on={!props.view}
        onClick={() => props.onShowView(null)}
      >
        Diff
      </ToggleButton>
      {props.views.toReversed().map((v) => (
        <ToggleButton
          key={v.id}
          title={`Made ${new Date(v.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} at ${v.head.slice(0, 7)}${v.head === props.prHead ? "" : " (stale)"}`}
          disabled={!props.ready}
          className="max-w-40 truncate"
          on={v.id === props.view?.id}
          onClick={() => props.onShowView(v.id)}
          onContextMenu={async () => {
            if ((await window.coxswain.showViewChipMenu()) === "remove")
              props.onRemoveView(v, titles.get(v.id)!);
          }}
        >
          {titles.get(v.id)}
        </ToggleButton>
      ))}
      <Button
        variant="ghost"
        title="New view"
        className="rounded border border-dashed border-neutral-400 px-1.5 dark:border-neutral-600 py-0.5 text-neutral-500"
        disabled={!props.ready}
        onClick={props.onNewView}
      >
        <LayersPlusIcon />
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        title="Back (⌥⌘←)"
        className="p-1 text-neutral-500"
        disabled={!props.canBack}
        onClick={props.onBack}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost"
        title="Forward (⌥⌘→)"
        className="p-1 text-neutral-500"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <ChevronRightIcon />
      </Button>
      <Button
        variant="ghost"
        title="Open Quickly (⌘⇧O)"
        className="p-1 text-neutral-500"
        onClick={props.onOpenQuickly}
      >
        <SearchIcon />
      </Button>
      <Button
        variant="ghost"
        title="View options"
        className="p-1 text-neutral-500"
        onClick={props.onViewOptions}
      >
        <CogIcon />
      </Button>
    </div>
  );
}

// Each view's title by id; a title used by an older view gets a number: Guide, Guide 2, …
export function viewTitles(views: View[]) {
  const oldestFirst = views.toReversed();
  return new Map(
    oldestFirst.map((v, i) => {
      const n = oldestFirst.slice(0, i).filter((o) => o.title === v.title).length;
      return [v.id, n > 0 ? `${v.title} ${n + 1}` : v.title];
    }),
  );
}
