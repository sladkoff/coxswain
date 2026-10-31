import assert from "node:assert/strict";
import { test } from "node:test";
import { codeSymbols } from "./code-symbol.ts";

test("generic wrappers and their arguments are independent navigation symbols", () => {
  const text = "FromDishka[SuggestSampleTestSetup],";
  assert.deepEqual(codeSymbols(text), [
    { start: 0, end: 10 },
    { start: 11, end: 33 },
  ]);
  assert.deepEqual(
    codeSymbols(text).map(({ start, end }) => text.slice(start, end)),
    ["FromDishka", "SuggestSampleTestSetup"],
  );
});

test("symbol offsets use UTF-16 like DOM ranges and language-server positions", () => {
  const text = "'pkg.module' Class[Inner[_value, $signal, café, 𐐀name]]";
  assert.deepEqual(
    codeSymbols(text).map(({ start, end }) => text.slice(start, end)),
    ["pkg", "module", "Class", "Inner", "_value", "$signal", "café", "𐐀name"],
  );
  const last = codeSymbols(text).at(-1);
  assert.ok(last);
  assert.equal(last.end - last.start, 6);
  assert.deepEqual(codeSymbols(" [](),. "), []);
});
