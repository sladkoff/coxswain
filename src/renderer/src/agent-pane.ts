import { useSyncExternalStore } from "react";
import type { Agent } from "../../core/agents";

// Presentation state lives for the window, not for one mounting of Agents. In particular a session
// may finish starting after its workspace has been hidden. Live turns themselves belong to the core.
type Pane = {
  composerText?: { text: string };
  picked: string | null;
  newAgent: Agent | null;
  draft: string;
  sending: boolean;
  pendingMessage: string | null;
  beforeRevision: number;
  error: string | null;
};
const empty: Pane = {
  picked: null,
  newAgent: null,
  draft: "",
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
export function setAgentPane(id: number, patch: Partial<Pane>) {
  panes.set(id, { ...(panes.get(id) ?? empty), ...patch });
  listeners.forEach((listener) => listener());
}
export const useAgentPane = (id: number) =>
  useSyncExternalStore(subscribe, () => panes.get(id) ?? empty);
