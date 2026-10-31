import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { onEvent } from "./events.ts";
import { defaultUiPreferences, type UiPreferences } from "../shared/ui-preferences.ts";
import { getUiPreferences, setUiPreferences } from "./ui-preferences.ts";

test("all display, filter and pane preferences survive reopening the database", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "coxswain-preferences-"));
  const path = join(directory, "test.db");
  let db = openDatabase(path);
  t.after(async () => {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  });
  assert.deepEqual(await getUiPreferences(db), defaultUiPreferences);
  let changes = 0;
  t.after(
    onEvent((event) => {
      if (event.what === "settings") changes++;
    }),
  );
  const saved: UiPreferences = {
    leftWidth: 280,
    agentsWidth: 500,
    paneOpen: false,
    history: "turns",
    historyOpen: true,
    historyHeight: 210,
    groupChanges: false,
    guideDescriptionPosition: "above",
    viewSettings: { diffStyle: "split", layout: "list", showReviewed: false },
    guideOptions: {
      showResolved: false,
      onlyFilesWithThreads: true,
      showAgentThreads: false,
      showComments: false,
      hiddenAuthors: ["person"],
      shownAuthors: ["helper[bot]"],
    },
  };
  await setUiPreferences(db, saved);
  assert.equal(changes, 1);
  await db.destroy();
  db = openDatabase(path);
  assert.deepEqual(await getUiPreferences(db), saved);
  await Promise.all([
    setUiPreferences(db, { leftWidth: 320 }),
    setUiPreferences(db, { groupChanges: true }),
  ]);
  assert.deepEqual(await getUiPreferences(db), { ...saved, leftWidth: 320, groupChanges: true });
  assert.equal(changes, 3, "each write notifies every window's settings readers");
});
