import assert from "node:assert/strict";
import { test } from "node:test";
import { forgeRepoOf } from "./forge.ts";

test("forgeRepoOf reads owner/name from github.com remotes only", async () => {
  for (const url of [
    "git@github.com:acme/widgets.git",
    "https://github.com/acme/widgets",
    "https://github.com/acme/widgets.git",
    "https://user@github.com/acme/widgets/",
    "ssh://git@github.com/acme/widgets.git",
  ])
    assert.deepEqual(
      await forgeRepoOf(url),
      { forge: "github", host: "github.com", path: "acme/widgets" },
      url,
    );
  assert.equal((await forgeRepoOf("git@github.com:acme/my.repo.git"))?.path, "acme/my.repo");
  assert.equal(await forgeRepoOf("git@github.com:acme/team/widgets.git"), null);
  assert.equal(await forgeRepoOf("git@gitlab.com:acme/widgets.git"), null);
  assert.equal(await forgeRepoOf("https://github.com.evil.example/acme/widgets"), null);
  assert.equal(await forgeRepoOf(""), null);
});
