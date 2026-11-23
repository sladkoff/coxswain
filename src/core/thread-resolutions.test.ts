import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { workspaceEntries } from "./entries.ts";
import { resolutionCandidates, parseResolutions, applyResolutions } from "./thread-resolutions.ts";

test("verified resolutions persist, skip changed threads and stay local", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.destroy());
  await db
    .insertInto("projects")
    .values({ id: 1, name: "test", path: "/tmp/test", last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({ id: 1, project_id: 1, branch: "topic", base_branch: "main", last_opened_at: "" })
    .execute();
  const root = {
    workspace_id: 1,
    kind: "note" as const,
    body: "Handle empty input",
    parent_id: null,
    view_id: null,
    path: "a.ts",
    side: "new" as const,
    start_line: 1,
    end_line: 1,
    code: "input[0]",
    base: null,
    head: null,
    revision: null,
    created_at: "",
  };
  for (const id of [1, 2, 3])
    await db
      .insertInto("entries")
      .values({ ...root, id })
      .execute();
  // Post to GitHub must not turn an automatic local assessment into an external write.
  await db.insertInto("settings").values({ key: "comment.post", value: "true" }).execute();
  await db
    .updateTable("entries")
    .set({ github_thread_id: "remote", github_resolved: 0 })
    .where("id", "=", 1)
    .execute();
  const candidates = await resolutionCandidates(db, 1);
  assert.throws(() => parseResolutions([{ thread_id: 99, summary: "Fixed" }], candidates));
  assert.throws(() => parseResolutions([{ thread_id: 1, summary: " " }], candidates));
  assert.throws(() =>
    parseResolutions(
      [
        { thread_id: 1, summary: "Fixed" },
        { thread_id: 1, summary: "Again" },
      ],
      candidates,
    ),
  );
  await db.updateTable("entries").set({ body: "Also handle null" }).where("id", "=", 2).execute();
  await db
    .insertInto("entries")
    .values({ ...root, id: 4, parent_id: 3, path: null, body: "Another concern" })
    .execute();
  const resolutions = parseResolutions(
    [1, 2, 3].map((thread_id) => ({
      thread_id,
      summary: "An empty-input guard now returns before indexing.",
    })),
    candidates,
  );
  await applyResolutions(db, 1, candidates, resolutions);
  const entries = await workspaceEntries(db, 1);
  assert.ok(entries[0].resolvedAt);
  assert.equal(entries[0].resolutionSummary, resolutions[0].summary);
  assert.equal(entries[1].resolvedAt, null);
  assert.equal(entries[2].resolvedAt, null);
  assert.equal(
    (
      await db
        .selectFrom("entries")
        .select("github_resolved")
        .where("id", "=", 1)
        .executeTakeFirstOrThrow()
    ).github_resolved,
    0,
  );
});
