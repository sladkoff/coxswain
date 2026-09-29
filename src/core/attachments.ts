import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk";
import type { Db } from "./db";

export const attachmentLimits = {
  count: 10,
  file: 20 * 1024 * 1024,
  image: 5 * 1024 * 1024,
  text: 1024 * 1024,
  total: 20 * 1024 * 1024,
};
export type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  content:
    | { type: "image"; data: string }
    | { type: "text"; text: string }
    | { type: "file"; path: string };
};
export type AttachmentInput = { path: string } | { name: string; bytes: Uint8Array };
// Streamed session snapshots carry references, never the attached file bodies or image bytes.
export type AttachmentPreview = Pick<Attachment, "id" | "name" | "size" | "mimeType"> & {
  type: Attachment["content"]["type"];
  bundleId?: string;
  image?: string; // An unsent draft's preview, already held by the renderer.
};
export const attachmentPreviews = (
  attachments: Attachment[],
  bundleId: string,
): AttachmentPreview[] =>
  attachments.map(({ id, name, size, mimeType, content }) => ({
    id,
    name,
    size,
    mimeType,
    type: content.type,
    bundleId,
  }));

function imageType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
}

export function checkAttachments(attachments: Attachment[]) {
  if (attachments.length > attachmentLimits.count)
    throw new Error("Attach up to 10 files per message.");
  if (attachments.reduce((sum, a) => sum + a.size, 0) > attachmentLimits.total)
    throw new Error("Attachments must total 20 MB or less.");
  for (const a of attachments) {
    if (!Number.isSafeInteger(a.size) || a.size < 0 || a.size > attachmentLimits.file)
      throw new Error(`${a.name}: files must be 20 MB or less.`);
    if (a.content.type === "image") {
      const bytes = Buffer.from(a.content.data, "base64");
      if (
        bytes.length !== a.size ||
        bytes.length > attachmentLimits.image ||
        imageType(bytes) !== a.mimeType
      )
        throw new Error(`${a.name}: use a PNG, JPEG, GIF or WebP image up to 5 MB.`);
    } else if (a.content.type === "text") {
      if (Buffer.byteLength(a.content.text) > attachmentLimits.text)
        throw new Error(`${a.name}: embedded text must be 1 MB or less.`);
    } else if (a.content.type !== "file" || !isAbsolute(a.content.path))
      throw new Error(`${a.name}: invalid file reference.`);
  }
}

// Reads live in the core. The preload supplies paths for dropped files, and bytes for clipboard images.
export async function prepareAttachments(inputs: AttachmentInput[]): Promise<Attachment[]> {
  if (inputs.length > attachmentLimits.count) throw new Error("Attach up to 10 files per message.");
  const attachments: Attachment[] = [];
  for (const input of inputs) {
    const path = "path" in input ? input.path : undefined;
    const name = path ? basename(path) : (input as { name: string }).name;
    let bytes: Buffer;
    let size: number;
    if (path) {
      if (!isAbsolute(path)) throw new Error("Choose an absolute file path.");
      const file = await open(path, "r");
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new Error(`${name}: folders cannot be attached.`);
        size = info.size;
        if (size > attachmentLimits.file) throw new Error(`${name}: files must be 20 MB or less.`);
        const buffer = Buffer.alloc(Math.min(size, attachmentLimits.image + 1));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        bytes = buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    } else {
      bytes = Buffer.from((input as { bytes: Uint8Array }).bytes);
      size = bytes.length;
    }
    const mimeType = imageType(bytes);
    let content: Attachment["content"];
    if (mimeType) {
      if (size > attachmentLimits.image) throw new Error(`${name}: images must be 5 MB or less.`);
      content = { type: "image", data: bytes.toString("base64") };
    } else {
      let text: string | undefined;
      const binary =
        bytes.toString("ascii", 0, 5) === "%PDF-" || bytes.subarray(0, 2).equals(Buffer.from("PK"));
      if (!binary && size <= attachmentLimits.text && !bytes.includes(0)) {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          /* A binary file is referenced by path. */
        }
      }
      if (text !== undefined) content = { type: "text", text };
      else if (path) content = { type: "file", path };
      else throw new Error(`${name}: paste an image or attach this file from disk.`);
    }
    attachments.push({
      id: randomUUID(),
      name,
      size,
      mimeType:
        mimeType ??
        (content.type === "text"
          ? "text/plain"
          : extname(name).toLowerCase() === ".pdf"
            ? "application/pdf"
            : "application/octet-stream"),
      content,
    });
    checkAttachments(attachments);
  }
  return attachments;
}

export function attachmentContent(
  attachments: Attachment[],
  capabilities: PromptCapabilities,
): ContentBlock[] {
  checkAttachments(attachments);
  return attachments.flatMap((a): ContentBlock[] => {
    if (a.content.type === "image") {
      if (!capabilities.image) throw new Error("This agent does not support image attachments.");
      return [
        { type: "text", text: `Image: ${a.name}` },
        { type: "image", data: a.content.data, mimeType: a.mimeType },
      ];
    }
    if (a.content.type === "text") {
      if (!capabilities.embeddedContext)
        return [{ type: "text", text: `File: ${a.name}\n${a.content.text}` }];
      return [
        {
          type: "resource",
          resource: {
            uri: `attachment://${a.id}/${encodeURIComponent(a.name)}`,
            mimeType: a.mimeType,
            text: a.content.text,
          },
        },
      ];
    }
    return [
      {
        type: "resource_link",
        uri: pathToFileURL(a.content.path).href,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
      },
    ];
  });
}

// Like view/comment headers, this links the agent-owned transcript to UI data the adapters don't preserve.
const header = /^\[Attachments · ([0-9a-f-]{36})\](?:\n|$)/;
export const attachmentMessage = (id: string, prompt: string) => `[Attachments · ${id}]\n${prompt}`;
export function parseAttachmentMessage(text: string) {
  const match = header.exec(text);
  return match ? { id: match[1], text: text.slice(match[0].length) } : null;
}

export async function saveAttachments(db: Db, sessionId: string, attachments: Attachment[]) {
  checkAttachments(attachments);
  // Fail before sending if a referenced file was moved or removed after it was picked.
  for (const a of attachments)
    if (a.content.type === "file" && !(await stat(a.content.path)).isFile())
      throw new Error(`${a.name}: file is no longer available.`);
  // ponytail: a prompt rejected after this save leaves an unreferenced record until session deletion;
  // collect unreferenced bundles during a future session cleanup, without deleting delivered-but-failed turns.
  const id = randomUUID();
  await db
    .insertInto("agent_attachments")
    .values({ id, agent_session_id: sessionId, attachments: JSON.stringify(attachments) })
    .execute();
  return id;
}

export async function sessionAttachments(
  db: Db,
  sessionId: string,
): Promise<Map<string, Attachment[]>> {
  const rows = await db
    .selectFrom("agent_attachments")
    .select(["id", "attachments"])
    .where("agent_session_id", "=", sessionId)
    .execute();
  return new Map(rows.map((row) => [row.id, JSON.parse(row.attachments) as Attachment[]]));
}

export async function attachmentImage(
  db: Db,
  bundleId: string,
  attachmentId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom("agent_attachments")
    .select("attachments")
    .where("id", "=", bundleId)
    .executeTakeFirst();
  const attachment = (row ? (JSON.parse(row.attachments) as Attachment[]) : []).find(
    (a) => a.id === attachmentId,
  );
  return attachment?.content.type === "image"
    ? `data:${attachment.mimeType};base64,${attachment.content.data}`
    : null;
}
