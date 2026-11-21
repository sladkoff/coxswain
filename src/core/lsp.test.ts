// node --test src/core/lsp.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    (await lookUp(checkout, { ...at, path: "c.rs" }, "definitions")).status,
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

// Needs Go and gopls installed (ADR 0034).
test("Go's server finds a member's definition and usages across packages, in a module in a subfolder", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-test-")));
  // The module isn't at the checkout's root, as in a monorepo with backend/go.mod.
  mkdirSync(join(path, "backend", "box"), { recursive: true });
  writeFileSync(join(path, "backend", "go.mod"), "module example.com/m\n\ngo 1.21\n");
  writeFileSync(
    join(path, "backend", "box", "box.go"),
    "package box\n\ntype Box struct{ ID int }\n\nvar ID = 2\n",
  );
  writeFileSync(
    join(path, "backend", "main.go"),
    'package main\n\nimport "example.com/m/box"\n\nfunc main() {\n\tb := box.Box{ID: 1}\n\tprintln(b.ID)\n}\n',
  );
  const checkout = { path, worktree: path };
  // `ID` in `b.ID`: the field, not the same-named var beside it.
  const at = { commit: null, path: "backend/main.go", line: 7, character: "\tprintln(b.".length };

  assert.deepEqual(await lookUp(checkout, at, "definitions"), {
    status: "ok",
    lines: [{ path: "backend/box/box.go", line: 3, text: "type Box struct{ ID int }" }],
  });
  const usages = await lookUp(checkout, at, "usages");
  assert.deepEqual(usages.status === "ok" && usages.lines.map((l) => `${l.path}:${l.line}`), [
    "backend/box/box.go:3",
    "backend/main.go:6",
    "backend/main.go:7",
  ]);
});

// gopls doesn't watch files, so it answers from changed files only because the client tells it of them.
test("a server in the worktree sees the files changed since it started, committed or not", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-test-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: path,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
  mkdirSync(join(path, "box"));
  writeFileSync(join(path, "go.mod"), "module example.com/m\n\ngo 1.21\n");
  writeFileSync(join(path, "box", "box.go"), "package box\n\ntype Box struct{ ID int }\n");
  const main = (body: string) =>
    writeFileSync(
      join(path, "main.go"),
      `package main\n\nimport "example.com/m/box"\n\nfunc main() {\n\t${body}\n\tprintln(b.ID)\n}\n`,
    );
  main("b := box.Box{ID: 1}");
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "base");
  const checkout = { path, worktree: path };
  const field = { commit: null, path: "main.go", line: 7, character: "\tprintln(b.".length };

  // Clicked in box.go first, which opens it.
  const usages = await lookUp(
    checkout,
    { commit: null, path: "box/box.go", line: 3, character: "type Box struct{ ".length },
    "usages",
  );
  assert.deepEqual(usages.status === "ok" && usages.lines.map((l) => `${l.path}:${l.line}`), [
    "box/box.go:3",
    "main.go:6",
    "main.go:7",
  ]);
  // An uncommitted edit moves the field down a line.
  writeFileSync(
    join(path, "box", "box.go"),
    "package box\n\n// Box holds an ID.\ntype Box struct{ ID int }\n",
  );
  assert.deepEqual(await lookUp(checkout, field, "definitions"), {
    status: "ok",
    lines: [{ path: "box/box.go", line: 4, text: "type Box struct{ ID int }" }],
  });
  // A commit adds a file to the package and uses it.
  writeFileSync(join(path, "box", "new.go"), "package box\n\nfunc New() Box { return Box{} }\n");
  main("b := box.New()");
  git("add", ".");
  git("commit", "-qm", "New");
  assert.deepEqual(
    await lookUp(
      checkout,
      { commit: null, path: "main.go", line: 6, character: "\tb := box.".length },
      "definitions",
    ),
    {
      status: "ok",
      lines: [{ path: "box/new.go", line: 3, text: "func New() Box { return Box{} }" }],
    },
  );
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

test("Python import names and argument references navigate through re-exports to source", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-import-")));
  mkdirSync(join(path, "pkg"));
  writeFileSync(join(path, "pkg", "source.py"), "class SuggestSampleTestSetup:\n    pass\n");
  writeFileSync(join(path, "pkg", "__init__.py"), "from .source import SuggestSampleTestSetup\n");
  writeFileSync(
    join(path, "consumer.py"),
    "from pkg import SuggestSampleTestSetup\n\ndef use(value: SuggestSampleTestSetup):\n    pass\n",
  );
  const checkout = { path, worktree: path };
  for (const at of [
    { line: 1, character: 18 },
    { line: 3, character: 15 },
  ]) {
    assert.deepEqual(
      await lookUp(checkout, { commit: null, path: "consumer.py", ...at }, "definitions"),
      {
        status: "ok",
        lines: [{ path: "pkg/source.py", line: 1, text: "class SuggestSampleTestSetup:" }],
      },
    );
  }
});

test("Python source navigation resolves namespace packages in an uninstalled workspace", async () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "coxswain-namespace-")));
  mkdirSync(join(path, "lib", "feature", "cortea", "domain"), { recursive: true });
  writeFileSync(join(path, "pyproject.toml"), '[project]\nname="root"\nversion="0.1"\n');
  writeFileSync(
    join(path, "lib", "feature", "pyproject.toml"),
    '[project]\nname="feature"\nversion="0.1"\n',
  );
  writeFileSync(
    join(path, "lib", "feature", "cortea", "domain", "source.py"),
    "class SuggestSampleTestSetup:\n    pass\n",
  );
  writeFileSync(
    join(path, "consumer.py"),
    "from cortea.domain.source import SuggestSampleTestSetup\n\ndef use(value: SuggestSampleTestSetup):\n    pass\n",
  );
  const result = await lookUp(
    { path, worktree: path },
    { commit: null, path: "consumer.py", line: 3, character: 15 },
    "definitions",
  );
  assert.deepEqual(result, {
    status: "ok",
    lines: [
      {
        path: "lib/feature/cortea/domain/source.py",
        line: 1,
        text: "class SuggestSampleTestSetup:",
      },
    ],
  });
});
