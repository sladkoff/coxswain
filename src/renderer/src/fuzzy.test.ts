// node --test src/renderer/src/fuzzy.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fuzzyFilter, fuzzyScore } from "./fuzzy.ts";

test("letters out of order don't match", () => {
  assert.equal(fuzzyScore("src/App.tsx", "xa"), null);
  assert.equal(fuzzyScore("Back", ""), 0);
});

test("ranks the file name, then substrings, then letters in order", () => {
  const paths = ["src/app/index.ts", "docs/mapping.md", "src/renderer/App.tsx", "a/p/p.ts"];
  assert.deepEqual(
    fuzzyFilter(paths, "App", (p) => p),
    ["src/renderer/App.tsx", "src/app/index.ts", "docs/mapping.md", "a/p/p.ts"],
  );
});

test("a word's start beats the middle of one", () => {
  assert.deepEqual(
    fuzzyFilter(["Overview", "View Options"], "view", (t) => t),
    ["View Options", "Overview"],
  );
  assert.deepEqual(
    fuzzyFilter(["Toggle Navigator", "Go Back"], "back", (t) => t),
    ["Go Back"],
  );
});
