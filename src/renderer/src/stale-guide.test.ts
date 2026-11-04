import assert from "node:assert/strict";
import { test } from "node:test";
import { isGuideStale } from "./stale-guide.ts";

test("a Guide becomes stale when either end of its known range moves", () => {
  const guide = { guide: true, base: "base", head: "head" };
  assert.equal(isGuideStale(guide, "base", "head"), false);
  assert.equal(isGuideStale(guide, "base", "next"), true);
  assert.equal(isGuideStale(guide, "new-base", "head"), true);
  assert.equal(isGuideStale(guide, undefined, "head"), false);
  assert.equal(isGuideStale(guide, "base", null), false);
  assert.equal(isGuideStale(null, "base", "head"), false);
  assert.equal(isGuideStale({ ...guide, guide: false }, "base", "next"), false);
});
