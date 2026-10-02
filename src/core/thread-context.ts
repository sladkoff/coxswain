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

// The threads a review takes, by their first entries: open, and the user's. An explanation or finding the user didn't
// reply to isn't part of their review, nor is a resolved thread.
export const reviewRoots = <
  E extends Pick<ReviewEntry, "id" | "kind" | "parentId" | "resolvedAt" | "path" | "section">,
>(
  entries: E[],
) => {
  const replied = new Set(entries.filter((e) => e.parentId && !byAgent(e)).map((e) => e.parentId));
  return entries.filter(
    (e) => anchored(e) && !e.parentId && !e.resolvedAt && (!byAgent(e) || replied.has(e.id)),
  );
};

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

// A thread's conclusion (glossary): the one review comment that says where the thread ended up, written by the summary
// model from the thread. A thread to conclude: its entries, and for a reply to a thread on GitHub the ones that are new
// (fresh), which the conclusion is for.
type Entry = Pick<ReviewEntry, "id" | "kind" | "body" | "author">;
export type ToConclude = {
  root: Parameters<typeof describe>[0];
  thread: Entry[];
  fresh?: Set<number>;
};

export const conclusionInstructions =
  "You write code review comments for a pull request. Everything you need is in the message: don't use tools. Answer with the JSON asked for and nothing else.";

// ponytail: an entry goes in cut to entryChars; an agent's long answer loses its end. Summarise it first if that hurts.
const entryChars = 2000;
const speaker = (e: Entry) =>
  match(e.kind)
    .with("comment", () => `@${e.author} on GitHub`)
    .with(P.union("answer", "explanation", "finding"), () => "Agent")
    .with(P.union("note", "question"), () => "Me")
    .exhaustive();

export function conclusionsPrompt(threads: ToConclude[]): string {
  return [
    `Each thread below is a discussion about some code of a pull request, between its reviewer ("Me"), a coding agent the reviewer worked with ("Agent") and maybe people on GitHub ("@name"). For each, write the one review comment the reviewer posts on the pull request now: where the thread ended up, not how it got there.`,
    [
      "A good review comment:",
      "- says one thing. A decision: state it, with the reason in a clause. Something to do: ask for the change, concretely. Still open: ask the question.",
      "- is about the code: names the function, variable or behaviour it means, identifiers in backticks, and a short code suggestion if the thread settled on one.",
      "- is written by the reviewer to the author, plain and courteous, in one to three sentences.",
      "- leaves out praise, who said what, the agent and the discussion itself, and anything the thread dropped along the way.",
      "- doesn't repeat the file or the line numbers when the thread is on lines: it is shown on them.",
      "A thread marked as a reply continues one on GitHub: write the reply that brings it up to date, from the entries marked new.",
    ].join("\n"),
    'Answer with JSON only, one entry per thread: {"threads":[{"thread":<its number>,"comment":"<text>"}]}. It must parse: in a comment, write code in backticks, not double quotes, and escape any double quote or line break.',
    threads
      .map(({ root, thread, fresh }, i) => {
        const lines = thread.map(
          (e) =>
            `${speaker(e)}${fresh?.has(e.id) ? " (new)" : ""}: ${e.body.length > entryChars ? `${e.body.slice(0, entryChars)} …` : e.body}`,
        );
        return `### ${i + 1}.${fresh ? " A reply." : ""} On ${describe(root)}\n${lines.join("\n")}`;
      })
      .join("\n\n"),
  ].join("\n\n");
}

// The conclusions in a reply, by thread number; entries that don't fit are left out. Throws if there's no JSON to read.
export function parseConclusions(text: string, count: number): Map<number, string> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The reply had no JSON in it");
  const answer = JSON.parse(text.slice(start, end + 1)) as { threads?: unknown };
  if (!Array.isArray(answer?.threads)) throw new Error('The reply had no "threads" list');
  const out = new Map<number, string>();
  for (const a of answer.threads as { thread?: unknown; comment?: unknown }[]) {
    const n = a?.thread;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > count || out.has(n)) continue;
    if (typeof a.comment === "string" && a.comment.trim()) out.set(n, a.comment.trim());
  }
  return out;
}
