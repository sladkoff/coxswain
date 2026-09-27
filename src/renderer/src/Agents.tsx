import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AgentSession, ChatEntry, Permission } from "../../core/agents";
import type { Workspace } from "../../core/workspaces";
import { Entry, TurnStatus } from "./ChatEntry";
import { Button } from "./components/button";
import { TextArea } from "./components/field";
import { cn, divider, muted, noDrag, titleBar } from "./components/styles";
import { shortDateTime } from "./format";
import { core } from "./queries";

// L4: a chat with one of the workspace's agent sessions, the latest unless another is picked in the header. A new
// session starts with its first message.
// ponytail: comments still go to the latest session, not the one shown; pass the shown one to ask and sendReview if that
// confuses.
type Props = {
  workspace: Workspace;
  onViewThread: (threadId: number) => void;
  // Replaces the composer's draft when it changes (the Guide menu's prompts), for the user to edit and send.
  composerText?: { text: string };
};

export function Agents({ workspace, onViewThread, composerText }: Props) {
  const sessions = useQuery(core("listAgentSessions", workspace.id)).data ?? [];
  // The agent session picked in the header; null is the latest, 'new' one not started yet.
  const [picked, setPicked] = useState<string | null>(null);
  const last = picked ? sessions.find((s) => s.agentSessionId === picked) : sessions.at(-1);
  const transcript = useQuery({
    ...core("readTranscript", last?.agentSessionId ?? ""),
    enabled: !!last,
  }).data;
  const [session, setSession] = useState<AgentSession | null>(last ?? null);
  const [entries, setEntries] = useState<ChatEntry[]>(transcript ?? []);
  const [running, setRunning] = useState(false);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!composerText) return;
    setDraft(composerText.text);
    composer.current?.focus();
  }, [composerText]);

  // The shown agent session's transcript, once loaded or picked and again when a turn ends (the core says it changed), in
  // place of the entries streamed during the turn. Not while the turn runs: nothing refetches it then.
  useEffect(() => {
    if (!last || !transcript) return;
    setSession(last);
    setEntries(transcript);
  }, [transcript, picked]);

  useEffect(() => {
    const offEntry = window.coxswain.onChatEntry((id, entry) => {
      if (id === sessionRef.current?.agentSessionId) setEntries((e) => [...e, entry]);
    });
    const offPermission = window.coxswain.onPermission((id, p) => {
      if (id === sessionRef.current?.agentSessionId) setPermission(p);
    });
    return () => {
      offEntry();
      offPermission();
    };
  }, []);

  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: Chromium's scrollIntoView returns a promise, which React would take for a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [entries, running, permission]);

  const send = async () => {
    const message = draft.trim();
    if (!message || running) return;
    const current = session ?? (await window.coxswain.startAgentSession(workspace.id));
    sessionRef.current = current;
    setPicked(current.agentSessionId);
    setSession(current);
    setDraft("");
    setError(null);
    setRunning(true);
    const result = await window.coxswain.runTurn(current.agentSessionId, message);
    setRunning(false);
    setPermission(null);
    if (result.status === "error") setError(result.message);
  };

  const newSession = () => {
    setPicked("new");
    setSession(null);
    setEntries([]);
    setError(null);
  };

  return (
    <>
      <div className={cn(titleBar, "justify-end gap-1 border-b pr-2 pl-8", divider)}>
        <SessionPicker
          sessions={sessions}
          current={session}
          disabled={running}
          onPick={setPicked}
        />
        <Button className={cn("text-xs", noDrag)} disabled={running} onClick={newSession}>
          New session
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {entries.length === 0 && !running && (
          <div className={cn("m-auto text-xs", muted)}>
            Ask the agent something to start an agent session
          </div>
        )}
        {entries.map((e, i) => (
          <Entry key={i} entry={e} onViewThread={onViewThread} />
        ))}
        <TurnStatus
          running={running}
          permission={permission}
          error={error}
          onAnswer={(optionId) => {
            window.coxswain.answerPermission(permission!.id, optionId);
            setPermission(null);
          }}
        />
        <div ref={bottom} />
      </div>
      <div className={cn("flex flex-col gap-1 border-t p-2", divider)}>
        <TextArea
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onSubmit={send}
          rows={3}
          placeholder="Message the agent (Enter to send, Shift+Enter for a new line)"
          className="text-sm"
        />
        {running && session && (
          <Button
            className="self-end text-xs"
            onClick={() => window.coxswain.stopTurn(session.agentSessionId)}
          >
            Stop
          </Button>
        )}
      </div>
    </>
  );
}

// The header's pick of agent session: a button naming the shown one, and a native menu (ADR 0004) of them all, each
// by when it started, with the new one not started yet at the bottom.
function SessionPicker(props: {
  sessions: AgentSession[];
  current: AgentSession | null;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const { sessions, current } = props;
  if (!sessions.length) return null;
  const i = sessions.findIndex((s) => s.agentSessionId === current?.agentSessionId);
  const labels = sessions.map((s, n) => `Session ${n + 1} · ${shortDateTime(s.createdAt)}`);
  if (i < 0) labels.push("New session");
  const pick = async () => {
    const n = await window.coxswain.showSessionsMenu(labels, i < 0 ? sessions.length : i);
    if (n < sessions.length) props.onPick(sessions[n].agentSessionId);
  };
  return (
    <Button
      variant="ghost"
      className={cn("mr-auto text-xs", noDrag)}
      disabled={props.disabled}
      onClick={pick}
    >
      {i < 0 ? "New session" : `Session ${i + 1}`}
    </Button>
  );
}
