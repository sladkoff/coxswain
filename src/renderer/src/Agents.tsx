import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Agent, AgentSession, ChatEntry, Permission, Pick } from "../../core/agents";
import type { Workspace } from "../../core/workspaces";
import { Entry, TurnStatus, upsert } from "./ChatEntry";
import { Button } from "./components/button";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  GaugeIcon,
  PanelLeftIcon,
  SparklesIcon,
  SquarePenIcon,
  StopIcon,
} from "./components/icons";
import { TextArea } from "./components/field";
import { cn, divider, muted, noDrag, titleBar } from "./components/styles";
import { shortDateTime } from "./format";
import { core, queryClient } from "./queries";

const agentNames: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

// L4: a chat with one of the workspace's agent sessions, the latest unless another is picked in the header. A new
// session starts with its first message, on the agent picked in New session's menu. The composer picks the model and
// effort, which every session of that agent runs on.
// ponytail: comments still go to the latest session, not the one shown; pass the shown one to ask and sendReview if that
// confuses.
type Props = {
  workspace: Workspace;
  onViewThread: (threadId: number) => void;
  // Replaces the composer's draft when it changes (the Guide menu's prompts), for the user to edit and send.
  composerText?: { text: string };
  onShowSidebar?: () => void; // given while the sidebar is hidden: the window buttons are then over this header
};

export function Agents({ workspace, onViewThread, composerText, onShowSidebar }: Props) {
  const sessions = useQuery(core("listAgentSessions", workspace.id)).data ?? [];
  // The agent session picked in the header; null is the latest, 'new' one not started yet.
  const [picked, setPicked] = useState<string | null>(null);
  const last = picked ? sessions.find((s) => s.agentSessionId === picked) : sessions.at(-1);
  const transcript = useQuery({
    ...core("readTranscript", last?.agentSessionId ?? ""),
    enabled: !!last,
  }).data;
  const [session, setSession] = useState<AgentSession | null>(last ?? null);
  // The agent a new session gets: picked in New session's menu, else the one picked last.
  const lastAgent = useQuery(core("newSessionAgent")).data ?? "claude";
  const [newAgent, setNewAgent] = useState<Agent | null>(null);
  const agent = session?.agent ?? newAgent ?? lastAgent;
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
  // place of the entries streamed during the turn. Not while the turn runs: it would drop the message just sent. The
  // core has none for a session whose turn another pane started (Send all), but its entries stream here.
  useEffect(() => {
    if (!last || running) return;
    setSession(last);
    if (transcript) setEntries(transcript);
  }, [transcript, picked]);

  useEffect(() => {
    const offEntry = window.coxswain.onChatEntry((id, entry) => {
      if (id === sessionRef.current?.agentSessionId) setEntries((e) => upsert(e, entry));
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
    // Shown at once; the core doesn't echo it for the pane's own messages. A new session's adapter can take seconds.
    setEntries((e) => [...e, { kind: "user", text: message }]);
    setDraft("");
    setError(null);
    setRunning(true);
    let current = session;
    try {
      current ??= await window.coxswain.startAgentSession(workspace.id, agent);
    } catch (e) {
      setRunning(false);
      return setError((e as Error).message);
    }
    sessionRef.current = current;
    setPicked(current.agentSessionId);
    setSession(current);
    const result = await window.coxswain.runTurn(current.agentSessionId, message);
    setRunning(false);
    setPermission(null);
    if (result.status === "error") setError(result.message);
  };

  // New session: on the agent picked last, or on one picked from its menu.
  const newSessionAgent = newAgent ?? lastAgent;
  const newSession = (on: Agent) => {
    setNewAgent(on);
    setPicked("new");
    setSession(null);
    setEntries([]);
    setError(null);
  };

  return (
    <>
      <div
        className={cn(
          titleBar,
          "gap-1 border-b pr-1.5",
          onShowSidebar ? "pl-20" : "pl-1.5",
          divider,
        )}
      >
        {onShowSidebar && (
          <Button
            variant="ghost"
            title="Show the sidebar"
            aria-label="Show the sidebar"
            className={cn("shrink-0 p-1 text-neutral-500", noDrag)}
            onClick={onShowSidebar}
          >
            <PanelLeftIcon />
          </Button>
        )}
        <SessionPicker
          sessions={sessions}
          current={session}
          agent={agent}
          disabled={running}
          onPick={setPicked}
        />
        <div className="flex-1" />
        <div className={cn("flex shrink-0 items-center text-neutral-500", noDrag)}>
          <Button
            variant="ghost"
            className="p-1"
            disabled={running}
            title={`New ${agentNames[newSessionAgent]} session`}
            aria-label="New session"
            onClick={() => newSession(newSessionAgent)}
          >
            <SquarePenIcon />
          </Button>
          <Button
            variant="ghost"
            className="px-0.5 py-1"
            disabled={running}
            title="New session on…"
            aria-label="New session on…"
            onClick={async () => {
              const all = Object.keys(agentNames) as Agent[];
              const n = await window.coxswain.showPickMenu(
                all.map((a) => agentNames[a]),
                all.indexOf(newSessionAgent),
              );
              newSession(all[n]);
            }}
          >
            <ChevronDownIcon />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {entries.length === 0 && !running && (
          <div className={cn("m-auto text-xs", muted)}>
            Ask {agentNames[agent]} something to start an agent session
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
      {/* The composer: one box, the model and effort and Send (Stop while a turn runs) along its bottom. */}
      <div
        className={cn(
          "mx-2 mb-2 flex flex-col rounded-xl border bg-white focus-within:border-neutral-400 dark:bg-neutral-900 dark:focus-within:border-neutral-600",
          "border-neutral-300 dark:border-neutral-700",
        )}
      >
        <TextArea
          bare
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onSubmit={send}
          rows={2}
          placeholder={`Ask ${agentNames[agent]}…`}
          className="px-3 pt-2.5 text-sm"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <AgentPickers workspaceId={workspace.id} agent={agent} />
          <div className="flex-1" />
          {running && session ? (
            <>
              <span className={cn("mr-1.5 flex items-center gap-1.5 text-xs", muted)}>
                <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-neutral-400 border-t-transparent" />
                Working
              </span>
              <button
                title="Stop the turn"
                aria-label="Stop"
                className="flex size-7 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                onClick={() => window.coxswain.stopTurn(session.agentSessionId)}
              >
                <StopIcon />
              </button>
            </>
          ) : (
            <button
              title="Send (Enter; Shift+Enter for a new line)"
              aria-label="Send"
              disabled={!draft.trim() || running}
              className="flex size-7 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
              onClick={send}
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// The header's pick of agent session: a button naming the shown one, and a native menu (ADR 0004) of them all, each
// by its title and when it started, with the new one not started yet at the bottom. Untitled until its first message.
function SessionPicker(props: {
  sessions: AgentSession[];
  current: AgentSession | null;
  agent: Agent;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const { sessions, current } = props;
  const agentName = (
    <span className={cn("shrink-0 text-xs", muted)}>
      {agentNames[current?.agent ?? props.agent]}
    </span>
  );
  if (!sessions.length) return agentName;
  const i = sessions.findIndex((s) => s.agentSessionId === current?.agentSessionId);
  const name = (s: AgentSession, n: number) => s.title ?? `Session ${n + 1}`;
  const labels = sessions.map(
    (s, n) => `${name(s, n)} · ${agentNames[s.agent]} · ${shortDateTime(s.createdAt)}`,
  );
  if (i < 0) labels.push("New session");
  const pick = async () => {
    const n = await window.coxswain.showPickMenu(labels, i < 0 ? sessions.length : i);
    if (n < sessions.length) props.onPick(sessions[n].agentSessionId);
  };
  return (
    <>
      <Button
        variant="ghost"
        className={cn("flex min-w-0 items-center gap-1 px-1.5 py-1 text-xs font-semibold", noDrag)}
        disabled={props.disabled}
        onClick={pick}
      >
        <span className="truncate">{i < 0 ? "New session" : name(sessions[i], i)}</span>
        <span className={cn("shrink-0", muted)}>
          <ChevronDownIcon />
        </span>
      </Button>
      {agentName}
    </>
  );
}

// The composer's model and effort for the agent's sessions: a button naming each pick and a native menu (ADR 0004) of
// the agent's choices. A pick holds from the next turn on, in every session of the agent, and for new ones.
function AgentPickers({ workspaceId, agent }: { workspaceId: number; agent: Agent }) {
  const query = core("listAgentPicks", workspaceId, agent);
  const picks = useQuery(query).data ?? {};
  const pick = async (which: Pick) => {
    const { choices, current } = picks[which]!;
    const n = await window.coxswain.showPickMenu(
      choices.map((c) => c.name),
      choices.findIndex((c) => c.value === current),
    );
    await window.coxswain.setAgentPick(agent, which, choices[n].value);
    queryClient.invalidateQueries({ queryKey: query.queryKey });
  };
  return (["model", "effort"] as const).map(
    (which) =>
      picks[which] && (
        <Button
          key={which}
          variant="ghost"
          title={which === "model" ? "Model" : "Effort"}
          className={cn("flex items-center gap-1 px-1.5 py-1 text-xs", muted)}
          onClick={() => pick(which)}
        >
          {which === "model" ? <SparklesIcon /> : <GaugeIcon />}
          {picks[which].choices.find((c) => c.value === picks[which]!.current)?.name ??
            picks[which].current}
          <ChevronDownIcon />
        </Button>
      ),
  );
}
