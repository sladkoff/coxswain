import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import type { GitProblem } from "../../../core/git";
import type { GitHubProblem } from "../../../core/github";
import { Button } from "./button";
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
