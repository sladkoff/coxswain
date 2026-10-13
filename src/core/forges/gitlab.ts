import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { match, P } from "ts-pattern";
import type {
  Check,
  CheckState,
  ConversationItem,
  Forge,
  ForgeComment,
  ForgeProblem,
  ForgeRepo,
  LineAnchor,
  MergeMethod,
  Posted,
  Pr,
  PullRequestDetails,
  PullRequestResult,
  Rebound,
  ReviewThread,
} from "../forge.ts";

// ADR 0041: a GitLab host that glab is signed in to, through its REST API (v4) with glab's token.

const run = promisify(execFile);

// glab's config: each host's settings (api_host, api_protocol, ssh_host, git_protocol, token, …), as glab writes it.
export function parseGlabHosts(yaml: string): Map<string, Record<string, string>> {
  const hosts = new Map<string, Record<string, string>>();
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^hosts:\s*$/.test(l));
  if (start < 0) return hosts;
  let indent = -1;
  let host: Record<string, string> | null = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const depth = line.length - line.trimStart().length;
    if (depth === 0) break;
    if (indent < 0) indent = depth;
    const m = line.trim().match(/^([^:\s]+):\s*(.*)$/);
    if (!m) continue;
    if (depth === indent) hosts.set(m[1], (host = {}));
    else if (host) host[m[1]] = m[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return hosts;
}

function glabHosts() {
  const dir =
    process.env.GLAB_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "glab-cli");
  try {
    return parseGlabHosts(readFileSync(join(dir, "config.yml"), "utf8"));
  } catch {
    return new Map<string, Record<string, string>>();
  }
}

// The hosts glab is signed in to with a token in its config.
// ponytail: a token glab keeps in the system keyring isn't seen; ask `glab auth status` if such setups show up.
export const gitlabHosts = (): string[] =>
  [...glabHosts()].flatMap(([host, c]) => (c.token ? [host] : []));

// The host a remote's host name is, also by the SSH host glab has for it.
export const gitlabHostOf = (name: string): string | null =>
  [...glabHosts()].find(([host, c]) => c.token && (host === name || c.ssh_host === name))?.[0] ??
  null;

const problem = (status: "signed-out" | "cli-missing", host: string): ForgeProblem => ({
  status,
  forge: "gitlab",
  host,
});

// ADR 0041: the token comes from glab each time and is never stored.
async function glabToken(host: string): Promise<string | null> {
  try {
    const { stdout } = await run("glab", ["config", "get", "token", "--host", host]);
    return stdout.trim() || null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw e;
    return null;
  }
}

// glab refreshes an OAuth token that has expired whenever it uses it, so any call of its own does.
const refreshToken = (host: string) =>
  run("glab", ["api", "--hostname", host, "user"]).then(
    () => true,
    () => false,
  );

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | number[] | undefined>;
type Api = {
  get<T>(path: string, query?: Query): Promise<T>;
  page<T>(path: string, query?: Query): Promise<{ items: T[]; next: boolean }>;
  all<T>(path: string, query?: Query): Promise<T[]>;
  send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: object): Promise<T>;
  text(path: string): Promise<string>;
};

const queryString = (q: Query = {}) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (Array.isArray(v)) v.forEach((x) => s.append(`${k}[]`, String(x)));
    else if (v !== undefined) s.append(k, String(v));
  return s.size ? `?${s}` : "";
};

function api(host: string, token: string): Api {
  const c = glabHosts().get(host) ?? {};
  const sub = c.subfolder ? `/${c.subfolder.replace(/^\/|\/$/g, "")}` : "";
  const base = `${c.api_protocol || "https"}://${c.api_host || host}${sub}/api/v4`;
  const request = async (method: string, path: string, query?: Query, body?: object) => {
    const r = await fetch(`${base}${path}${queryString(query)}`, {
      method,
      headers: {
        // OAuth tokens (glab's web sign-in) are only taken as a bearer; personal access tokens are too.
        Authorization: `Bearer ${token}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body && JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      let said = text;
      try {
        const json = JSON.parse(text) as { message?: unknown; error?: unknown };
        said = JSON.stringify(json.message ?? json.error ?? json).replace(/^"|"$/g, "");
      } catch {}
      throw new HttpError(r.status, `${r.status} ${said || r.statusText}`);
    }
    return r;
  };
  const json = async <T>(r: Response) => (r.status === 204 ? undefined : await r.json()) as T;
  const page = async <T>(path: string, query?: Query) => {
    const r = await request("GET", path, { per_page: 100, ...query });
    return { items: await json<T[]>(r), next: !!r.headers.get("x-next-page") };
  };
  return {
    get: async (path, query) => json(await request("GET", path, query)),
    page,
    all: async <T>(path: string, query?: Query) => {
      const out: T[] = [];
      for (let n = 1; ; n++) {
        const p = await page<T>(path, { ...query, page: n });
        out.push(...p.items);
        if (!p.next) return out;
      }
    },
    send: async (method, path, body) => json(await request(method, path, undefined, body)),
    text: async (path) => (await request("GET", path)).text(),
  };
}

// Runs fn with the host's API as the user glab is signed in as; what goes wrong comes back as a problem. A 401 asks
// glab to refresh its token once, then tries again.
async function withGitLab<T>(
  host: string,
  fn: (api: Api) => Promise<T>,
): Promise<T | ForgeProblem> {
  let token: string | null;
  try {
    token = await glabToken(host);
  } catch {
    return problem("cli-missing", host);
  }
  if (!token) return problem("signed-out", host);
  const failed = (e: unknown): ForgeProblem =>
    e instanceof HttpError && e.status === 401
      ? problem("signed-out", host)
      : { status: "error", message: (e as Error).message };
  try {
    return await fn(api(host, token));
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 401) || !(await refreshToken(host)))
      return failed(e);
    const again = await glabToken(host).catch(() => null);
    if (!again || again === token) return failed(e);
    return fn(api(host, again)).catch(failed);
  }
}

const projectPath = (repo: ForgeRepo) => `/projects/${encodeURIComponent(repo.path)}`;
const mrPath = (pr: Pr) => `${projectPath(pr.repo)}/merge_requests/${pr.number}`;

// GitLab's statuses, as its API has them: a pipeline's and a job's.
type JobStatus =
  | "created"
  | "waiting_for_resource"
  | "preparing"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "canceling"
  | "skipped"
  | "manual"
  | "scheduled";
// A pipeline's or job's status, as the panel colours it; a job allowed to fail doesn't fail its check.
export const jobState = (status: JobStatus, allowFailure = false): CheckState =>
  match(status)
    .returnType<CheckState>()
    .with("success", () => "success")
    .with("failed", () => (allowFailure ? "neutral" : "failure"))
    .with(
      P.union("created", "waiting_for_resource", "preparing", "pending", "running", "scheduled"),
      () => "pending",
    )
    .with(P.union("canceled", "canceling", "skipped", "manual"), () => "neutral")
    .exhaustive(() => "neutral");

type RawUser = { id: number; username: string; name: string; avatar_url: string };
type RawPosition = {
  base_sha: string;
  start_sha: string;
  head_sha: string;
  old_path: string;
  new_path: string;
  position_type: "text" | "image" | "file";
  old_line: number | null;
  new_line: number | null;
  line_range?: {
    start: { old_line: number | null; new_line: number | null; type: string | null };
    end: { old_line: number | null; new_line: number | null; type: string | null };
  } | null;
};
type RawNote = {
  id: number;
  type: "DiffNote" | "DiscussionNote" | null;
  body: string;
  author: { username: string };
  created_at: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean;
  position?: RawPosition;
};
type RawDiscussion = { id: string; individual_note: boolean; notes: RawNote[] };
type MrState = "opened" | "merged" | "closed" | "locked";
type RawMergeRequest = {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: MrState;
  draft: boolean;
  has_conflicts: boolean;
  detailed_merge_status: string;
  author: { username: string } | null;
  source_branch: string;
  target_branch: string;
  source_project_id: number;
  target_project_id: number;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
  assignees: { id: number; username: string }[];
  labels: ({ name: string; color: string } | string)[];
  user?: { can_merge: boolean };
  head_pipeline?: { id: number; status: JobStatus } | null;
};
type RawJob = {
  id: number;
  name: string;
  stage: string;
  status: JobStatus;
  allow_failure: boolean;
  failure_reason?: string;
  web_url: string;
};
type RawReviewer = { user: { username: string }; state: string };

const mrState = (s: MrState): PullRequestDetails["state"] =>
  match(s)
    .returnType<PullRequestDetails["state"]>()
    .with("opened", () => "open")
    .with("merged", () => "merged")
    .with(P.union("closed", "locked"), () => "closed")
    .exhaustive(() => "closed");

const words = (s: string) => s.toLowerCase().replaceAll("_", " ");

// Where a diff note is, in coxswain's terms: its side and lines as they were at its head_sha (new side) or base_sha.
function anchorOf(p: RawPosition) {
  const side: "old" | "new" = p.new_line === null && p.old_line !== null ? "old" : "new";
  const lineOf = (l: { old_line: number | null; new_line: number | null } | undefined) =>
    l && (side === "new" ? l.new_line : l.old_line);
  const end = side === "new" ? p.new_line : p.old_line;
  return {
    path: side === "new" ? p.new_path : p.old_path,
    side,
    startLine: lineOf(p.line_range?.start) ?? end,
    endLine: lineOf(p.line_range?.end) ?? end,
  };
}

// Everything the PR panel and the mirror need, from the requests one read makes.
export type RawRead = {
  mr: RawMergeRequest;
  viewer: RawUser;
  discussions: RawDiscussion[];
  approvedBy: string[];
  reviewers: RawReviewer[];
  project: { merge_method: "merge" | "rebase_merge" | "ff"; squash_option: string };
  jobs: RawJob[];
  pipelines: { sha: string; status: JobStatus }[]; // the MR's, newest first
};

export function parseMergeRequest(raw: RawRead): PullRequestDetails {
  const { mr, viewer } = raw;
  const comment = (n: RawNote): ForgeComment => ({
    id: String(n.id),
    author: n.author.username,
    body: n.body,
    createdAt: n.created_at,
    url: `${mr.web_url}#note_${n.id}`,
  });
  const said = (d: RawDiscussion) => d.notes.filter((n) => !n.system);
  const onLines = (d: RawDiscussion) =>
    d.notes[0]?.type === "DiffNote" && d.notes[0].position?.position_type === "text";
  const threads = raw.discussions.filter(onLines).map((d): ReviewThread => {
    const first = d.notes[0];
    const at = anchorOf(first.position!);
    return {
      id: d.id,
      resolved: d.notes.every((n) => !n.resolvable || n.resolved),
      path: at.path,
      side: at.side,
      startLine: at.startLine,
      endLine: at.endLine,
      commit: at.side === "new" ? first.position!.head_sha : first.position!.base_sha,
      comments: said(d).map(comment),
      complete: true,
    };
  });
  // Everything else is the MR's conversation: comments, threads on it, and notes on a whole file.
  const elsewhere = raw.discussions.filter((d) => !onLines(d));
  const conversation: ConversationItem[] = elsewhere
    .flatMap((d) =>
      said(d).map((n) => ({
        ...comment(n),
        ...(n.position && { path: n.position.new_path }),
      })),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviewerState = (s: string) =>
    match(s)
      .with("unreviewed", () => "requested")
      .with("requested_changes", () => "changes requested")
      .with("review_started", () => "requested")
      .otherwise(words);
  const reviewers = raw.reviewers.map((r) => ({
    login: r.user.username,
    state: raw.approvedBy.includes(r.user.username) ? "approved" : reviewerState(r.state),
  }));
  const approved = raw.approvedBy
    .filter((a) => !reviewers.some((r) => r.login === a))
    .map((login) => ({ login, state: "approved" }));
  const checks = [...raw.jobs]
    .sort((a, b) => a.id - b.id)
    .map((j): Check => ({
      name: `${j.stage}: ${j.name}`,
      state: jobState(j.status, j.allow_failure),
      detail: j.failure_reason ? words(j.failure_reason) : words(j.status),
      url: j.web_url,
      jobId: j.id,
    }));
  const commitChecks: Record<string, CheckState> = {};
  for (const p of raw.pipelines) commitChecks[p.sha] ??= jobState(p.status);
  const squash = raw.project.squash_option;
  const base: MergeMethod = raw.project.merge_method === "ff" ? "rebase" : "merge";
  return {
    status: "ok",
    id: String(mr.iid),
    number: mr.iid,
    title: mr.title,
    body: mr.description ?? "",
    url: mr.web_url,
    state: mrState(mr.state),
    draft: mr.draft,
    mergeable: mr.has_conflicts
      ? "conflicting"
      : ["unchecked", "checking", "preparing", "approvals_syncing"].includes(
            mr.detailed_merge_status,
          )
        ? "unknown"
        : "mergeable",
    mergeState: words(mr.detailed_merge_status),
    author: mr.author?.username ?? null,
    baseRef: mr.target_branch,
    headRef: mr.source_branch,
    head: mr.sha,
    viewer: viewer.username,
    viewerId: String(viewer.id),
    canUpdate: mr.author?.username === viewer.username || !!mr.user?.can_merge,
    assignees: mr.assignees.map((a) => a.username),
    reviewers: [...reviewers, ...approved],
    labels: mr.labels.map((l) =>
      typeof l === "string"
        ? { name: l, color: "888888" }
        : { name: l.name, color: l.color.replace("#", "") },
    ),
    checks,
    checkState: mr.head_pipeline ? jobState(mr.head_pipeline.status) : null,
    commitChecks,
    mergeMethods: squash === "always" ? ["squash"] : squash === "never" ? [base] : [base, "squash"],
    conversation,
    threads,
    comments: elsewhere.flatMap((d) =>
      said(d)
        .filter((n) => !n.position)
        .map(comment),
    ),
  };
}

// A diff's lines with the numbers GitLab gives them: an added line has the old side's next number, a removed one the
// new side's, as in its line codes.
export function diffLines(diff: string) {
  const out: { type: "new" | "old" | null; old: number; new: number }[] = [];
  let [o, n] = [0, 0];
  for (const line of diff.split("\n")) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) [o, n] = [Number(h[1]), Number(h[2])];
    else if (line.startsWith("+")) out.push({ type: "new", old: o, new: n++ });
    else if (line.startsWith("-")) out.push({ type: "old", old: o++, new: n });
    else if (line.startsWith(" ")) out.push({ type: null, old: o++, new: n++ });
  }
  return out;
}

// A diff note's position for lines of the MR's diff (refs: its diff_refs, diff: its file's diff): both sides' numbers
// for an unchanged line, a line range with GitLab's line codes for several lines.
export function positionOf(
  refs: { base_sha: string; start_sha: string; head_sha: string },
  file: { old_path: string; new_path: string; diff: string },
  a: LineAnchor,
) {
  const lines = diffLines(file.diff);
  const find = (n: number) =>
    lines.find((l) =>
      a.side === "new" ? l.new === n && l.type !== "old" : l.old === n && l.type !== "new",
    );
  const hash = createHash("sha1").update(file.new_path).digest("hex");
  const at = (n: number) => {
    const l = find(n);
    return {
      old_line: a.side === "old" || l?.type === null ? (l?.old ?? n) : null,
      new_line: a.side === "new" || l?.type === null ? (l?.new ?? n) : null,
      line: l,
    };
  };
  const end = at(a.endLine);
  const start = at(a.startLine);
  const point = (p: ReturnType<typeof at>) => ({
    line_code: p.line && `${hash}_${p.line.old}_${p.line.new}`,
    type: p.line?.type ?? null,
    old_line: p.old_line,
    new_line: p.new_line,
  });
  return {
    position_type: "text",
    base_sha: refs.base_sha,
    start_sha: refs.start_sha,
    head_sha: refs.head_sha,
    old_path: file.old_path,
    new_path: file.new_path,
    old_line: end.old_line,
    new_line: end.new_line,
    ...(a.startLine !== a.endLine && { line_range: { start: point(start), end: point(end) } }),
  };
}

// A trace's terminal escapes: colours, and erasing the line.
const escape = String.fromCharCode(27);
const sectionMarker = new RegExp(
  `section_(?:start|end):\\d+:[^\\r\\n]*?\\r(?:${escape}\\[0K)?`,
  "g",
);
const terminalCode = new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, "g");

// The last lines of a job's log, as a person reads it: no timestamps, colours or collapsible section markers.
export function cleanTrace(trace: string, lines: number) {
  return trace
    .replace(sectionMarker, "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z \d+[OE]\+? ?/, "")
        .replace(terminalCode, "")
        .replace(/^.*\r(?!$)/, "")
        .replace(/\r$/, ""),
    )
    .join("\n")
    .trimEnd()
    .split("\n")
    .slice(-lines)
    .join("\n");
}

// GitLab's draft markers at the start of a title, which mark a draft MR.
const draftPrefix = /^\s*(?:\[draft\]|\(draft\)|draft:|draft\s+-|draft\s+)\s*/i;

const posted = (mr: { web_url: string }, n: { id: number }): Posted => ({
  id: String(n.id),
  url: `${mr.web_url}#note_${n.id}`,
});

// The MR's diff of one file, for a note's position.
async function fileDiff(gl: Api, pr: Pr, path: string) {
  const files = await gl.all<{ old_path: string; new_path: string; diff: string }>(
    `${mrPath(pr)}/diffs`,
  );
  const file = files.find((f) => f.new_path === path) ?? files.find((f) => f.old_path === path);
  if (!file) throw new Error(`${path} isn't in the merge request's diff`);
  return file;
}

async function position(gl: Api, pr: Pr, a: LineAnchor) {
  const mr = await gl.get<RawMergeRequest>(mrPath(pr));
  if (!mr.diff_refs)
    throw new Error("GitLab is still preparing the merge request's diff; try again");
  return positionOf(mr.diff_refs, await fileDiff(gl, pr, a.path), a);
}

const prefixed = "draft:";

export const gitlabForge: Forge = {
  names: { forge: "GitLab", pr: "MR", request: "merge request", sign: "!", cli: "glab" },
  verdicts: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
  pendingBlocksComments: false,
  currentUser: (host) =>
    withGitLab(host, async (gl) => {
      const u = await gl.get<RawUser>("/user");
      return {
        status: "signed-in" as const,
        login: u.username,
        name: u.name,
        avatarUrl: u.avatar_url,
      };
    }),
  // The projects the user is a member of, most recently active first.
  listRepos: (host, page) =>
    withGitLab(host, async (gl) => {
      const p = await gl.page<{
        id: number;
        path_with_namespace: string;
        description: string | null;
        visibility: string;
        last_activity_at: string;
      }>("/projects", { membership: true, order_by: "last_activity_at", simple: true, page });
      return {
        status: "ok" as const,
        repos: p.items.map((r) => ({
          id: r.id,
          fullName: r.path_with_namespace,
          description: r.description,
          private: r.visibility !== "public",
          pushedAt: r.last_activity_at,
        })),
        hasMore: p.next,
      };
    }),
  // ADR 0006 decision 4, as for gh: the protocol the user chose for glab, on glab's SSH host if it has one.
  cloneUrl: async (repo) => {
    const c = glabHosts().get(repo.host) ?? {};
    const protocol = await run("glab", ["config", "get", "git_protocol", "--host", repo.host]).then(
      (r) => r.stdout.trim(),
      () => c.git_protocol ?? "",
    );
    return protocol === "https"
      ? `https://${repo.host}/${repo.path}.git`
      : `git@${c.ssh_host || repo.host}:${repo.path}.git`;
  },
  // ponytail: first 100 only, as on GitHub.
  listPullRequests: (repo) =>
    withGitLab(repo.host, async (gl) => {
      const { items } = await gl.page<RawMergeRequest & { updated_at: string }>(
        `${projectPath(repo)}/merge_requests`,
        { state: "opened", order_by: "updated_at", sort: "desc" },
      );
      return {
        status: "ok" as const,
        pulls: items.map((m) => ({
          number: m.iid,
          title: m.title,
          author: m.author?.username ?? null,
          headRef: m.source_branch,
          draft: m.draft,
          updatedAt: m.updated_at,
        })),
      };
    }),
  listPullRequestTitles: (repo, numbers) =>
    withGitLab(repo.host, async (gl) => {
      if (!numbers.length) return { status: "ok" as const, pulls: [] };
      const { items } = await gl.page<RawMergeRequest>(`${projectPath(repo)}/merge_requests`, {
        iids: numbers,
      });
      return {
        status: "ok" as const,
        pulls: items.map((m) => ({
          number: m.iid,
          title: m.title,
          state: mrState(m.state),
          draft: m.draft,
        })),
      };
    }),
  findPullRequest: (repo, branch) =>
    withGitLab(repo.host, async (gl) => {
      const { items } = await gl.page<RawMergeRequest>(`${projectPath(repo)}/merge_requests`, {
        state: "opened",
        source_branch: branch,
      });
      const mr = items.find((m) => m.source_project_id === m.target_project_id);
      return { status: "ok" as const, number: mr?.iid ?? null };
    }),
  // GitLab diffs the head against the merge base (diff_refs.base_sha), as GitHub does.
  getPullRequestHead: (pr) =>
    withGitLab(pr.repo.host, async (gl) => {
      const mr = await gl.get<RawMergeRequest>(mrPath(pr));
      if (!mr.diff_refs)
        return {
          status: "error" as const,
          message: "GitLab is still preparing the merge request's diff; try again",
        };
      return {
        status: "ok" as const,
        head: mr.diff_refs.head_sha,
        mergeBase: mr.diff_refs.base_sha,
        headRef: mr.source_branch,
        fromFork: mr.source_project_id !== mr.target_project_id,
      };
    }),
  // A draft MR of a pushed branch; the user finishes its title and description on GitLab.
  createPullRequest: (repo, pr) =>
    withGitLab(repo.host, async (gl) => {
      const mr = await gl.send<RawMergeRequest>("POST", `${projectPath(repo)}/merge_requests`, {
        source_branch: pr.head,
        target_branch: pr.base,
        title: `Draft: ${pr.title}`,
        description: pr.body,
      });
      return { status: "ok" as const, number: mr.iid, url: mr.web_url };
    }),
  // ADR 0037 on GitLab: the MR, its discussions (all pages), approvals, reviewers, the project's merge settings, the
  // head pipeline's jobs and the MR's pipelines. ponytail: the 100 newest pipelines and jobs.
  getPullRequest: (pr): Promise<PullRequestResult> =>
    withGitLab(pr.repo.host, async (gl) => {
      const mr = await gl.get<RawMergeRequest>(mrPath(pr), { with_labels_details: true });
      const [viewer, discussions, approvals, reviewers, project, jobs, pipelines] =
        await Promise.all([
          gl.get<RawUser>("/user"),
          gl.all<RawDiscussion>(`${mrPath(pr)}/discussions`),
          gl.get<{ approved_by: { user: { username: string } }[] }>(`${mrPath(pr)}/approvals`),
          gl.get<RawReviewer[]>(`${mrPath(pr)}/reviewers`),
          gl.get<RawRead["project"]>(projectPath(pr.repo)),
          mr.head_pipeline
            ? gl.page<RawJob>(`${projectPath(pr.repo)}/pipelines/${mr.head_pipeline.id}/jobs`)
            : Promise.resolve({ items: [] }),
          gl.page<{ sha: string; status: JobStatus }>(`${mrPath(pr)}/pipelines`),
        ]);
      return parseMergeRequest({
        mr,
        viewer,
        discussions,
        approvedBy: approvals.approved_by.map((a) => a.user.username),
        reviewers,
        project,
        jobs: jobs.items,
        pipelines: pipelines.items,
      });
    }),
  readJobLog: (repo, jobId, lines) =>
    withGitLab(repo.host, async (gl) => ({
      status: "ok" as const,
      log: cleanTrace(await gl.text(`${projectPath(repo)}/jobs/${jobId}/trace`), lines),
    })),
  // GitLab shows a link to lines as a link, not the code: comments off the diff quote it instead.
  permalink: () => null,
  // The MR's head, and the user's draft notes there: a review in progress.
  postTarget: (pr) =>
    withGitLab(pr.repo.host, async (gl) => {
      const [mr, drafts] = await Promise.all([
        gl.get<RawMergeRequest>(mrPath(pr)),
        gl.all<{ id: number }>(`${mrPath(pr)}/draft_notes`),
      ]);
      return {
        status: "ok" as const,
        target: {
          id: String(mr.iid),
          head: mr.sha,
          pending: drafts.length ? { id: "draft_notes", comments: drafts.length } : null,
        },
      };
    }),
  comment: (pr, _target, body) =>
    withGitLab(pr.repo.host, async (gl) => {
      const mr = await gl.get<RawMergeRequest>(mrPath(pr));
      const n = await gl.send<RawNote>("POST", `${mrPath(pr)}/notes`, { body });
      return { status: "ok" as const, comment: posted(mr, n) };
    }),
  // A review is the user's draft notes, published together. Each is recorded as draft:<id> until then; submitting
  // finds what each became (rebound). Replies to a thread started in the review wait until it's published.
  startReview: async (pr) => {
    const host = pr.repo.host;
    const draft = (body: object) =>
      withGitLab(host, async (gl) => {
        const d = await gl.send<{ id: number }>("POST", `${mrPath(pr)}/draft_notes`, body);
        return `${prefixed}${d.id}`;
      });
    return {
      status: "ok",
      review: {
        repliesWait: true,
        thread: async (a, body) => {
          const made = await withGitLab(host, async (gl) =>
            gl.send<{ id: number }>("POST", `${mrPath(pr)}/draft_notes`, {
              note: body,
              position: await position(gl, pr, a),
            }),
          );
          if ("status" in made) return made;
          const id = `${prefixed}${made.id}`;
          return { status: "ok", threadId: id, comment: { id, url: "" } };
        },
        reply: async (threadId, body) => {
          const id = await draft({ note: body, in_reply_to_discussion_id: threadId });
          return typeof id === "string" ? { status: "ok", comment: { id, url: "" } } : id;
        },
        submit: (verdict, body) =>
          withGitLab(host, async (gl) => {
            const drafts = await gl.all<{
              id: number;
              note: string;
              discussion_id: string | null;
              position: RawPosition | null;
            }>(`${mrPath(pr)}/draft_notes`);
            if (drafts.length || body || verdict === "REQUEST_CHANGES")
              await gl.send("POST", `${mrPath(pr)}/draft_notes/bulk_publish`, {
                ...(body && { note: body }),
                ...(verdict === "REQUEST_CHANGES" && { reviewer_state: "requested_changes" }),
              });
            if (verdict === "APPROVE") {
              const mr = await gl.get<RawMergeRequest>(mrPath(pr));
              await gl.send("POST", `${mrPath(pr)}/approve`, { sha: mr.sha });
            }
            if (!drafts.length) return { status: "ok" as const, rebound: [] };
            const [mr, viewer, discussions] = await Promise.all([
              gl.get<RawMergeRequest>(mrPath(pr)),
              gl.get<RawUser>("/user"),
              gl.all<RawDiscussion>(`${mrPath(pr)}/discussions`),
            ]);
            return { status: "ok" as const, rebound: rebind(drafts, discussions, viewer, mr) };
          }),
      },
    };
  },
  postThread: (pr, _target, a, body) =>
    withGitLab(pr.repo.host, async (gl) => {
      const mr = await gl.get<RawMergeRequest>(mrPath(pr));
      const d = await gl.send<RawDiscussion>("POST", `${mrPath(pr)}/discussions`, {
        body,
        position: await position(gl, pr, a),
      });
      return { status: "ok" as const, comment: posted(mr, d.notes[0]), threadId: d.id };
    }),
  // A reply in the thread's discussion, found by its first comment if its id isn't known yet.
  postReply: (pr, thread, body) =>
    withGitLab(pr.repo.host, async (gl) => {
      const mr = await gl.get<RawMergeRequest>(mrPath(pr));
      let id = thread.id;
      if (!id) {
        const all = await gl.all<RawDiscussion>(`${mrPath(pr)}/discussions`);
        id = all.find((d) => d.notes.some((n) => String(n.id) === thread.first))?.id ?? "";
        if (!id) throw new Error("The thread's first comment is gone from GitLab");
      }
      const n = await gl.send<RawNote>("POST", `${mrPath(pr)}/discussions/${id}/notes`, { body });
      return { status: "ok" as const, comment: posted(mr, n) };
    }),
  resolve: (pr, threadId, resolved) =>
    withGitLab(pr.repo.host, async (gl) => {
      await gl.send("PUT", `${mrPath(pr)}/discussions/${threadId}?resolved=${resolved}`);
      return { status: "ok" as const };
    }),
  commentBody: (pr, c) =>
    withGitLab(pr.repo.host, async (gl) => ({
      status: "ok" as const,
      body: (await gl.get<RawNote>(`${mrPath(pr)}/notes/${c.id}`)).body,
    })),
  editComment: (pr, c, body) =>
    withGitLab(pr.repo.host, async (gl) => {
      await gl.send("PUT", `${mrPath(pr)}/notes/${c.id}`, { body });
      return { status: "ok" as const };
    }),
  deleteComment: (pr, c) =>
    withGitLab(pr.repo.host, async (gl) => {
      await gl.send("DELETE", `${mrPath(pr)}/notes/${c.id}`).catch((e: unknown) => {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      });
      return { status: "ok" as const };
    }),
  changePullRequest: (pr, ref, change) =>
    withGitLab(pr.repo.host, async (gl) => {
      const path = mrPath(pr);
      await match(change)
        .with({ kind: "body" }, (c) => gl.send("PUT", path, { description: c.body }))
        .with({ kind: "comment" }, (c) => gl.send("POST", `${path}/notes`, { body: c.body }))
        .with({ kind: "assign" }, async (c) => {
          const mr = await gl.get<RawMergeRequest>(path);
          const others = mr.assignees.map((a) => a.id).filter((id) => String(id) !== ref.viewerId);
          return gl.send("PUT", path, {
            assignee_ids: c.on ? [...others, Number(ref.viewerId)] : others,
          });
        })
        .with({ kind: "ready" }, async () => {
          const mr = await gl.get<RawMergeRequest>(path);
          return gl.send("PUT", path, { title: mr.title.replace(draftPrefix, "") });
        })
        .with({ kind: "merge" }, (c) =>
          gl.send("PUT", `${path}/merge`, { sha: ref.head, squash: c.method === "squash" }),
        )
        .exhaustive();
      return { status: "ok" as const };
    }),
};

// What each draft note became once published: the viewer's note with its text, in the discussion it replied to, or
// for a new thread the one on its lines. Newest first, so a note posted twice matches the latest.
export function rebind(
  drafts: {
    id: number;
    note: string;
    discussion_id: string | null;
    position: RawPosition | null;
  }[],
  discussions: RawDiscussion[],
  viewer: { username: string },
  mr: { web_url: string },
): Rebound[] {
  const taken = new Set<number>();
  const notes = discussions
    .flatMap((d) => d.notes.map((n, i) => ({ d, n, first: i === 0 })))
    .filter(({ n }) => n.author.username === viewer.username && !n.system)
    .sort((a, b) => b.n.created_at.localeCompare(a.n.created_at));
  return drafts.flatMap((draft) => {
    const found = notes.find(
      ({ d, n, first }) =>
        !taken.has(n.id) &&
        n.body === draft.note &&
        (draft.discussion_id
          ? d.id === draft.discussion_id
          : first &&
            (!draft.position ||
              (n.position?.new_path === draft.position.new_path &&
                n.position?.new_line === draft.position.new_line &&
                n.position?.old_line === draft.position.old_line))),
    );
    if (!found) return [];
    taken.add(found.n.id);
    return [
      {
        was: `${prefixed}${draft.id}`,
        comment: posted(mr, found.n),
        threadId: draft.discussion_id ? null : found.d.id,
      },
    ];
  });
}
