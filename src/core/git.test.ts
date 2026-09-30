import assert from "node:assert/strict";
import { test } from "node:test";
import { asText } from "./git.ts";

test("images become data URLs, other binary files don't, text stays text", () => {
  const png = asText(Buffer.from([0x89, 0x50, 0, 1]), "logo.PNG");
  assert.deepEqual(png, {
    status: "ok",
    text: null,
    binary: true,
    image: "data:image/png;base64,iVAAAQ==",
  });
  assert.deepEqual(asText(Buffer.from([0, 1]), "a.bin"), {
    status: "ok",
    text: null,
    binary: true,
  });
  assert.deepEqual(asText(Buffer.from("hi"), "a.txt"), { status: "ok", text: "hi", binary: false });
});
