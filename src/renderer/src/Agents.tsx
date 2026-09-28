import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Agent, AgentSession, Pick } from "../../core/agents";
import type { AttachedPrompt } from "../../core/views";
import type { Workspace } from "../../core/workspaces";
import { Entry, TurnStatus } from "./ChatEntry";
import { Button } from "./components/button";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  GaugeIcon,
  PanelLeftIcon,
  SparklesIcon,
  SquarePenIcon,
  StopIcon,
  XIcon,
} from "./components/icons";
import { TextArea } from "./components/field";
import { cn, divider, muted, noDrag, titleBar } from "./components/styles";
import { shortDateTime } from "./format";
import { core, queryClient } from "./queries";
import { setAgentPane, useAgentPane } from "./agent-pane";

const agentNames: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

// L4: a chat with one of the workspace's agent sessions, the latest unless another is picked in the header. A new
// session starts with its first message, on the agent picked in New session's menu. The composer picks the model and
// effort, which every session of that agent runs on.
// ponytail: comments still go to the latest session, not the one shown; pass the shown one to ask and sendReview if that
// confuses.
type Props = {
  workspace: Workspace;
  onViewThread: (threadId: number) => void;
  // Attached to the composer when it changes (the New View menu's prompts), for the user to send with a note.
  composerPrompt?: { prompt: AttachedPrompt };
  onShowSidebar?: () => void; // given while the sidebar is hidden: the window buttons are then over this header
};

export function Agents({ workspace, onViewThread, composerPrompt, onShowSidebar }: Props) {
  const pane = useAgentPane(workspace.id);
  const patch = (change: Parameters<typeof setAgentPane>[1]) => setAgentPane(workspace.id, change);
  const { picked, newAgent, draft, attached } = pane;
  const sessionsQuery = useQuery(core("listAgentSessions", workspace.id));
  const sessions = sessionsQuery.data ?? [];
  const session = picked ? sessions.find((s) => s.agentSessionId === picked) : sessions.at(-1);
  const state = useQuery({
    ...core("readAgentState", session?.agentSessionId ?? ""),
    enabled: !!session,
  });
  const live = state.data;
  const running = pane.sending || !!live?.running;
  const permission = live?.permission ?? null;
  const error = pane.error ?? live?.error ?? state.error?.message ?? null;
  const entries = live?.entries ?? [];
  const pendingMessage =
    pane.pendingMessage && (!live || live.revision <= pane.beforeRevision)
      ? pane.pendingMessage
      : null;
  const loading = !sessionsQuery.data || (!!session && !live);
  const lastAgent = useQuery(core("newSessionAgent")).data ?? "claude";
  const agent = session?.agent ?? newAgent ?? lastAgent;
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!composerPrompt || composerPrompt === pane.composerPrompt) return;
    patch({ attached: composerPrompt.prompt, composerPrompt });
    composer.current?.focus();
  }, [composerPrompt]);

  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: Chromium's scrollIntoView returns a promise, which React would take for a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [entries, running, permission]);

  const send = async () => {
    const message = draft.trim();
    if ((!message && !attached) || running || loading) return;
    patch({
      sending: true,
      pendingMessage: attached
        ? { kind: "user", text: "", view: { title: attached.title, note: message } }
        : { kind: "user", text: message },
      beforeRevision: live?.revision ?? 0,
      draft: "",
      attached: null,
      error: null,
    });
    try {
      const current = session ?? (await window.coxswain.startAgentSession(workspace.id, agent));
      // Do this even if the pane has unmounted while session creation was pending.
      queryClient.setQueryData(core("listAgentSessions", workspace.id).queryKey, (before = []) =>
        before.some((s) => s.agentSessionId === current.agentSessionId)
          ? before
          : [...before, current],
      );
      patch({ picked: current.agentSessionId });
      const result = await window.coxswain.runTurn(
        current.agentSessionId,
        message,
        attached ?? undefined,
      );
      if (result.status === "error") patch({ error: result.message });
    } catch (e) {
      patch({ error: (e as Error).message });
    } finally {
      patch({ sending: false, pendingMessage: null });
    }
  };

  const newSessionAgent = newAgent ?? lastAgent;
  const newSession = (on: Agent) => patch({ newAgent: on, picked: "new", error: null });

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
          current={session ?? null}
          agent={agent}
          disabled={running}
          onPick={(picked) => patch({ picked, error: null })}
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
        {loading && !running && <div className={cn("m-auto text-xs", muted)}>Loading session…</div>}
        {entries.length === 0 && !running && !loading && (
          <div className={cn("m-auto text-xs", muted)}>
            Ask {agentNames[agent]} something to start an agent session
          </div>
        )}
        {entries.map((e, i) => (
          <Entry key={i} entry={e} onViewThread={onViewThread} />
        ))}
        {pendingMessage && <Entry entry={pendingMessage} />}
        <TurnStatus
          running={running}
          permission={permission}
          error={error}
          onAnswer={(optionId) => {
            window.coxswain.answerPermission(permission!.id, optionId);
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
        {attached && <AttachedCard prompt={attached} onRemove={() => patch({ attached: null })} />}
        <TextArea
          bare
          ref={composer}
          value={draft}
          onChange={(e) => patch({ draft: e.target.value })}
          onSubmit={send}
          rows={2}
          placeholder={attached ? "What to focus on (optional)…" : `Ask ${agentNames[agent]}…`}
          className="px-3 pt-2.5 text-sm"
        />
        {/* However narrow the pane: the picks shrink and truncate, Working keeps only its spinner, Send and Stop stay. */}
        <div className="@container flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <AgentPickers workspaceId={workspace.id} agent={agent} />
          </div>
          {running && session ? (
            <>
              <span
                title="Working"
                className={cn("mr-1.5 flex shrink-0 items-center gap-1.5 text-xs", muted)}
              >
                <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-neutral-400 border-t-transparent" />
                <span className="hidden @[17rem]:inline">Working</span>
              </span>
              <button
                title="Stop the turn"
                aria-label="Stop"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                onClick={() => window.coxswain.stopTurn(session.agentSessionId)}
              >
                <StopIcon />
              </button>
            </>
          ) : (
            <button
              title="Send (Enter; Shift+Enter for a new line)"
              aria-label="Send"
              disabled={(!draft.trim() && !attached) || running || loading}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
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
  const label = (which: Pick) =>
    picks[which]!.choices.find((c) => c.value === picks[which]!.current)?.name ??
    picks[which]!.current;
  return (["model", "effort"] as const).map(
    (which) =>
      picks[which] && (
        <Button
          key={which}
          variant="ghost"
          title={`${which === "model" ? "Model" : "Effort"}: ${label(which)}`}
          className={cn(
            "flex min-w-0 items-center gap-1 px-1.5 py-1 text-xs whitespace-nowrap [&>svg]:shrink-0",
            muted,
          )}
          onClick={() => pick(which)}
        >
          {which === "model" ? <SparklesIcon /> : <GaugeIcon />}
          <span className="truncate">{label(which)}</span>
          <ChevronDownIcon />
        </Button>
      ),
  );
}

// A New View prompt on the composer, like a comment sent to the agent: its title, then the prompt it sends (a few
// lines; a click shows it all). × takes it off.
function AttachedCard(props: { prompt: AttachedPrompt; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("mx-2 mt-2 flex flex-col rounded-lg border text-xs", divider)}>
      <div className="flex items-center gap-1 pt-1 pr-1 pl-2">
        <span className={cn("min-w-0 flex-1 truncate", muted)}>
          View ·{" "}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {props.prompt.title}
          </span>
        </span>
        <Button
          variant="ghost"
          className="shrink-0 p-0.5 text-neutral-500"
          title="Remove the prompt"
          aria-label="Remove the prompt"
          onClick={props.onRemove}
        >
          <XIcon />
        </Button>
      </div>
      <button
        title={open ? "Show less" : "Show all of the prompt"}
        onClick={() => setOpen(!open)}
        className={cn(
          "px-2 pt-0.5 pb-1.5 text-left whitespace-pre-wrap [overflow-wrap:anywhere]",
          open ? "max-h-48 overflow-y-auto" : "line-clamp-3",
        )}
      >
        {props.prompt.prompt}
      </button>
    </div>
  );
}
