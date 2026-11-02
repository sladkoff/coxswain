import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { core } from "./queries";
import { PersonIcon } from "./components/icons";
import { match, P } from "ts-pattern";
import type { ReviewEntry } from "../../core/review";
import { cn, muted } from "./components/styles";
import { count } from "./format";

// Where a thread was written, for one whose lines aren't in the range on screen.
const writtenIn = (t: ReviewEntry) =>
  match(t)
    .with({ viewId: P.number }, () => "in a view")
    .with({ head: P.string.select() }, (head) => `in ${head.slice(0, 7)}`)
    .otherwise(() => "in All");

// One thread under its file. Sidebar rows navigate; resolving and reopening belong to the canvas.
export function ThreadRow(props: {
  root: ReviewEntry;
  replies: ReviewEntry[];
  answering: boolean;
  onClick: () => void;
}) {
  const { root: t, replies } = props;
  const user = useQuery({
    ...core("currentUser"),
    enabled: t.kind !== "comment",
    staleTime: 300_000,
  }).data;
  const avatar = match({ t, user })
    .with(
      { t: { kind: "comment", author: P.string.select() } },
      (author) => `https://github.com/${encodeURIComponent(author)}.png?size=40`,
    )
    .with(
      {
        t: { kind: P.union("note", "question") },
        user: { status: "signed-in", avatarUrl: P.string.select() },
      },
      (url) => url,
    )
    .otherwise(() => null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const preview = t.body
    .replace(/<details[\s\S]*/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Keep status text separate from the single count of all follow-ups.
  const state = match({ answering: props.answering, t })
    .returnType<string | null>()
    .with({ answering: true }, () => "Agent answering")
    .with({ t: { state: "outdated" } }, () => "Outdated")
    .with({ t: { shown: false } }, () => writtenIn(t))
    .with({ t: { kind: "comment" } }, () => `@${t.author} on GitHub`)
    .otherwise(() => null);
  return (
    <div className="guide-nav-item guide-thread-row flex items-center">
      <button
        data-sidebar-nav="open"
        onClick={props.onClick}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-start gap-1 px-2 py-2 text-left",
          (t.state === "outdated" || !t.shown) && muted,
        )}
      >
        <span
          className="flex w-full min-w-0 items-center gap-1.5 leading-relaxed font-normal text-neutral-600 dark:text-neutral-400"
          title={preview}
        >
          {avatar && avatar !== failedAvatar ? (
            <img
              src={avatar}
              alt=""
              className="size-4 shrink-0 rounded-full"
              onError={() => setFailedAvatar(avatar)}
            />
          ) : (
            <span className={muted}>
              <PersonIcon />
            </span>
          )}
          <span className="min-w-0 truncate">{preview || "Thread"}</span>
        </span>
        <span
          className={cn("flex w-full min-w-0 items-center gap-1.5 pl-[22px] text-[11px]", muted)}
        >
          <span className="min-w-0 flex-1 truncate">
            {[
              replies.length > 0 && count(replies.length, "reply", "replies"),
              t.resolvedAt && "Resolved",
              state,
            ]
              .filter(Boolean)
              .join(" · ") || "Comment"}
          </span>
        </span>
      </button>
    </div>
  );
}
