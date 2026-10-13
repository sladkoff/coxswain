import assert from "node:assert/strict";
import { test } from "node:test";
import { asText, parseLog } from "./git.ts";

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

test("the log gives each commit's author, co-authors, body and size", () => {
  const out =
    "\u001e12a3\u001fc8a5\u001fCy\u001fcy@x\u001f2026-10-01T00:42:35+02:00\u001fGitHub\u001fSecond\u001f\u001f\n\n 2 files changed, 3 insertions(+), 1 deletion(-)\n" +
    "\u001ec8a5\u001fa1 b2\u001fAnn\u001fann@x\u001f2026-10-01T00:42:35+02:00\u001fAnn\u001fMerge\u001fBody line\n\nCo-authored-by: Bob B <bob@x>\n\u001f\n";
  const [second, merge] = parseLog(out);
  assert.deepEqual(
    [
      second.sha,
      second.parent,
      second.author,
      second.committer,
      second.files,
      second.additions,
      second.deletions,
    ],
    ["12a3", "c8a5", "Cy", "GitHub", 2, 3, 1],
  );
  assert.deepEqual(
    [merge.parent, merge.merge, merge.body, merge.coAuthors, merge.files],
    ["a1", true, "Body line", ["Bob B"], 0],
  );
});
