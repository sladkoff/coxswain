import assert from "node:assert/strict";
import { test } from "node:test";
import { follow, lineMap } from "./follow.ts";

const at = (from: string, to: string, start: number, end: number) => {
  const [a, b] = [from.split("\n"), to.split("\n")];
  return follow(lineMap(a, b), b, start, end);
};

test("lines follow their code: moved by lines above, kept when the hunk changes next to them", () => {
  const code = "a\nb\nc\nd\ne";
  assert.deepEqual(at(code, code, 2, 3), { status: "moved", start: 2, end: 3 });
  assert.deepEqual(at(code, "x\ny\na\nb\nc\nd\ne", 2, 3), { status: "moved", start: 4, end: 5 });
  assert.deepEqual(at(code, "a\nb\nc\nD\ne", 2, 3), { status: "moved", start: 2, end: 3 });
  assert.deepEqual(at(code, "a\nc\nd\ne", 4, 4), { status: "moved", start: 3, end: 3 });
});

test("changed lines say what stands there now", () => {
  const code = "a\nb\nc\nd\ne";
  assert.deepEqual(at(code, "a\nB\nc\nd\ne", 2, 3), { status: "changed", now: "B\nc" });
  assert.deepEqual(at(code, "a\nd\ne", 2, 3), { status: "changed", now: "" });
  assert.deepEqual(at(code, "a\nb\nnew\nc\nd\ne", 2, 3), { status: "changed", now: "b\nnew\nc" });
  assert.deepEqual(at(code, "z", 1, 5), { status: "changed", now: "z" });
});

test("repeated lines map to one copy each, in order", () => {
  assert.deepEqual(at("x\n}\ny\n}", "x\n}\nnew\ny\n}", 4, 4), {
    status: "moved",
    start: 5,
    end: 5,
  });
});

test("the line map is a longest common subsequence", () => {
  const lcs = (a: string[], b: string[]) => {
    const t = Array.from({ length: a.length + 1 }, () =>
      Array.from({ length: b.length + 1 }, () => 0),
    );
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t[0][0];
  };
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let run = 0; run < 500; run++) {
    const lines = () => Array.from({ length: rand(12) }, () => "abc"[rand(3)]);
    const [a, b] = [lines(), lines()];
    const map = [...lineMap(a, b)];
    const kept = map.flatMap((y, x) => (y < 0 ? [] : [[x, y]]));
    kept.forEach(([x, y], i) => {
      assert.equal(a[x], b[y]);
      if (i) assert.ok(y > kept[i - 1][1]);
    });
    assert.equal(kept.length, lcs(a, b), `${a.join("")} → ${b.join("")}`);
  }
});
