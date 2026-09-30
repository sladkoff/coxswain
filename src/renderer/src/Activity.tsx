import { useQuery } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { useEffect, useRef, useState } from "react";
import type { SummaryCoverage, SummaryJob } from "../../core/summaries";
import { Button } from "./components/button";
import { ActivityIcon, SpinnerIcon, StopIcon } from "./components/icons";
import { ProgressBar } from "./components/layout";
import { cn, divider, muted, noDrag } from "./components/styles";
import { ErrorText } from "./components/text";
import { ago, count } from "./format";
import { core } from "./queries";

// Activity (glossary, ADR 0029): what coxswain does in the background, for now file summary jobs. The button at the
// canvas bar's right turns while one runs and gets a red dot when one failed since the list was last looked at; it
// opens the list below it, newest first. Jobs of every workspace show: they run whichever one is on screen.
export function Activity({
  workspaceId,
  onSettings,
}: {
  workspaceId: number;
  onSettings: () => void;
}) {
  const jobs = useQuery(core("listSummaryJobs")).data ?? [];
  const settings = useQuery(core("getSummarySettings")).data;
  const [open, setOpen] = useState(false);
  // ADR 0030: how far the workspace on screen is summarised, counted when the list opens.
  const coverage = useQuery({ ...core("summaryCoverage", workspaceId), enabled: open });
  const [seen, setSeen] = useState(() => new Date().toISOString());
  const box = useRef<HTMLDivElement>(null);
  const running = jobs.some((j) => j.state === "running");
  const failed = jobs.some((j) => j.state === "failed" && j.finishedAt! > seen);
  // Elapsed times tick while a job runs and the list shows.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open || !running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [open, running]);
  useEffect(() => {
    if (!open) return;
    setSeen(new Date().toISOString());
    const close = (e: Event) =>
      (e instanceof KeyboardEvent
        ? e.key === "Escape"
        : !box.current?.contains(e.target as Node)) && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open, jobs]);
  const summariser = settings
    ? `${settings.agent === "claude" ? "Claude Code" : "Codex"} · ${settings.model || "its default model"}`
    : "";
  return (
    <div ref={box} className={cn("relative flex", noDrag)}>
      <Button
        variant="ghost"
        title={running ? "Activity: summarising files" : "Activity"}
        aria-expanded={open}
        className={cn(
          "relative p-1 text-neutral-500",
          open && "bg-neutral-100 dark:bg-neutral-800",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {running ? <SpinnerIcon /> : <ActivityIcon />}
        {failed && !open && (
          <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-red-500" />
        )}
      </Button>
      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-40 mt-1 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-lg border bg-white text-xs shadow-xl dark:bg-neutral-900",
            divider,
          )}
        >
          <div className={cn("flex shrink-0 items-center gap-2 border-b px-3 py-2", divider)}>
            <span className="font-medium">Activity</span>
            <span className={cn("min-w-0 flex-1 truncate", muted)} title="The summary agent">
              File summaries by {summariser}
            </span>
            <Button
              variant="link"
              className={muted}
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              Settings…
            </Button>
          </div>
          <Coverage
            workspace={coverage.data}
            loading={coverage.isFetching}
            ahead={settings?.ahead ?? true}
            running={jobs.some((j) => j.workspaceId === workspaceId && j.state === "running")}
          />
          <div className="min-h-0 overflow-y-auto">
            {jobs.length === 0 ? (
              <div className={cn("px-3 py-3", muted)}>
                No jobs yet. Committed changes are summarised when a workspace opens, when it's
                checked again and when its HEAD moves
                {settings && !settings.ahead ? " (turned off in Settings)" : ""}; uncommitted ones
                when the agent starts a view.
              </div>
            ) : (
              jobs.map((j) => <JobRow key={j.id} job={j} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job: j }: { job: SummaryJob }) {
  const settled = j.reused + j.done + j.failed;
  const seconds = Math.round(
    ((j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt)) / 1000,
  );
  const state = {
    running: "Summarising",
    done: "Summarised",
    failed: "Failed",
    stopped: "Stopped",
  }[j.state];
  return (
    <div className={cn("flex flex-col gap-1 border-b px-3 py-2 last:border-b-0", divider)}>
      <div className="flex items-center gap-2">
        <span className={cn("flex", j.state === "failed" ? "text-red-500" : muted)}>
          {j.state === "running" ? <SpinnerIcon /> : <ActivityIcon />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{state}</span> {j.workspace}
          <span className={muted}> · {j.why === "ahead" ? "ahead" : "for a view"}</span>
        </span>
        <span className={muted} title={new Date(j.startedAt).toLocaleString()}>
          {j.finishedAt ? `${seconds} s, ${ago(j.finishedAt)}` : `${seconds} s`}
        </span>
        {j.state === "running" && (
          <Button
            variant="ghost"
            title="Stop summarising"
            aria-label="Stop summarising"
            className="p-1 text-neutral-500"
            onClick={() => window.coxswain.stopSummaryJob(j.id)}
          >
            <StopIcon />
          </Button>
        )}
      </div>
      <ProgressBar value={settled} max={j.files} failed={j.state === "failed"} />
      <div className={muted}>
        {settled}/{count(j.files, "file")} · {j.reused} had one · {j.done} summarised
        {j.failed > 0 && (
          <span className="text-red-600 dark:text-red-400"> · {j.failed} failed</span>
        )}
      </div>
      <div className={cn("truncate", muted)} title={`${j.base} → ${j.head}`}>
        {j.agent === "claude" ? "Claude Code" : "Codex"} · {j.ranOn ?? (j.model || "default model")}{" "}
        · {count(j.calls, "run")} · {j.base.slice(0, 7)} → {j.head.slice(0, 7)}
      </div>
      {j.now.length > 0 && (
        <div className={cn("truncate font-mono text-[11px]", muted)} title={j.now.join("\n")}>
          {j.now[0]}
          {j.now.length > 1 && ` and ${j.now.length - 1} more`}
        </div>
      )}
      {j.error && (
        <ErrorText>
          {j.state === "done" ? `A run failed and was tried again: ${j.error}` : j.error}
        </ErrorText>
      )}
    </div>
  );
}

// The workspace on screen: how many of its committed file diffs have a summary.
function Coverage(props: {
  workspace: SummaryCoverage | null | undefined;
  loading: boolean;
  ahead: boolean;
  running: boolean;
}) {
  const w = props.workspace;
  if (w === undefined)
    return (
      <div className={cn("shrink-0 border-b px-3 py-2", divider, muted)}>
        {props.loading ? "Counting this workspace's summaries…" : ""}
      </div>
    );
  if (w === null || w.files === 0) return null;
  const all = w.summarised >= w.files;
  return (
    <div className={cn("flex shrink-0 flex-col gap-1 border-b px-3 py-2", divider)}>
      <div className="flex items-center gap-2">
        <span className="font-medium">This workspace</span>
        <span className={muted}>
          {w.summarised}/{count(w.files, "file")} summarised at {w.head.slice(0, 7)}
        </span>
        <span className={cn("ml-auto", all ? "text-green-600 dark:text-green-400" : muted)}>
          {match({ all, running: props.running, ahead: props.ahead })
            .with({ all: true }, () => "Up to date")
            .with({ running: true }, () => "Summarising…")
            .with({ ahead: true }, () => "Not yet")
            .otherwise(() => "For views only")}
        </span>
      </div>
      <ProgressBar value={w.summarised} max={w.files} />
    </div>
  );
}
