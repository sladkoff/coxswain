import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "./components/field";
import { ListRow } from "./components/layout";
import { cn, divider, muted, selectable } from "./components/styles";
import { core } from "./queries";

// ponytail: first 50 matches, substring or in-order letters; rank by match quality if long lists get noisy.
const limit = 50;
const matches = (path: string, q: string) => {
  if (path.includes(q)) return true;
  let i = 0;
  for (const c of path) if (c === q[i]) i++;
  return i === q.length;
};

// Open Quickly (⌘⇧O): type part of a path, Enter opens the file. Esc or a click outside closes it.
export function OpenQuickly(props: {
  workspaceId: number;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const files = useQuery(core("listWorktreeFiles", props.workspaceId)).data;
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const q = query.trim().toLowerCase();
  const shown =
    files?.status === "ok"
      ? files.paths.filter((p) => !q || matches(p.toLowerCase(), q)).slice(0, limit)
      : [];
  const pick = (path: string | undefined) => path && props.onOpen(path);

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
          placeholder="Open a file in the workspace"
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
            else if (e.key === "Enter") pick(shown[current]);
            else if (e.key === "ArrowDown") setCurrent((i) => Math.min(i + 1, shown.length - 1));
            else if (e.key === "ArrowUp") setCurrent((i) => Math.max(i - 1, 0));
            else return;
            e.preventDefault();
          }}
        />
        <div className="mt-2 min-h-0 overflow-y-auto">
          {shown.map((p, i) => (
            <ListRow
              key={p}
              ref={(el) => void (i === current && el?.scrollIntoView({ block: "nearest" }))}
              className={cn("truncate py-1", i === current && selectable(true))}
              onClick={() => pick(p)}
            >
              {p}
            </ListRow>
          ))}
          {(!files || !shown.length) && (
            <div className={cn("px-2 py-1", muted)}>
              {!files ? "Loading…" : files.status !== "ok" ? files.message : "No matching files"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
