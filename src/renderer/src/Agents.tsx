import { useQuery } from "@tanstack/react-query";
import { match, P } from "ts-pattern";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentSession, Pick } from "../../core/agents";
import type { Attachment } from "../../core/attachments";
import { Attachments, draftAttachmentPreviews } from "./Attachments";
import type { BackgroundTask, QueuedMessage } from "../../core/session-state";
import type { AttachedPrompt } from "../../core/views";
import type { Workspace } from "../../core/workspaces";
import { Entry, TurnStatus } from "./ChatEntry";
import { FindBar } from "./FindBar";
import { chatFindTarget, findSnapshot, refreshFind, registerFindTarget } from "./find";
import { Button } from "./components/button";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  GaugeIcon,
  PanelLeftIcon,
  PaperclipIcon,
  SparklesIcon,
  SpinnerIcon,
  SquarePenIcon,
  StopIcon,
  XIcon,
} from "./components/icons";
import { TextArea } from "./components/field";
import { cn, divider, muted, noDrag, titleBar } from "./components/styles";
import { count, shortDateTime } from "./format";
import { core, queryClient } from "./queries";
import { setAgentPane, useAgentPane } from "./agent-pane";

export const agentNames: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

// L4: a chat with one of the workspace's agent sessions: the current one (last used), or another picked in the header,
// which then becomes current, so comments go to the session shown. A new session starts with its first message, on the
// agent picked in New session's menu. The composer picks the model and effort, which every session of that agent runs
// on.
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
  const { picked, newAgent, draft, attached, attachments, attaching } = pane;
  const [dragging, setDragging] = useState(false);
  const sessionsQuery = useQuery(core("listAgentSessions", workspace.id));
  const sessions = sessionsQuery.data ?? [];
  const session = picked
    ? sessions.find((s) => s.agentSessionId === picked)
    : (sessions.find((s) => s.current) ?? sessions.at(-1));
  const state = useQuery({
    ...core("readAgentState", session?.agentSessionId ?? ""),
    enabled: !!session,
  });
  const live = state.data;
  // Sending and its pending message belong to one session, so another can be shown meanwhile.
  const sendingHere = pane.sending === (session?.agentSessionId ?? "new");
  const running = sendingHere || !!live?.running;
  const permission = live?.permission ?? null;
  const error = pane.error ?? live?.error ?? state.error?.message ?? null;
  const entries = live?.entries ?? [];
  const pendingMessage =
    sendingHere && pane.pendingMessage && (!live || live.revision <= pane.beforeRevision)
      ? pane.pendingMessage
      : null;
  const loading = !sessionsQuery.data || (!!session && !live);
  const lastAgent = useQuery(core("newSessionAgent")).data ?? "claude";
  const agent = session?.agent ?? newAgent ?? lastAgent;
  const capabilities = useQuery(core("agentAttachmentCapabilities", agent));
  const unsupportedImages = capabilities.isSuccess && !capabilities.data.image;
  const attachmentError =
    unsupportedImages && attachments.some((a) => a.content.type === "image")
      ? "This agent does not support image attachments. Remove the images or choose another agent."
      : null;
  const addAttachments = async (read: () => Promise<Attachment[]>) => {
    if (attaching) return;
    patch({ attaching: true, error: null });
    try {
      const added = await read();
      setAgentPane(workspace.id, (before) => {
        const next = [...before.attachments, ...added];
        if (next.length > 10) return { error: "Attach up to 10 files per message." };
        if (next.reduce((sum, a) => sum + a.size, 0) > 20 * 1024 * 1024)
          return { error: "Attachments must total 20 MB or less." };
        return { attachments: next };
      });
    } catch (e) {
      patch({ error: (e as Error).message });
    } finally {
      patch({ attaching: false });
    }
  };
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!composerPrompt || composerPrompt === pane.composerPrompt) return;
    patch({ attached: composerPrompt.prompt, composerPrompt });
    composer.current?.focus();
  }, [composerPrompt]);

  const transcript = useRef<HTMLDivElement>(null);
  const findTarget = useMemo(
    () => chatFindTarget(() => transcript.current),
    [workspace.id, session?.agentSessionId],
  );
  useEffect(() => registerFindTarget(findTarget), [findTarget]);
  useEffect(() => {
    refreshFind(findTarget);
  }, [findTarget, entries]);
  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: Chromium's scrollIntoView returns a promise, which React would take for a cleanup function.
  useEffect(() => {
    if (findSnapshot().target !== findTarget) bottom.current?.scrollIntoView();
  }, [entries, running, permission]);

  const send = async () => {
    const message = draft.trim();
    // While a turn runs the message queues behind it (#24); only a session still starting holds sends back.
    if (
      (!message && !attached && !attachments.length) ||
      (sendingHere && !session) ||
      loading ||
      attaching ||
      attachmentError
    )
      return;
    patch({
      sending: session?.agentSessionId ?? "new",
      pendingMessage: attached
        ? {
            kind: "user",
            text: "",
            view: { title: attached.title, note: message },
            attachments: draftAttachmentPreviews(attachments),
          }
        : { kind: "user", text: message, attachments: draftAttachmentPreviews(attachments) },
      beforeRevision: live?.revision ?? 0,
      draft: "",
      attached: null,
      attachments: [],
      error: null,
    });
    const restore = (error: string) =>
      setAgentPane(workspace.id, (before) => ({
        error,
        draft: draft && before.draft ? `${draft}\n\n${before.draft}` : draft || before.draft,
        attached: before.attached ?? attached,
        attachments: [
          ...attachments,
          ...before.attachments.filter((a) => !attachments.some((sent) => sent.id === a.id)),
        ],
      }));
    let target = session?.agentSessionId ?? "new";
    try {
      const current = session ?? (await window.coxswain.startAgentSession(workspace.id, agent));
      // Do this even if the pane has unmounted while session creation was pending.
      queryClient.setQueryData(core("listAgentSessions", workspace.id).queryKey, (before = []) =>
        before.some((s) => s.agentSessionId === current.agentSessionId)
          ? before
          : [...before, current],
      );
      target = current.agentSessionId;
      patch({ picked: target, sending: target });
      const result = await window.coxswain.runTurn(
        current.agentSessionId,
        message,
        attached ?? undefined,
        attachments,
      );
      if (result.status === "error") restore(result.message);
    } catch (e) {
      restore((e as Error).message);
    } finally {
      setAgentPane(workspace.id, (before) =>
        before.sending === target ? { sending: null, pendingMessage: null } : {},
      );
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
          onPick={(picked) => {
            patch({ picked, error: null });
            void window.coxswain.pickAgentSession(picked);
          }}
        />
        <div className="flex-1" />
        <div className={cn("flex shrink-0 items-center text-neutral-500", noDrag)}>
          <Button
            variant="ghost"
            className="p-1"
            title={`New ${agentNames[newSessionAgent]} session`}
            aria-label="New session"
            onClick={() => newSession(newSessionAgent)}
          >
            <SquarePenIcon />
          </Button>
          <Button
            variant="ghost"
            className="px-0.5 py-1"
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
      <FindBar pane="chat" />
      <div
        ref={transcript}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
      >
        {loading && !running && <div className={cn("m-auto text-xs", muted)}>Loading session…</div>}
        {entries.length === 0 && !running && !loading && (
          <div className={cn("m-auto text-xs", muted)}>
            Ask {agentNames[agent]} something to start an agent session
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} data-find-entry={i} className="contents">
            <Entry entry={e} onViewThread={onViewThread} />
          </div>
        ))}
        {pendingMessage && <Entry entry={pendingMessage} />}
        <TurnStatus
          running={running}
          permission={permission}
          error={error ?? attachmentError}
          onAnswer={(optionId) => {
            window.coxswain.answerPermission(permission!.id, optionId);
          }}
        />
        <div ref={bottom} />
      </div>
      {/* The composer: one box, the model and effort and Send (Stop while a turn runs) along its bottom. */}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = attaching ? "none" : "copy";
          setDragging(!attaching);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) void addAttachments(() => window.coxswain.prepareAttachments(files));
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (!files.length) return;
          e.preventDefault();
          void addAttachments(() => window.coxswain.prepareAttachments(files));
        }}
        className={cn(
          dragging && "ring-2 ring-neutral-400",
          "mx-2 mb-2 flex flex-col rounded-xl border bg-white focus-within:border-neutral-400 dark:bg-neutral-900 dark:focus-within:border-neutral-600",
          "border-neutral-300 dark:border-neutral-700",
        )}
      >
        {session && !!live?.tasks.length && (
          <BackgroundTasks agentSessionId={session.agentSessionId} tasks={live.tasks} />
        )}
        {session && !!live?.queued.length && (
          <Queued agentSessionId={session.agentSessionId} queued={live.queued} />
        )}
        {attached && <AttachedCard prompt={attached} onRemove={() => patch({ attached: null })} />}
        <Attachments
          attachments={draftAttachmentPreviews(attachments)}
          onRemove={(id) =>
            setAgentPane(workspace.id, (before) => ({
              attachments: before.attachments.filter((a) => a.id !== id),
            }))
          }
        />
        {attaching && <div className={cn("px-3 py-1 text-xs", muted)}>Adding attachments…</div>}
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
          <Button
            variant="ghost"
            className={cn("shrink-0 p-1.5", muted)}
            title="Attach files"
            aria-label="Attach files"
            disabled={attaching}
            onClick={() => void addAttachments(() => window.coxswain.pickAttachments())}
          >
            <PaperclipIcon />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <AgentPickers workspaceId={workspace.id} agent={agent} />
          </div>
          {running && session && (
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
          )}
          {(!running || !session || !!draft.trim() || !!attached || !!attachments.length) && (
            <button
              title={
                running
                  ? "Queue after this turn (Enter)"
                  : "Send (Enter; Shift+Enter for a new line)"
              }
              aria-label={running ? "Queue" : "Send"}
              disabled={
                (!draft.trim() && !attached && !attachments.length) ||
                (sendingHere && !session) ||
                loading ||
                attaching ||
                !!attachmentError
              }
              className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
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

// The commands the agent left running in the background, each with Stop, and its subagents, on top of the composer
// while they run. The agent is told when a command ends and answers on its own; the turn's Stop stops subagents.
function BackgroundTasks(props: { agentSessionId: string; tasks: BackgroundTask[] }) {
  return (
    <div className={cn("flex flex-col border-b px-2 py-1 text-xs", divider)}>
      {props.tasks.map((t) => (
        <div key={t.id} className="flex min-w-0 items-center gap-1.5">
          <span className={cn("shrink-0", muted)}>
            <SpinnerIcon />
          </span>
          <span className="min-w-0 flex-1 truncate" title={t.name}>
            {t.subagent && <span className={muted}>Agent </span>}
            {t.name}
          </span>
          {!t.subagent && (
            <Button
              variant="ghost"
              className="shrink-0 p-0.5 text-neutral-500"
              title="Stop this background command"
              aria-label={`Stop ${t.name}`}
              onClick={() => window.coxswain.stopBackgroundTask(props.agentSessionId, t.id)}
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// Messages sent while the turn runs, waiting for it to end, on top of the composer: each with Send now, which puts it
// into the running turn, and × to take it off. A comment has no Send now: its answer would go to the running turn's
// thread, not its own.
function Queued(props: { agentSessionId: string; queued: QueuedMessage[] }) {
  return (
    <div className={cn("flex flex-col border-b px-2 py-1 text-xs", divider)}>
      {props.queued.map(({ id, entry: e }) => {
        const text = match(e)
          .with({ comment: P.nonNullable.select() }, (c) => `Comment on ${c.where}: ${c.body}`)
          .with({ review: P.nonNullable.select() }, (r) => `Review · ${count(r.threads, "thread")}`)
          .with(
            { view: P.nonNullable.select() },
            (v) => `View · ${v.title}${v.note ? `: ${v.note}` : ""}`,
          )
          .otherwise(() => e.text || (e.attachments ?? []).map((a) => a.name).join(", "));
        return (
          <div key={id} className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0", muted)}>Queued</span>
            <span className="min-w-0 flex-1 truncate" title={text}>
              {text}
            </span>
            {!e.comment && (
              <Button
                variant="ghost"
                className="shrink-0 px-1 py-0.5"
                title="Send into the running turn now"
                onClick={() => window.coxswain.steerQueued(props.agentSessionId, id)}
              >
                Send now
              </Button>
            )}
            <Button
              variant="ghost"
              className="shrink-0 p-0.5 text-neutral-500"
              title="Don't send this message"
              aria-label="Remove from the queue"
              onClick={() => window.coxswain.unqueue(props.agentSessionId, id)}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
