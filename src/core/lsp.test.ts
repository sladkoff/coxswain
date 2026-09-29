// node --test src/core/lsp.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { lookUp, stopLanguageServers } from "./lsp.ts";

after(stopLanguageServers);

test("TypeScript's server finds a member's definition and usages across files, by scope", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-test-")));
  writeFileSync(join(path, "a.ts"), "export const box = { id: 1 };\nexport const id = 2;\n");
  writeFileSync(join(path, "b.ts"), 'import { box } from "./a";\nconsole.log(box.id);\n');
  const checkout = { path, worktree: path };
  // `id` in `box.id`: the member, not the same-named const beside it.
  const at = { commit: null, path: "b.ts", line: 2, character: "console.log(box.".length };

  assert.deepEqual(await lookUp(checkout, at, "definitions"), {
    status: "ok",
    lines: [{ path: "a.ts", line: 1, text: "export const box = { id: 1 };" }],
  });
  const usages = await lookUp(checkout, at, "usages");
  assert.deepEqual(usages.status === "ok" && usages.lines.map((l) => `${l.path}:${l.line}`), [
    "a.ts:1",
    "b.ts:2",
  ]);
  assert.equal(
    (await lookUp(checkout, { ...at, path: "c.go" }, "definitions")).status,
    "no-language-server",
  );
});
