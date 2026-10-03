import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readSkill, skillNames } from "./skills.ts";

test("every skill read_skill offers ships in full, after how it applies in coxswain", async () => {
  for (const name of skillNames) {
    const text = await readSkill(name);
    const skill = readFileSync(join("resources", "skills", name, "SKILL.md"), "utf8");
    assert.ok(text.startsWith(`# The ${name} skill in coxswain\n\nHere `), name);
    assert.ok(text.endsWith(skill), `${name} is served whole`);
  }
});
