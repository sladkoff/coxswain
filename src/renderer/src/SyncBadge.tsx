import { useQuery } from "@tanstack/react-query";
import { Button } from "./components/button";
import { cn } from "./components/styles";
import { ago, count } from "./format";
import { core } from "./queries";

// ADR 0030: how the workspace on screen stands against GitHub, before Activity in the canvas bar: ↓ commits on GitHub
// the worktree hasn't, ↑ commits not pushed, ● uncommitted files, or ✓ when it's all in. Amber when GitHub couldn't be
// checked or the worktree is behind. Its tooltip says when GitHub was last checked; clicking it shows the commits.
export function SyncBadge({
  workspaceId,
  onShowCommits,
}: {
  workspaceId: number;
  onShowCommits: () => void;
}) {
  const s = useQuery(core("readSyncState", workspaceId)).data;
  if (s?.status !== "ok") return null;
  const parts = [
    s.behind > 0 && `↓${s.behind}`,
    s.ahead > 0 && `↑${s.ahead}`,
    s.dirty > 0 && `●${s.dirty}`,
  ].filter(Boolean);
  const title = [
    s.behind > 0 && `${count(s.behind, "commit")} on GitHub not in the worktree`,
    s.ahead > 0 && `${count(s.ahead, "commit")} not on GitHub`,
    s.dirty > 0 && `${count(s.dirty, "file")} with uncommitted changes`,
    !parts.length && "In sync with GitHub, nothing uncommitted",
    s.checkProblem
      ? `Couldn't check GitHub: ${s.checkProblem}`
      : s.checkedAt && `GitHub checked ${ago(s.checkedAt)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Button
      variant="ghost"
      title={title}
      className={cn(
        "flex items-center gap-1.5 px-1.5 py-0.5 tabular-nums",
        s.checkProblem || s.behind > 0 ? "text-amber-600 dark:text-amber-400" : "text-neutral-500",
      )}
      onClick={onShowCommits}
    >
      {parts.length ? parts.map((p) => <span key={p as string}>{p}</span>) : "✓"}
    </Button>
  );
}
