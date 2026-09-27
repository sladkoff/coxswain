import type { Commit } from "../../core/git";
import type { Guide } from "../../core/guides";
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
  guide: Guide | null;
  guides: Guide[]; // newest first
  prHead: string | undefined;
  onShowGuide: (id: number | null) => void; // null: the diff, no guide
  onNewView: () => void;
  onOpenQuickly: () => void;
  onViewOptions: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
};

// The canvas's bar: Files, Commits, Diff, a chip per guide and New View on the left; Back, Forward, Open Quickly and the view options on the right. It also
// drags the window, so it lines up with the agent pane's. ponytail: no tabs row until the canvas shows a second thing.
export function CanvasBar(props: Props) {
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
        title="Show the diff without a guide"
        disabled={!props.ready}
        on={!props.guide}
        onClick={() => props.onShowGuide(null)}
      >
        Diff
      </ToggleButton>
      {props.guides.toReversed().map((g, i) => (
        <ToggleButton
          key={g.id}
          title={`Made ${new Date(g.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} at ${g.head.slice(0, 7)}${g.head === props.prHead ? "" : " (stale)"}`}
          disabled={!props.ready}
          on={g.id === props.guide?.id}
          onClick={() => props.onShowGuide(g.id)}
        >
          Guide {i + 1}
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
