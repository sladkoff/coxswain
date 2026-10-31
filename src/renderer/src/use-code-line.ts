import { match, P } from "ts-pattern";
import { VirtualizedFile, VirtualizedFileDiff, type File, type FileDiff } from "@pierre/diffs";
import { useVirtualizer } from "@pierre/diffs/react";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { CodeLine } from "./source-destination";

// Locate an offscreen line through Pierre's public position API, then use its rendered row.
export function useCodeLine<A>(
  root: RefObject<HTMLDivElement | null>,
  target: CodeLine | undefined,
  ready: boolean,
  version: string | undefined,
  kind: "file" | "diff",
) {
  const virtualizer = useVirtualizer();
  const instance = useRef<File<A> | FileDiff<A> | null>(null);
  const onRender = useCallback((_node: HTMLElement, rendered: File<A> | FileDiff<A>) => {
    instance.current = rendered;
  }, []);
  useEffect(() => {
    if (!target || !ready) return;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 40;
    const canvas =
      root.current?.closest<HTMLElement>(".review-canvas") ??
      root.current?.closest<HTMLElement>(".overflow-auto");
    const events = [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
      "review-scroll-cancel",
    ] as const;
    const stop = () => {
      clearTimeout(timer);
      events.forEach((event) => canvas?.removeEventListener(event, stop));
    };
    const go = () => {
      const element = root.current;
      if (!element?.isConnected || tries-- <= 0) return stop();
      const rows = element
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelectorAll<HTMLElement>(`[data-content] [data-line="${target.line}"]`);
      const row = [...(rows ?? [])].find((row) => {
        const column = row.closest("[data-code]");
        if (kind === "file") return true;
        if (column?.hasAttribute("data-unified")) {
          const deleted = row.getAttribute("data-line-type") === "change-deletion";
          return target.side === "deletions" ? deleted : !deleted;
        }
        return column?.hasAttribute(`data-${target.side}`);
      });
      if (row?.getBoundingClientRect().height) {
        row.scrollIntoView({ block: "center", inline: "nearest" });
        return stop();
      }
      const rendered = instance.current;
      const position = match(rendered)
        .when(
          (file): file is VirtualizedFileDiff<A> => file instanceof VirtualizedFileDiff,
          (file) => file.getLinePosition(target.line, target.side),
        )
        .when(
          (file): file is VirtualizedFile<A> => file instanceof VirtualizedFile,
          (file) => file.getLinePosition(target.line),
        )
        .with(P._, () => undefined)
        .exhaustive();
      if (position && virtualizer) {
        const scrollRoot = virtualizer.getRoot();
        const height = scrollRoot instanceof HTMLElement ? scrollRoot.clientHeight : innerHeight;
        virtualizer.scrollTo({
          top: virtualizer.getOffsetInScrollContainer(element) + position.top - height / 2,
        });
      }
      timer = setTimeout(go, 50);
    };
    events.forEach((event) => canvas?.addEventListener(event, stop, { passive: true }));
    timer = setTimeout(go);
    return stop;
  }, [target?.line, target?.side, ready, version, kind, virtualizer]);
  return onRender;
}
