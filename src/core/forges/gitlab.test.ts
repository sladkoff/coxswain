import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanTrace,
  diffLines,
  jobState,
  parseGlabHosts,
  parseMergeRequest,
  positionOf,
  rebind,
  type RawRead,
} from "./gitlab.ts";
import { forgeRepoOf } from "../forge.ts";

const config = `git_protocol: ssh
# Configuration specific for GitLab instances.
hosts:
    gitlab.com:
        # Your GitLab access token.
        token:
        api_host: gitlab.com
    git.example.com:
        token: glpat-secret
        oauth2_expiry_date: "2026-10-13T12:33:42+02:00"
        ssh_host: ssh.example.com
        git_protocol: https
last_seen_version: v1.117.0
`;

test("glab's hosts and their settings are read from its config", () => {
  const hosts = parseGlabHosts(config);
  assert.deepEqual([...hosts.keys()], ["gitlab.com", "git.example.com"]);
  assert.equal(hosts.get("gitlab.com")!.token, "");
  assert.equal(hosts.get("git.example.com")!.oauth2_expiry_date, "2026-10-13T12:33:42+02:00");
  assert.equal(hosts.get("git.example.com")!.ssh_host, "ssh.example.com");
  assert.equal(parseGlabHosts("editor: vim\n").size, 0);
});

test("a remote on a GitLab host glab has a token for is a GitLab repository, at any depth", async () => {
  const dir = mkdtempSync(join(os.tmpdir(), "glab-"));
  writeFileSync(join(dir, "config.yml"), config);
  process.env.GLAB_CONFIG_DIR = dir;
  assert.deepEqual(await forgeRepoOf("https://git.example.com/group/sub/app.git"), {
    forge: "gitlab",
    host: "git.example.com",
    path: "group/sub/app",
  });
  assert.equal(
    (await forgeRepoOf("git@ssh.example.com:group/app.git"))?.host,
    "git.example.com",
    "by glab's SSH host",
  );
  assert.equal(await forgeRepoOf("git@gitlab.com:acme/app.git"), null, "no token there");
  assert.equal(await forgeRepoOf("git@other.example.com:acme/app.git"), null);
  delete process.env.GLAB_CONFIG_DIR;
});

const note = (id: number, more: object = {}) => ({
  id,
  type: null,
  body: `note ${id}`,
  author: { username: "ann" },
  created_at: `2026-10-0${id % 9}T10:00:00Z`,
  system: false,
  resolvable: false,
  ...more,
});
const position = {
  base_sha: "base",
  start_sha: "start",
  head_sha: "head1",
  old_path: "src/a.ts",
  new_path: "src/a.ts",
  position_type: "text" as const,
  old_line: null,
  new_line: 67,
  line_range: {
    start: { old_line: null, new_line: 65, type: "new" },
    end: { old_line: null, new_line: 67, type: "new" },
  },
};
const read: RawRead = {
  mr: {
    id: 9,
    iid: 1080,
    title: "Draft: Publish images",
    description: null,
    web_url: "https://git.example.com/ng/app/-/merge_requests/1080",
    state: "opened",
    draft: true,
    has_conflicts: false,
    detailed_merge_status: "discussions_not_resolved",
    author: { username: "dwi" },
    source_branch: "feature",
    target_branch: "develop",
    source_project_id: 1,
    target_project_id: 1,
    sha: "head2",
    diff_refs: { base_sha: "base", head_sha: "head2", start_sha: "start" },
    assignees: [{ id: 5, username: "tha" }],
    labels: [{ name: "bug", color: "#ff0000" }],
    user: { can_merge: false },
    head_pipeline: { id: 3, status: "failed" },
  },
  viewer: { id: 7, username: "dwi", name: "D", avatar_url: "" },
  discussions: [
    { id: "sys", individual_note: true, notes: [note(1, { system: true })] },
    {
      id: "D1",
      individual_note: false,
      notes: [
        note(2, { type: "DiffNote", resolvable: true, resolved: true, position }),
        note(3, { type: "DiffNote", resolvable: true, resolved: true, position }),
      ],
    },
    {
      id: "D2",
      individual_note: false,
      notes: [
        note(4, {
          type: "DiffNote",
          resolvable: true,
          resolved: false,
          position: { ...position, old_line: 12, new_line: null, line_range: null },
        }),
      ],
    },
    { id: "C1", individual_note: true, notes: [note(5, { author: { username: "dwi" } })] },
    {
      id: "F1",
      individual_note: false,
      notes: [note(6, { type: "DiffNote", position: { ...position, position_type: "file" } })],
    },
  ],
  approvedBy: ["bob"],
  reviewers: [{ user: { username: "tha" }, state: "requested_changes" }],
  project: { merge_method: "ff", squash_option: "default_off" },
  jobs: [
    {
      id: 11,
      name: "mvn test",
      stage: "test",
      status: "failed",
      allow_failure: false,
      failure_reason: "script_failure",
      web_url: "https://git.example.com/ng/app/-/jobs/11",
    },
    { id: 12, name: "lint", stage: "test", status: "failed", allow_failure: true, web_url: "" },
  ],
  pipelines: [
    { sha: "head2", status: "failed" },
    { sha: "head1", status: "success" },
    { sha: "head2", status: "success" },
  ],
};

test("a merge request reads as a PR: diff notes as threads, the rest as its conversation", () => {
  const pr = parseMergeRequest(read);
  assert.deepEqual(
    pr.threads.map((t) => [
      t.id,
      t.side,
      t.startLine,
      t.endLine,
      t.commit,
      t.resolved,
      t.comments.length,
    ]),
    [
      ["D1", "new", 65, 67, "head1", true, 2],
      ["D2", "old", 12, 12, "base", false, 1],
    ],
  );
  assert.equal(pr.threads[0].comments[0].url, `${read.mr.web_url}#note_2`);
  assert.deepEqual(
    pr.conversation.map((c) => [c.id, c.path]),
    [
      ["5", undefined],
      ["6", "src/a.ts"],
    ],
    "no system notes; a note on a whole file says which",
  );
  assert.deepEqual(
    pr.comments.map((c) => c.id),
    ["5"],
  );
  assert.deepEqual(
    [pr.state, pr.draft, pr.mergeable, pr.mergeState, pr.viewerId, pr.canUpdate],
    ["open", true, "mergeable", "discussions not resolved", "7", true],
  );
  assert.deepEqual(pr.reviewers, [
    { login: "tha", state: "changes requested" },
    { login: "bob", state: "approved" },
  ]);
  assert.deepEqual(pr.labels, [{ name: "bug", color: "ff0000" }]);
  assert.deepEqual(
    pr.checks.map((c) => [c.name, c.state, c.detail, c.jobId]),
    [
      ["test: mvn test", "failure", "script failure", 11],
      ["test: lint", "neutral", "failed", 12],
    ],
  );
  assert.equal(pr.checkState, "failure");
  assert.deepEqual(
    pr.commitChecks,
    { head2: "failure", head1: "success" },
    "the newest per commit",
  );
  assert.deepEqual(pr.mergeMethods, ["rebase", "squash"]);
});

test("job and pipeline states", () => {
  assert.equal(jobState("running"), "pending");
  assert.equal(jobState("manual"), "neutral");
  assert.equal(jobState("failed", true), "neutral");
  assert.equal(jobState("whatever" as never), "neutral");
});

const diff = `@@ -10,4 +10,5 @@ class A
 a
-b
+B
+C
 d
`;

test("diff lines carry GitLab's numbers, and positions both sides of an unchanged line", () => {
  assert.deepEqual(diffLines(diff), [
    { type: null, old: 10, new: 10 },
    { type: "old", old: 11, new: 11 },
    { type: "new", old: 12, new: 11 },
    { type: "new", old: 12, new: 12 },
    { type: null, old: 12, new: 13 },
  ]);
  const refs = { base_sha: "b", start_sha: "s", head_sha: "h" };
  const file = { old_path: "a.ts", new_path: "a.ts", diff };
  const one = positionOf(refs, file, { path: "a.ts", side: "new", startLine: 13, endLine: 13 });
  assert.deepEqual([one.old_line, one.new_line, "line_range" in one], [12, 13, false]);
  const removed = positionOf(refs, file, { path: "a.ts", side: "old", startLine: 11, endLine: 11 });
  assert.deepEqual([removed.old_line, removed.new_line], [11, null]);
  const range = positionOf(refs, file, { path: "a.ts", side: "new", startLine: 11, endLine: 12 });
  assert.deepEqual([range.old_line, range.new_line], [null, 12]);
  assert.match(range.line_range!.start.line_code!, /^[0-9a-f]{40}_12_11$/);
  assert.equal(range.line_range!.end.type, "new");
});

test("a job's log loses timestamps, colours and section markers", () => {
  const trace = [
    "2026-10-07T13:04:13.211990Z 00O \x1b[0KRunning with gitlab-runner 19.4.1\x1b[0;m",
    "2026-10-07T13:04:13.212075Z 00O section_start:1791378253:prepare_executor\r\x1b[0K",
    "2026-10-07T13:04:13.212081Z 00O+\x1b[0K\x1b[36;1mPreparing the executor\x1b[0;m\x1b[0;m",
    "2026-10-07T13:04:20.000000Z 01E [ERROR] Tests failed",
    "",
  ].join("\n");
  assert.equal(
    cleanTrace(trace, 10),
    "Running with gitlab-runner 19.4.1\n\nPreparing the executor\n[ERROR] Tests failed",
  );
  assert.equal(cleanTrace(trace, 1), "[ERROR] Tests failed");
});

test("published draft notes are found again: replies in their discussion, new threads on their lines", () => {
  const mine = (id: number, body: string, more: object = {}) => ({
    ...note(id, { author: { username: "dwi" } }),
    body,
    ...more,
  });
  const rebound = rebind(
    [
      { id: 1, note: "new thread", discussion_id: null, position },
      { id: 2, note: "a reply", discussion_id: "D1", position: null },
      { id: 3, note: "gone", discussion_id: null, position: null },
    ],
    [
      { id: "D1", individual_note: false, notes: [note(2), mine(8, "a reply")] },
      { id: "D9", individual_note: false, notes: [mine(9, "new thread", { position })] },
      {
        id: "D8",
        individual_note: false,
        notes: [mine(7, "new thread", { position: { ...position, new_line: 3 } })],
      },
    ],
    { username: "dwi" },
    { web_url: "https://x/mr/1" },
  );
  assert.deepEqual(rebound, [
    { was: "draft:1", comment: { id: "9", url: "https://x/mr/1#note_9" }, threadId: "D9" },
    { was: "draft:2", comment: { id: "8", url: "https://x/mr/1#note_8" }, threadId: null },
  ]);
});
