import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { View } from "../../core/views";
import { core } from "./queries";
import { viewSections } from "./view-sections";
import { openedPath, type Opened } from "./Viewer";

// The Guide navigator describes the workspace's current Guide even while the canvas visits
// a thread's recorded range. Every review state and thread placement uses that Guide's range.
export function useGuideSidebar(
  workspaceId: number | undefined,
  guide: View | undefined,
  mergeBase: string | undefined,
) {
  const enabled = !!workspaceId && !!guide;
  const id = workspaceId ?? 0;
  const base = guide?.base ?? "";
  const head = guide?.head;
  const changedQuery = useQuery({ ...core("listChangedFiles", id, base, head), enabled });
  const entriesQuery = useQuery({
    ...core("listEntries", id, mergeBase ?? base, base, head),
    enabled,
  });
  const reviewedQuery = useQuery({ ...core("listReviewed", id, base, head), enabled });
  const filesQuery = useQuery({ ...core("listReviewed", id, base, head, "file"), enabled });
  const changedSinceReview =
    useQuery({ ...core("listChangedSinceReview", id, base, head), enabled }).data ?? [];
  const changed = changedQuery.data?.status === "ok" ? changedQuery.data.files : undefined;
  const sections = useMemo(
    () =>
      guide && changed
        ? viewSections(
            guide,
            changed.map((file) => ({ kind: "diff" as const, file })),
          )
        : null,
    [guide, changed],
  );
  const entries = useMemo(() => {
    const all = entriesQuery.data ?? [];
    const roots = new Set(
      all
        .filter((entry) => !entry.parentId && (!entry.viewId || entry.viewId === guide?.id))
        .map((entry) => entry.id),
    );
    return all.filter((entry) => roots.has(entry.parentId ?? entry.id));
  }, [entriesQuery.data, guide?.id]);
  const isReviewed = (file: Opened) =>
    (file.kind === "file" ? filesQuery.data : reviewedQuery.data)?.includes(openedPath(file)) ??
    false;
  return { guide, sections, entries, changed: changed ?? [], changedSinceReview, isReviewed };
}
