import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  attachmentContent,
  attachmentImage,
  attachmentPreviews,
  attachmentLimits,
  attachmentMessage,
  checkAttachments,
  parseAttachmentMessage,
  prepareAttachments,
  saveAttachments,
  sessionAttachments,
} from "./attachments.ts";
import { openDatabase } from "./db.ts";
import { chat } from "./agent-chat.ts";
import type { ChatEntry } from "./agents";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("clipboard images and UTF-8 files become ACP content; binary files use escaped paths", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-attachments-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "a #1.pdf");
  await writeFile(path, Buffer.from([37, 80, 68, 70, 0, 255]));
  const attachments = await prepareAttachments([
    { name: "screenshot.png", bytes: png },
    { name: "example.ts", bytes: Buffer.from("// héllo\nconst x = 1;") },
    { path },
  ]);
  const blocks = attachmentContent(attachments, { image: true, embeddedContext: true });
  assert.deepEqual(blocks[0], { type: "text", text: "Image: screenshot.png" });
  assert.deepEqual(blocks[1], {
    type: "image",
    mimeType: "image/png",
    data: png.toString("base64"),
  });
  assert.equal(blocks[2].type, "resource");
  assert.deepEqual(blocks[3], {
    type: "resource_link",
    uri: pathToFileURL(path).href,
    name: "a #1.pdf",
    mimeType: "application/pdf",
    size: 6,
  });
  assert.throws(() => attachmentContent(attachments, {}), /does not support image/);
  assert.deepEqual(attachmentContent([attachments[1]], {}), [
    { type: "text", text: "File: example.ts\n// héllo\nconst x = 1;" },
  ]);
  await writeFile(path, "%PDF-1.7\nASCII-only PDF body");
  assert.equal((await prepareAttachments([{ path }]))[0].content.type, "file");
  // Captured content is a snapshot; changing an original text file does not change the attachment.
  const textPath = join(dir, "note.txt");
  await writeFile(textPath, "original");
  const [text] = await prepareAttachments([{ path: textPath }]);
  await writeFile(textPath, "changed");
  assert.deepEqual(text.content, { type: "text", text: "original" });
  await assert.rejects(prepareAttachments([{ path: dir }]), /folders cannot/);
});

test("attachment limits bound payloads and unsupported binary clipboard data is rejected", async () => {
  const [image] = await prepareAttachments([{ name: "image.png", bytes: png }]);
  assert.throws(() => checkAttachments(Array(11).fill(image)), /up to 10/);
  assert.throws(
    () => checkAttachments([{ ...image, size: attachmentLimits.total + 1 }]),
    /total 20 MB/,
  );
  assert.throws(() => checkAttachments([{ ...image, mimeType: "image/svg+xml" }]), /PNG, JPEG/);
  await assert.rejects(
    prepareAttachments([
      { name: "large.png", bytes: Buffer.concat([png, Buffer.alloc(attachmentLimits.image)]) },
    ]),
    /images must be 5 MB/,
  );
  await assert.rejects(
    prepareAttachments([{ name: "binary", bytes: Buffer.from([0, 255]) }]),
    /attach this file from disk/,
  );
});

test("previews survive database reopen, stay scoped to their session, and cascade on removal", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coxswain-attachments-db-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "test.db");
  let db = openDatabase(path);
  await db
    .insertInto("projects")
    .values({ id: 1, owner: "test", name: "repo", last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({
      id: 1,
      project_id: 1,
      pr_number: 1,
      branch: null,
      base_branch: null,
      last_opened_at: "",
    })
    .execute();
  await db
    .insertInto("agent_sessions")
    .values({ workspace_id: 1, agent: "codex", agent_session_id: "s", created_at: "", title: null })
    .execute();
  const attachments = await prepareAttachments([{ name: "image.png", bytes: png }]);
  const id = await saveAttachments(db, "s", attachments);
  const previews = attachmentPreviews(attachments, id);
  assert.equal(previews[0].bundleId, id);
  assert.equal(
    JSON.stringify(previews).includes(png.toString("base64")),
    false,
    "streamed previews contain no image bytes",
  );
  await db.destroy();
  db = openDatabase(path);
  t.after(() => db.destroy());
  assert.deepEqual((await sessionAttachments(db, "s")).get(id), attachments);
  assert.equal((await sessionAttachments(db, "other")).size, 0);
  assert.equal(
    await attachmentImage(db, id, attachments[0].id),
    `data:image/png;base64,${png.toString("base64")}`,
  );
  assert.equal(await attachmentImage(db, id, "missing"), null);
  const missing = join(dir, "removed.pdf");
  await writeFile(missing, "%PDF-1.7\nA document");
  const references = await prepareAttachments([{ path: missing }]);
  await rm(missing);
  await assert.rejects(saveAttachments(db, "s", references), /ENOENT/);
  assert.equal(
    (await sessionAttachments(db, "s")).size,
    1,
    "missing files are rejected before storage",
  );
  assert.deepEqual(parseAttachmentMessage(attachmentMessage(id, "[View · Guide]\nfocus")), {
    id,
    text: "[View · Guide]\nfocus",
  });
  assert.deepEqual(parseAttachmentMessage(attachmentMessage(id, "").trim()), { id, text: "" });
  await db.deleteFrom("workspaces").where("id", "=", 1).execute();
  assert.equal((await sessionAttachments(db, "s")).size, 0);
  assert.equal(await attachmentImage(db, id, attachments[0].id), null);
});

test("ACP replay groups previews with their message without exposing image data or file bodies", () => {
  const entries = new Map<number | undefined, ChatEntry>();
  const update = chat((entry) => entries.set(entry.id, entry));
  const id = "00000000-0000-4000-8000-000000000000";
  const prompt = attachmentMessage(id, "Look at this");
  update({
    sessionUpdate: "user_message_chunk",
    messageId: "u1",
    content: { type: "text", text: prompt },
  });
  update({
    sessionUpdate: "user_message_chunk",
    messageId: "u1",
    content: { type: "text", text: "[@image](data:image/png;base64,very-long-data)" },
  });
  update({
    sessionUpdate: "user_message_chunk",
    messageId: "u1",
    content: { type: "image", data: png.toString("base64"), mimeType: "image/png" },
  });
  update({
    sessionUpdate: "user_message_chunk",
    messageId: "u1",
    content: { type: "text", text: "<context>file contents</context>" },
  });
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "a1",
    content: { type: "text", text: "I see it." },
  });
  update({
    sessionUpdate: "user_message_chunk",
    messageId: "u2",
    content: { type: "text", text: "Next question" },
  });
  assert.deepEqual(
    [...entries.values()].map((e) => e.text),
    [prompt, "I see it.", "Next question"],
  );
  // Claude replay may omit messageId; two attachment-only user messages still stay separate.
  update({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: attachmentMessage(id, "") },
  });
  update({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: attachmentMessage(id, "") },
  });
  assert.equal(entries.size, 5);
});
