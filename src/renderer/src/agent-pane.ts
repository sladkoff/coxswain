import { useSyncExternalStore } from "react";
import type { Agent, ChatEntry } from "../../core/agents";
import type { Attachment } from "../../core/attachments";
import type { AttachedPrompt } from "../../core/views";

// Presentation state lives for the window, not for one mounting of Agents. In particular a session
// may finish starting after its workspace has been hidden. Live turns themselves belong to the core.
type Pane = {
  // The last prompt the New View menu attached, so the same one isn't attached twice; attached: the one on the
  // composer, sent with the draft.
  composerPrompt?: { prompt: AttachedPrompt };
  attached: AttachedPrompt | null;
  picked: string | null;
  newAgent: Agent | null;
  draft: string;
  attachments: Attachment[];
  attaching: boolean;
  sending: boolean;
  pendingMessage: ChatEntry | null;
  beforeRevision: number;
  error: string | null;
};
const empty: Pane = {
  picked: null,
  newAgent: null,
  draft: "",
  attachments: [],
  attaching: false,
  attached: null,
  sending: false,
  pendingMessage: null,
  beforeRevision: -1,
  error: null,
};
const panes = new Map<number, Pane>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export function setAgentPane(id: number, patch: Partial<Pane> | ((before: Pane) => Partial<Pane>)) {
  const before = panes.get(id) ?? empty;
  panes.set(id, { ...before, ...(typeof patch === "function" ? patch(before) : patch) });
  listeners.forEach((listener) => listener());
}
export const useAgentPane = (id: number) =>
  useSyncExternalStore(subscribe, () => panes.get(id) ?? empty);
