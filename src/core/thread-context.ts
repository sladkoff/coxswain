import type { ReviewEntry } from "./review";

// What a comment sent to the agent says about where it is and what came before it: pure, so it can be tested without an
// agent.

// An anchor as the agent reads it: the file, the lines, which side and revision, and the code as it was.
export function describe(
  a: Pick<ReviewEntry, "path" | "side" | "startLine" | "endLine" | "code"> &
    Partial<Pick<ReviewEntry, "base" | "head">>,
): string {
  const lines =
    a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`;
  const at = (sha: string) => `commit ${sha.slice(0, 7)}`;
  const where =
    a.side === "old"
      ? `removed, as at ${a.base ? at(a.base) : "the merge base"}`
      : a.head
        ? `as at ${at(a.head)}`
        : "as in the worktree then";
  const fence = "`".repeat(
    Math.max(3, ...[...(a.code ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return `\`${a.path}\` ${lines} (${where}):\n${fence}\n${a.code}\n${fence}`;
}

// Entries the agent wrote, not the user.
export const byAgent = (e: Pick<ReviewEntry, "kind">) =>
  e.kind === "answer" || e.kind === "explanation" || e.kind === "finding";

// What the agent session hasn't seen of the question's thread, to go after it. A session its last question went to has
// seen the thread up to it: only the notes written since. Any other session (the first question, a new session since,
// or the other agent) gets where the thread is and everything in it so far (#11), also what the agent wrote if the
// thread began as its explanation or finding in a view.
export function unseen(
  question: Omit<ReviewEntry, "state">,
  thread: Omit<ReviewEntry, "state">[],
  agentSessionId: string,
): string {
  if (question.path) return `About ${describe(question)}`;
  const asked = thread.findLast((e) => e.kind === "question");
  if (asked && asked.agentSessionId === agentSessionId)
    return thread
      .filter((e) => e.kind === "note" && e.id > asked.id)
      .map((n) => `Earlier in the thread: ${n.body}`)
      .join("\n\n");
  const about = thread[0]?.path ? [`About ${describe(thread[0])}`] : [];
  const lines = thread.map((e) => `${byAgent(e) ? "You" : "Me"}: ${e.body}`);
  const so = `The thread so far, oldest first ("Me" is me, "You" is you, maybe in another session):\n${lines.join("\n")}`;
  return [...about, ...(lines.length ? [so] : [])].join("\n\n");
}
