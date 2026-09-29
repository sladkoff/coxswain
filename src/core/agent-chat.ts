import type * as acp from "@agentclientprotocol/sdk";
import type { ChatEntry } from "./agents";
import { parseAttachmentMessage } from "./attachments.ts";

// Turns a session's updates into chat entries, streamed: each update sends the entry it grows again, under the same id,
// so text shows as it's written and a tool's title fills in (its first update carries only the tool's kind).
let nextEntry = 0;
export function chat(onEntry: (e: ChatEntry) => void) {
  let last: (ChatEntry & { name?: string | null }) | null = null;
  const tools = new Map<string, ChatEntry & { name?: string | null }>();
  let messageId: string | null | undefined;
  const emit = (e: typeof last) => {
    last = e;
    if (e?.text.trim())
      onEntry({ id: e.id, kind: e.kind, text: e.kind === "tool" ? e.text : e.text.trim() });
  };
  return (u: acp.SessionUpdate) => {
    // A subagent's updates carry the Agent call's id; L4 shows only the main thread, as before.
    if (
      (u as { _meta?: { claudeCode?: { parentToolUseId?: string } } })._meta?.claudeCode
        ?.parentToolUseId
    )
      return;
    if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "user_message_chunk") {
      if (u.content.type !== "text") return;
      const kind = u.sessionUpdate === "agent_message_chunk" ? "text" : "user";
      // A new messageId is a new message, such as the agent's reply after a subagent it waited on finished.
      const startsAttachments = kind === "user" && !!parseAttachmentMessage(u.content.text);
      const same =
        !startsAttachments &&
        last?.kind === kind &&
        (!u.messageId || !messageId || u.messageId === messageId);
      // Our leading text block owns the visible message. Replayed image links and embedded resource text
      // are shown through the stored attachments, not duplicated as base64 or expanded file contents.
      if (same && kind === "user" && parseAttachmentMessage(last!.text)) return;
      messageId = u.messageId ?? messageId;
      emit({
        id: same ? last!.id : nextEntry++,
        kind,
        text: (same ? last!.text : "") + u.content.text,
      });
    } else if (u.sessionUpdate === "tool_call") {
      const tool = { id: nextEntry++, kind: "tool" as const, text: toolTitle(u), name: u.name };
      tools.set(u.toolCallId, tool);
      emit(tool);
    } else if (u.sessionUpdate === "tool_call_update" && u.title) {
      // Tools the agent calls in parallel start one after another, and their titles come in later, in any order.
      const tool = tools.get(u.toolCallId);
      if (!tool) return;
      tool.text = toolTitle({ title: u.title, name: u.name ?? tool.name });
      const after = last;
      emit(tool);
      last = after;
    }
  };
}

// e.g. "Read src/a.ts", "Bash git status". ponytail: tool results aren't shown; add them collapsed under the call.
function toolTitle(u: { title: string; name?: string | null }): string {
  const title = u.title.split("\n")[0].slice(0, 120);
  return u.name && !title.startsWith(u.name) ? `${u.name} ${title}` : title;
}
