import { setDefaultPrompt } from "./prompt-settings.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";
import type { Db } from "./db";

const temp = mkdtempSync(join(os.tmpdir(), "coxswain-guides-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { openWorktree, openedWorktree, snapshot } = await import("./git.ts");
const {
  ensureGuide,
  parseGuide,
  guideMarkdown,
  requestGuide,
  getGuideSettings,
  setGuideSettings,
  getGuideRun,
  setGuideSessionDriver,
  guideWorkPending,
} = await import("./guides.ts");
const { listViews, viewTools } = await import("./views.ts");
const { emit } = await import("./events.ts");
const { startBackground } = await import("./background.ts");
home.mock.restore();
syncBuiltinESMExports();
after(() => rmSync(temp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();

async function idle(db: Db) {
  let settled = 0;
  for (let i = 0; i < 400; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = await getGuideRun(db, 1);
    settled = state && state.state !== "running" && !guideWorkPending(1) ? settled + 1 : 0;
    if (settled >= 3) return;
  }
  assert.fail("Guide session did not finish");
}

test("guide output covers every file once and keeps code out of prose", () => {
  const good = {
    sections: [
      { title: "Behavior", body: "Requests preserve their order.", files: ["a b.ts", "b.ts"] },
    ],
  };
  const sections = parseGuide(JSON.stringify(good), ["a b.ts", "b.ts"]);
  assert.match(guideMarkdown(sections)[0], /```diff path="a b.ts"\n```/);
  assert.throws(
    () => parseGuide(JSON.stringify(good), ["a b.ts", "b.ts", "c.ts"]),
    /every changed file/,
  );
  assert.throws(() => parseGuide(JSON.stringify(good), ["b.ts"]), /Unknown or repeated/);
  assert.throws(
    () =>
      parseGuide(JSON.stringify({ sections: [{ ...good.sections[0], files: ["b.ts", "b.ts"] }] }), [
        "b.ts",
      ]),
    /repeated/,
  );
  assert.throws(
    () =>
      parseGuide(
        JSON.stringify({ sections: [{ ...good.sections[0], body: "```ts\nconst a = 1\n```" }] }),
        ["a b.ts", "b.ts"],
      ),
    /Keep code/,
  );
});

test("Guide generation uses one durable chat session, coalesces updates and publishes atomically", async (t) => {
  const repo = join(temp, "guide-repo");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const value = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  let db = openDatabase(join(temp, "guides.db"));
  t.after(async () => {
    setGuideSessionDriver();
    await db.destroy();
  });
  await db
    .insertInto("projects")
    .values({ id: 1, github: null, name: "repo", path: repo, last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({
      id: 1,
      project_id: 1,
      pr_number: null,
      branch: "feature",
      base_branch: "main",
      last_opened_at: "",
    })
    .execute();
  assert.equal((await openWorktree(db, 1)).status, "ok");
  const worktree = await openedWorktree(db, 1);
  writeFileSync(join(worktree, "a.ts"), "export const value = 2;\n");
  const thread = await db
    .insertInto("entries")
    .values({
      workspace_id: 1,
      kind: "note",
      body: "Change the default value to 2",
      parent_id: null,
      view_id: null,
      path: "a.ts",
      side: "new",
      start_line: 1,
      end_line: 1,
      code: "export const value = 1;",
      base: null,
      head: null,
      revision: null,
      created_at: "",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  let created = 0;
  const turns: { session: string; prompt: string; model: string; effort: string }[] = [];
  let fail = false;
  let gate: Promise<void> | undefined;
  setGuideSessionDriver({
    create: async (database, workspaceId, settings) => {
      const id = `guide-session-${++created}`;
      await database
        .insertInto("agent_sessions")
        .values({
          workspace_id: workspaceId,
          agent: settings.agent,
          agent_session_id: id,
          created_at: "",
          used_at: "",
          title: "Guide",
        })
        .execute();
      return { agentSessionId: id, agent: settings.agent };
    },
    run: async (database, session, prompt, settings, onStart) => {
      onStart();
      turns.push({ session, prompt, model: settings.model, effort: settings.effort });
      if (gate) await gate;
      if (fail) return { status: "error", message: "Sign in to the agent" };
      const request = /request_id=([^,]+)/.exec(prompt)?.[1];
      assert.ok(request);
      const tools = viewTools(database, 1);
      await assert.rejects(
        tools.find((tool) => tool.name === "start_guide")!.call({} as never),
        /publish_guide/,
      );
      const tool = tools.find((tool) => tool.name === "publish_guide")!;
      await tool.call({
        request_id: request,
        sections: [{ title: "Behavior", body: "Changes the default value.", files: ["a.ts"] }],
        resolutions:
          turns.length === 1
            ? [{ thread_id: thread.id, summary: "The exported default is now 2." }]
            : [],
      } as never);
      return { status: "ok" };
    },
  });
  await setGuideSettings(db, { agent: "codex", model: "test-guide-model", effort: "medium" });
  await db.insertInto("settings").values({ key: "agent-pane.open", value: "false" }).execute();
  const stop = startBackground(db);
  t.after(stop);
  emit({ workspaceId: 1, what: "opened" });
  await ensureGuide(db, 1);
  await idle(db);
  const first = (await listViews(db, 1))[0];
  assert.equal(first.guide, true);
  assert.match(
    turns[0].prompt,
    /an outdated anchor or a claim of completion alone is insufficient/,
  );
  const resolved = await db
    .selectFrom("entries")
    .select(["resolved_at", "resolution_summary"])
    .where("id", "=", thread.id)
    .executeTakeFirstOrThrow();
  assert.ok(resolved.resolved_at);
  assert.equal(resolved.resolution_summary, "The exported default is now 2.");
  assert.equal(created, 1);
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(turns.length, 1, "unchanged snapshots reuse their Guide");
  await setDefaultPrompt(db, "guide", "Explain shared infrastructure first.");
  await requestGuide(db, 1, "Focus on architecture and data flow.", {
    model: "manual-model",
    effort: "high",
  });
  await ensureGuide(db, 1);
  await idle(db);
  assert.match(turns.at(-1)!.prompt, /Explain shared infrastructure first/);
  assert.match(turns.at(-1)!.prompt, /Focus on architecture and data flow/);
  assert.match(turns.at(-1)!.prompt, /take precedence/);
  assert.equal(turns.at(-1)!.model, "manual-model");
  assert.equal(
    (
      await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", "agent-pane.open")
        .executeTakeFirst()
    )?.value,
    "false",
    "a manual Guide update keeps Chat closed",
  );

  writeFileSync(join(worktree, "a.ts"), "export const value = 3;\n");
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(created, 1, "automatic updates attach to the original session");
  assert.equal(turns.at(-1)!.session, turns[0].session);
  assert.equal(
    turns.at(-1)!.model,
    "test-guide-model",
    "a one-turn model override does not change defaults",
  );
  assert.match(turns.at(-1)!.prompt, /Focus on architecture and data flow/);
  assert.equal((await listViews(db, 1))[0].id, first.id);
  assert.equal(
    (await db.selectFrom("jobs").selectAll().execute()).length,
    0,
    "Guide generation never starts a background job",
  );

  const preceding = (await listViews(db, 1))[0];
  fail = true;
  writeFileSync(join(worktree, "a.ts"), "export const value = 4;\n");
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal((await getGuideRun(db, 1))?.state, "failed");
  assert.equal(
    (await listViews(db, 1))[0].head,
    preceding.head,
    "failure keeps the readable Guide",
  );
  const calls = turns.length;
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(turns.length, calls, "failed unchanged snapshots wait for explicit retry");
  fail = false;
  await requestGuide(db, 1);
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal((await getGuideRun(db, 1))?.state, "done");
  assert.equal(created, 1, "retry uses the same conversation");
  assert.equal(
    (
      await db
        .selectFrom("settings")
        .select("value")
        .where("key", "=", "agent-pane.open")
        .executeTakeFirst()
    )?.value,
    "false",
    "automatic updates and retries keep Chat closed",
  );

  let release!: () => void;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  writeFileSync(join(worktree, "a.ts"), "export const value = 5;\n");
  await ensureGuide(db, 1);
  const staleRequest = (await getGuideRun(db, 1))!.requestId;
  const pinned = (await listViews(db, 1))[0].head;
  writeFileSync(join(worktree, "a.ts"), "export const value = 6;\n");
  await requestGuide(db, 1, undefined, { model: "queued-first" });
  await ensureGuide(db, 1);
  await requestGuide(db, 1, undefined, { model: "queued-latest" });
  await ensureGuide(db, 1);
  assert.equal(
    (await listViews(db, 1))[0].head,
    pinned,
    "the active session has not replaced the old Guide prematurely",
  );
  gate = undefined;
  release();
  await idle(db);
  assert.equal(turns.at(-1)!.model, "queued-latest");
  assert.equal((await getGuideRun(db, 1))?.state, "done");
  const latest = await snapshot(db, 1);
  assert.equal(latest.status, "ok");
  if (latest.status === "ok") assert.equal((await listViews(db, 1))[0].head, latest.sha);
  await assert.rejects(
    viewTools(db, 1)
      .find((tool) => tool.name === "publish_guide")!
      .call({ request_id: staleRequest, sections: [] } as never),
    /no longer current/,
  );

  stop();
  await db.destroy();
  db = openDatabase(join(temp, "guides.db"));
  t.after(startBackground(db));
  await requestGuide(db, 1);
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(created, 1, "reopening the database retains the session binding");
  await requestGuide(db, 1, undefined, { agent: "claude", model: "opus" });
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(created, 2, "an explicit agent change starts a replacement conversation");
  await requestGuide(db, 1);
  await ensureGuide(db, 1);
  await idle(db);
  assert.equal(
    turns.at(-1)!.session,
    "guide-session-2",
    "later automatic/default updates retain the replacement conversation",
  );
});

test("Guide settings default to Claude Opus, remember each agent and persist separately", async () => {
  const path = join(temp, "guide-settings.db");
  let db = openDatabase(path);
  await db
    .insertInto("settings")
    .values({ key: "summaries.model.claude", value: "sonnet" })
    .execute();
  assert.deepEqual(await getGuideSettings(db), { agent: "claude", model: "opus", effort: "" });
  await setGuideSettings(db, { model: "opus", effort: "high" });
  await setGuideSettings(db, { agent: "codex", model: "gpt-test", effort: "low" });
  await setGuideSettings(db, { agent: "claude" });
  assert.deepEqual(await getGuideSettings(db, "codex"), {
    agent: "codex",
    model: "gpt-test",
    effort: "low",
  });
  assert.equal(
    (await getGuideSettings(db)).agent,
    "claude",
    "reading another agent’s defaults does not select it",
  );
  assert.deepEqual(await getGuideSettings(db), { agent: "claude", model: "opus", effort: "high" });
  await db
    .updateTable("settings")
    .set({ value: "haiku" })
    .where("key", "=", "summaries.model.claude")
    .execute();
  assert.equal((await getGuideSettings(db)).model, "opus");
  await db.destroy();
  db = openDatabase(path);
  await setGuideSettings(db, { agent: "codex" });
  assert.deepEqual(await getGuideSettings(db), {
    agent: "codex",
    model: "gpt-test",
    effort: "low",
  });
  await db.destroy();
});
