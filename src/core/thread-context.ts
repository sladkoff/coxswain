import { match, P } from "ts-pattern";
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
export const quote = (text: string) =>
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

// A thread is a comment thread or an agent thread (glossary), by its first entry, and stays one: a comment thread
// starts with the user's note or a comment from GitHub, and its replies are comments too; an agent thread starts with
// a question, or the agent's explanation or finding.
export const isComment = (root: Pick<ReviewEntry, "kind">) =>
  root.kind === "note" || root.kind === "comment";

// The threads a review takes, by their first entries: the open comment threads. Agent threads aren't part of it.
export const reviewRoots = <
  E extends Pick<ReviewEntry, "kind" | "parentId" | "resolvedAt" | "path" | "section">,
>(
  entries: E[],
) => entries.filter((e) => anchored(e) && !e.parentId && !e.resolvedAt && isComment(e));

// Who wrote an entry, as a prompt names them: "Me" (the user), "You" (the agent), or a reviewer on GitHub by login
// (ADR 0037).
export const who = (e: Pick<ReviewEntry, "kind" | "author">) =>
  match(e.kind)
    .with("comment", () => `@${e.author} on GitHub`)
    .with(P.union("answer", "explanation", "finding"), () => "You")
    .with(P.union("note", "question"), () => "Me")
    .exhaustive();

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

// Summarize as Comment (glossary): the one review comment an agent thread comes to, written by the summary model from
// the thread, for the user to edit before it is added as a comment on the same lines or passage.
type Entry = Pick<ReviewEntry, "kind" | "body" | "author">;

export const summaryInstructions =
  "You write the review comment a reviewer posts on a pull request. Everything you need is in the message: don't use tools. Answer with the comment's text and nothing else.";

// ponytail: an entry goes in cut to entryChars; an agent's long answer loses its end. Summarise it first if that hurts.
const entryChars = 2000;
const speaker = (e: Entry) =>
  match(e.kind)
    .with("comment", () => `@${e.author} on GitHub`)
    .with(P.union("answer", "explanation", "finding"), () => "Agent")
    .with(P.union("note", "question"), () => "Me")
    .exhaustive();

export function summaryPrompt(root: Parameters<typeof describe>[0], thread: Entry[]): string {
  return [
    `Below is a thread on some code of a pull request: its reviewer ("Me") exploring the code with a coding agent ("Agent"). The reviewer now posts one comment on these lines for the pull request's author. Write it.`,
    [
      "The comment carries the reviewer's point: what they ask the author to change, what they decided, or what they still want to know. Find it in the reviewer's own entries, the last ones first: a later entry replaces an earlier one.",
      "The agent's answers are what the reviewer learned. Use them where they settle or sharpen the reviewer's point: the reason for a request, the concrete change, the case that breaks. The author wrote the code, so the comment asks and proposes; it leaves the explaining to the code.",
      "Where the thread only taught the reviewer how the code works, the point is the question they would still put to the author, or a one-line remark on what they found; write that, short.",
    ].join("\n"),
    [
      "How it reads:",
      "- In the reviewer's voice, to the author: plain, direct and courteous. Keep the reviewer's own words where they still hold.",
      "- One paragraph per point, each one to three sentences; most comments are one point.",
      "- About the code: it names the function, variable or behaviour it means, identifiers in backticks, with a short code suggestion when the thread settled on one.",
      "- Self-contained: the author sees the comment on these lines and nothing of the thread, so it stands on its own without naming the agent, the discussion, the file or the line numbers.",
    ].join("\n"),
    `The thread, on ${describe(root)}`,
    thread
      .map(
        (e) =>
          `${speaker(e)}: ${e.body.length > entryChars ? `${e.body.slice(0, entryChars)} …` : e.body}`,
      )
      .join("\n"),
  ].join("\n\n");
}
