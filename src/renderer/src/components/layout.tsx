import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import type { GitProblem } from "../../../core/git";
import type { GitHubProblem } from "../../../core/github";
import { Button } from "./button";
import { SearchIcon, XIcon } from "./icons";
import { cn, divider, muted, noDrag, titleBar } from "./styles";
import { ProblemMessage } from "./text";

// A full-window screen (Settings, Projects, New workspace): its title bar, then a centred column.
export function Screen(props: {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col select-none text-sm">
      <ScreenHeader title={props.title} onClose={props.onClose} />
      <div className={cn("mx-auto flex min-h-0 w-full flex-1 flex-col p-6", props.className)}>
        {props.children}
      </div>
    </div>
  );
}

// Title bar of a full-window screen; Esc or Done closes it.
function ScreenHeader({ title, onClose }: { title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={cn(titleBar, "justify-between border-b pr-3 pl-20", divider)}>
      <span className="font-medium">{title}</span>
      <Button className={noDrag} onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

// A dialog over the window (Projects, New workspace): a title and a line under it, ✕, then its content. Esc, ✕ or a
// click outside closes it. The backdrop takes the window's drag regions, so a click on it over a title bar closes too.
export function Dialog(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-6 pt-[10vh] dark:bg-black/50",
        noDrag,
      )}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={props.title}
        className="flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-sm shadow-2xl select-none dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pt-3.5 pb-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{props.title}</span>
            {props.subtitle && (
              <span className={cn("truncate text-xs", muted)}>{props.subtitle}</span>
            )}
          </div>
          <Button
            variant="ghost"
            title="Close (Esc)"
            aria-label="Close"
            className="-mr-1 p-1 text-neutral-500"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

// A dialog's search field: a magnifier and a borderless input across the dialog, a line under it.
export function SearchField(props: ComponentProps<"input">) {
  return (
    <label className={cn("flex shrink-0 items-center gap-2 border-y px-4 py-2", divider)}>
      <span className={muted}>
        <SearchIcon />
      </span>
      <input
        {...props}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-500"
      />
    </label>
  );
}

// A section's small heading in a dialog's list.
export function ListHeading({ children }: { children: ReactNode }) {
  return (
    <div className={cn("px-2 pt-3 pb-1 text-[10.5px] font-semibold tracking-wide", muted)}>
      {children}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("rounded-lg border p-4", divider, className)} />;
}

// A problem loading a list, and a button to load it again.
export function ProblemCard({
  problem,
  onRetry,
}: {
  problem: GitHubProblem | GitProblem;
  onRetry: () => void;
}) {
  return (
    <Card className="flex items-center gap-3">
      <ProblemMessage problem={problem} />
      <Button className="ml-auto shrink-0" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

// A pickable row in a full-window list.
export function ListRow({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={cn(
        "block w-full rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        className,
      )}
    />
  );
}

// A short message in the middle of an empty pane: loading, nothing to show.
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center text-xs", muted)}>{children}</div>
  );
}

export function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800",
        className,
      )}
    >
      <div className="h-full bg-green-600" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}

// Drag handle on the border between a side pane and the Viewer; resizes the side pane, which is on its left (or
// right, with `fromRight`). The Viewer never gets narrower than `viewerMin`.
export const viewerMin = 320;
export function Splitter(props: {
  min: number;
  max: number;
  fromRight?: boolean;
  onResize: (w: number) => void;
}) {
  const start = useRef<{ x: number; width: number; max: number } | null>(null);
  return (
    <div
      className={cn("relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize", noDrag)}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        const [pane, viewer] = props.fromRight
          ? [el.nextElementSibling, el.previousElementSibling]
          : [el.previousElementSibling, el.nextElementSibling];
        if (!pane || !viewer) return;
        // Measured, not taken from state: the pane may have shrunk with the window.
        const width = pane.clientWidth;
        el.setPointerCapture(e.pointerId);
        start.current = {
          x: e.clientX,
          width,
          max: Math.min(props.max, width + viewer.clientWidth - viewerMin),
        };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = (e.clientX - s.x) * (props.fromRight ? -1 : 1);
        props.onResize(Math.max(props.min, Math.min(s.max, s.width + dx)));
      }}
      onLostPointerCapture={() => (start.current = null)}
    />
  );
}
