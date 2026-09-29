import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiffFromFile } from "@pierre/diffs";
import { diffFindLines, findText } from "./find-text.ts";

test("Find treats metacharacters literally and preserves original Unicode offsets", () => {
  assert.deepEqual(findText("a.* A.* aX", "a.*"), [
    [0, 3],
    [4, 7],
  ]);
  assert.deepEqual(findText("a.* A.*", "a.*", true), [[0, 3]]);
  assert.deepEqual(findText("İx HELLO hello", "hello"), [
    [3, 8],
    [9, 14],
  ]);
  assert.deepEqual(findText("hello", ""), []);
  assert.deepEqual(findText("aaaa", "aa"), [
    [0, 2],
    [2, 4],
  ]);
});

test("diff Find preserves removed and added lines in order and counts unchanged context once", () => {
  const oldText = "same\nremoved\ncontext\nend\n";
  const newText = "same\nadded\ncontext\nextra\nend\n";
  const diff = parseDiffFromFile(
    { name: "old.ts", contents: oldText },
    { name: "new.ts", contents: newText },
  );
  const rows = diffFindLines(diff);
  assert.deepEqual(
    rows.map((r) => [r.text.trimEnd(), r.side, r.line, r.context]),
    [
      ["same", "additions", 1, true],
      ["removed", "deletions", 2, false],
      ["added", "additions", 2, false],
      ["context", "additions", 3, true],
      ["extra", "additions", 4, false],
      ["end", "additions", 5, true],
    ],
  );
});

test("diff Find handles added, deleted and unchanged files", () => {
  const file = (contents: string) => ({ name: "a.ts", contents });
  for (const [oldText, newText, side] of [
    ["", "added\n", "additions"],
    ["deleted\n", "", "deletions"],
  ]) {
    const rows = diffFindLines(parseDiffFromFile(file(oldText), file(newText)));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].side, side);
    assert.equal(rows[0].line, 1);
    assert.equal(rows[0].context, false);
  }
  const unchanged = diffFindLines(parseDiffFromFile(file("same\n"), file("same\n")));
  assert.deepEqual(
    unchanged.map((r) => r.context),
    [true],
  );
});
