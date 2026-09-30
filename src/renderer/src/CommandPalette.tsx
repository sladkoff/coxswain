import { useQuery } from "@tanstack/react-query";
import { match, P } from "ts-pattern";
import { useState } from "react";
import { Input } from "./components/field";
import { ListRow } from "./components/layout";
import { cn, divider, muted, selectable } from "./components/styles";
import { fuzzyFilter } from "./fuzzy";
import { core } from "./queries";

// Something the user can do, by id: from the command palette, the native menu (by its id) or a button.
export type Action = {
  id: string;
  title: string;
  shortcut?: string; // shown next to it, e.g. ⌘B; the native menu owns the key
  enabled?: boolean; // false: left out of the palette and not run
  run: () => void;
};

// The command palette (⌘K, or ⌘⇧O for Open Quickly): type part of a file's path and Enter opens it, or start with >
// to find an action and run it. Esc or a click outside closes it.
export function CommandPalette(props: {
  workspaceId: number | undefined;
  actions: Action[];
  initialQuery: string; // ">" for actions, "" for files
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(props.initialQuery);
  const [current, setCurrent] = useState(0);
  const acting = query.startsWith(">");
  const files = useQuery({
    ...core("listWorktreeFiles", props.workspaceId ?? 0),
    enabled: !!props.workspaceId && !acting,
  }).data;
  type Row = { key: string; title: string; shortcut?: string; pick: () => void };
  const rows: Row[] = acting
    ? fuzzyFilter(
        props.actions.filter((a) => a.enabled !== false),
        query.slice(1),
        (a) => a.title,
      ).map((a) => ({
        key: a.id,
        title: a.title,
        shortcut: a.shortcut,
        pick: () => {
          props.onClose();
          a.run();
        },
      }))
    : files?.status === "ok"
      ? fuzzyFilter(files.paths, query, (p) => p).map((p) => ({
          key: p,
          title: p,
          pick: () => props.onOpen(p),
        }))
      : [];
  const empty = match({ acting, workspaceId: props.workspaceId, files })
    .with({ acting: true }, () => "No matching actions")
    .with({ workspaceId: P.union(undefined, 0) }, () => "No workspace. Type > for actions")
    .with({ files: undefined }, () => "Loading…")
    .with({ files: { message: P.string.select() } }, (message) => message)
    .otherwise(() => "No matching files");

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-24" onMouseDown={props.onClose}>
      <div
        className={cn(
          "flex h-fit max-h-96 w-[36rem] flex-col rounded-lg border bg-white p-2 shadow-xl dark:bg-neutral-900",
          divider,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          value={query}
          placeholder="Open a file in the workspace, or type > for actions"
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
            else if (e.key === "Enter") rows[current]?.pick();
            else if (e.key === "ArrowDown") setCurrent((i) => Math.min(i + 1, rows.length - 1));
            else if (e.key === "ArrowUp") setCurrent((i) => Math.max(i - 1, 0));
            else return;
            e.preventDefault();
          }}
        />
        <div className="mt-2 min-h-0 overflow-y-auto">
          {rows.map((r, i) => (
            <ListRow
              key={r.key}
              ref={(el) => void (i === current && el?.scrollIntoView({ block: "nearest" }))}
              className={cn("py-1", i === current && selectable(true))}
              onClick={r.pick}
            >
              <span className="flex justify-between gap-4">
                <span className="truncate">{r.title}</span>
                {r.shortcut && <span className={cn("shrink-0", muted)}>{r.shortcut}</span>}
              </span>
            </ListRow>
          ))}
          {!rows.length && <div className={cn("px-2 py-1", muted)}>{empty}</div>}
        </div>
      </div>
    </div>
  );
}
