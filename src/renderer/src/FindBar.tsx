import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button, ToggleButton } from "./components/button";
import { Input } from "./components/field";
import { cn, divider, muted } from "./components/styles";
import {
  closeFind,
  findSnapshot,
  nextFind,
  setFindQuery,
  subscribeFind,
  toggleFindCase,
  type FindPane,
} from "./find";

export function FindBar({ pane }: { pane: FindPane }) {
  const state = useSyncExternalStore(subscribeFind, findSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const open = state.target?.pane === pane;
  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open, state.focus]);
  if (!open) return null;
  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-1 border-b p-1.5 text-xs", divider)}
      role="search"
      aria-label={`Find in ${state.target!.label}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeFind();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          nextFind(e.shiftKey);
        }
      }}
    >
      <span className={cn("w-full truncate", muted)} title={state.target!.label}>
        Find in {state.target!.label}
        {state.matches[state.index]?.file && state.target!.label === "canvas"
          ? ` · ${state.matches[state.index].file}`
          : ""}
      </span>
      <Input
        ref={input}
        aria-label="Find text"
        placeholder="Find…"
        value={state.query}
        className="min-w-16 flex-1 px-2 py-1"
        onChange={(e) => setFindQuery(e.target.value)}
      />
      <span aria-live="polite" className={cn("tabular-nums", muted)}>
        {state.searching
          ? "Searching…"
          : state.query
            ? state.matches.length
              ? `${state.index + 1} of ${state.matches.length}`
              : "No matches"
            : ""}
      </span>
      <ToggleButton
        on={state.matchCase}
        onClick={toggleFindCase}
        title="Match case"
        aria-label="Match case"
      >
        Aa
      </ToggleButton>
      <Button
        variant="ghost"
        disabled={state.searching || !state.matches.length}
        onClick={() => nextFind(true)}
        title="Previous match (⇧Enter)"
        aria-label="Previous match"
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        disabled={state.searching || !state.matches.length}
        onClick={() => nextFind()}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ↓
      </Button>
      {state.error && (
        <span role="status" className="w-full text-red-600" title={state.error}>
          {state.error}
        </span>
      )}
      <Button
        variant="ghost"
        onClick={() => closeFind()}
        title="Close Find (Escape)"
        aria-label="Close Find"
      >
        ×
      </Button>
    </div>
  );
}
