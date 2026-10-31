import { test } from "node:test";
import assert from "node:assert/strict";
import { changeGroup } from "./change-groups.ts";

test("Changes grouping recognizes test conventions across languages", () => {
  for (const path of [
    "tests/unit/a.py",
    "src/__tests__/a.tsx",
    "src/a.test.ts",
    "src/a_spec.py",
    "src/suggest_sample_test_setup_spec.py",
    "src/suggestSampleTestSetup.test.ts",
    "src/a_test.go",
    "src/WidgetTests.cs",
    "e2e/login.ts",
    "tests/fixtures/data.json",
  ]) {
    assert.equal(changeGroup(path), "tests", path);
  }
});
test("generated paths and artifacts take precedence over test locations", () => {
  for (const path of [
    "src/__generated__/api.ts",
    "gen/client.py",
    "dist/main.js",
    "src/routeTree.gen.ts",
    "api/service.pb.go",
    "tests/__snapshots__/a.test.ts.snap",
    "tests/generated/test_api.py",
    "pnpm-lock.yaml",
    "sub/uv.lock",
  ]) {
    assert.equal(changeGroup(path), "generated", path);
  }
});
test("ordinary source, documentation and configuration stay in Implementation", () => {
  for (const path of [
    "src/main.ts",
    "docs/testing.md",
    "package.json",
    ".github/workflows/test.yml",
    "scripts/generate.ts",
    "src/contest.ts",
    "suggest_sample_test_setup.py",
    "sample_test.py",
    "test_of_detail.py",
    "src/test_a.py",
    "src/sample_test.pyi",
    "lib/domain/sample_testing/services/agent/suggest_sample_test_setup.py",
    "src/sample_test_result.ts",
    "src/build_spec_document.py",
    "src/Contest.java",
    "db/migrations/001.sql",
  ]) {
    assert.equal(changeGroup(path), "implementation", path);
  }
});
