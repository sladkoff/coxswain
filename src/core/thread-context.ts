import type { ReviewEntry } from "./review";

// What a comment sent to the agent says about where it is and what came before it: pure, so it can be tested without an
// agent.

// An anchor as the agent reads it: the file, the lines, which side and revision, and the code as it was; or on a view's
// prose (ADR 0036), the view, the section, numbered as its tools number them, and the passage.
export function describe(
  a: Pick<ReviewEntry, "path" | "side" | "startLine" | "endLine" | "code"> &
    Partial<Pick<ReviewEntry, "base" | "head" | "viewId" | "section">>,
): string {
  if (a.section != null)
    return `this passage of section ${a.section + 1} of view ${a.viewId} (see list_views):\n${quote(a.code ?? "")}`;
  const lines =
    a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`;
  const at = (sha: string) => `commit ${sha.slice(0, 7)}`;
  const where =
    a.side === "old"
      ? `removed, as at ${a.base ? at(a.base) : "the merge base"}`
      : a.head
        ? `as at ${at(a.head)}`
        : "as in the worktree then";
  return `\`${a.path}\` ${lines} (${where}):\n${fence(a.code ?? "")}`;
}

// Prose as a markdown quote.
const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

// Code in a fence longer than any run of backticks in it.
export function fence(code: string): string {
  const f = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${f}\n${code}\n${f}`;
}

// Whether an entry has an anchor: lines of a file, or a view's prose.
export const anchored = (e: Pick<ReviewEntry, "path" | "section">) =>
  e.path != null || e.section != null;

// Entries the agent wrote, not the user.
export const byAgent = (e: Pick<ReviewEntry, "kind">) =>
  e.kind === "answer" || e.kind === "explanation" || e.kind === "finding";

// Who wrote an entry, as a prompt names them: "Me" (the user), "You" (the agent), or a reviewer on GitHub by login
// (ADR 0037).
export const who = (e: Pick<ReviewEntry, "kind" | "author">) =>
  e.kind === "comment" ? `@${e.author} on GitHub` : byAgent(e) ? "You" : "Me";

// What the agent session hasn't seen of the question's thread, to go after it. A session its last question went to has
// seen the thread up to it: only the notes written since, and comments on GitHub since. Any other session (the first question, a new session since,
// or the other agent) gets where the thread is and everything in it so far (#11), also what the agent wrote if the
// thread began as its explanation or finding in a view.
export function unseen(
  question: Omit<ReviewEntry, "state" | "shown" | "now">,
  thread: Omit<ReviewEntry, "state" | "shown" | "now">[],
  agentSessionId: string,
): string {
  if (anchored(question)) return `About ${describe(question)}`;
  const asked = thread.findLast((e) => e.kind === "question");
  if (asked && asked.agentSessionId === agentSessionId)
    return thread
      .filter((e) => (e.kind === "note" || e.kind === "comment") && e.id > asked.id)
      .map((n) =>
        n.kind === "comment"
          ? `Earlier in the thread, ${who(n)}: ${n.body}`
          : `Earlier in the thread: ${n.body}`,
      )
      .join("\n\n");
  const about = thread[0] && anchored(thread[0]) ? [`About ${describe(thread[0])}`] : [];
  const lines = thread.map((e) => `${who(e)}: ${e.body}`);
  const so = `The thread so far, oldest first ("Me" is me, "You" is you, maybe in another session, "@name" a reviewer on GitHub):\n${lines.join("\n")}`;
  return [...about, ...(lines.length ? [so] : [])].join("\n\n");
}
