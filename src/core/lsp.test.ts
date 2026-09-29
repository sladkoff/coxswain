// node --test src/core/lsp.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { downloaded } from "./language-servers/download.ts";
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

// Downloads pyrefly the first time (ADR 0034), into ~/coxswain/language-servers/ like the app.
test("Python's server finds a member's definition and usages across modules", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-test-")));
  mkdirSync(join(path, "pkg"));
  writeFileSync(join(path, "pkg", "__init__.py"), "");
  writeFileSync(join(path, "pkg", "a.py"), "class Box:\n    id = 1\n\nid = 2\n");
  writeFileSync(join(path, "b.py"), "from pkg.a import Box\n\nprint(Box().id)\n");
  const checkout = { path, worktree: path };
  const at = { commit: null, path: "b.py", line: 3, character: "print(Box().".length };

  assert.deepEqual(await lookUp(checkout, at, "definitions"), {
    status: "ok",
    lines: [{ path: "pkg/a.py", line: 2, text: "id = 1" }],
  });
  const usages = await lookUp(checkout, at, "usages");
  assert.deepEqual(usages.status === "ok" && usages.lines.map((l) => `${l.path}:${l.line}`), [
    "pkg/a.py:2",
    "b.py:3",
  ]);
});

test("a download that doesn't match its checksum is refused and not kept", async () => {
  const server = createServer((_, res) => res.end("not the real archive"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const archive = { url: `http://127.0.0.1:${port}/x.tar.gz`, sha256: "0".repeat(64) };
  const release = {
    name: "coxswain-test",
    version: String(Date.now()),
    exe: "x",
    archives: { [`${process.platform}-${process.arch}`]: archive },
  };
  await assert.rejects(downloaded(release), /checksum/);
  server.close();
  assert.equal(
    existsSync(join(homedir(), "coxswain", "language-servers", `coxswain-test-${release.version}`)),
    false,
  );
});
