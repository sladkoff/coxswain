import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CurrentUser } from "../../core/github";
import type { SummarySettings } from "../../core/jobs";
import { Button, SegmentedControl } from "./components/button";
import { TextArea, Input } from "./components/field";
import { ChevronDownIcon } from "./components/icons";
import { Card, Screen } from "./components/layout";
import { cn, muted } from "./components/styles";
import { ErrorText, ProblemMessage } from "./components/text";
import { core, queryClient } from "./queries";

// workspaceId: the one on screen, whose worktree an agent is asked in for its models. newPrompt: opened from New View's
// New Prompt…, so the new prompt's title has the focus.
export function Settings({
  onClose,
  workspaceId,
  newPrompt,
}: {
  onClose: () => void;
  workspaceId?: number;
  newPrompt?: boolean;
}) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const check = () => {
    setUser(null);
    window.coxswain.currentUser().then(setUser);
  };
  useEffect(check, []);

  return (
    <Screen title="Settings" onClose={onClose} className="max-w-xl overflow-auto">
      <h2 className="mb-3 font-medium">GitHub account</h2>
      <Card className="flex min-h-16 items-center gap-3">
        {!user ? (
          <span className={muted}>Checking…</span>
        ) : user.status === "signed-in" ? (
          <>
            <img src={user.avatarUrl} alt="" className="size-10 rounded-full" />
            <div>
              <div className="font-medium">{user.name ?? user.login}</div>
              <div className={muted}>@{user.login} · signed in through the GitHub CLI</div>
            </div>
          </>
        ) : (
          <>
            <ProblemMessage problem={user} />
            <Button className="ml-auto shrink-0" onClick={check}>
              Check again
            </Button>
          </>
        )}
      </Card>
      <h2 className="mt-6 mb-3 font-medium">File summaries</h2>
      <Summaries workspaceId={workspaceId} />
      <h2 className="mt-6 mb-3 font-medium">View prompts</h2>
      <Prompts newPrompt={newPrompt} />
      <h2 className="mt-6 mb-3 font-medium">About</h2>
      <Card className="select-text">
        coxswain {__VERSION__} <span className={muted}>· {__COMMIT__}</span>
      </Card>
    </Screen>
  );
}

// ADR 0029: the summary agent and model, and whether to summarise ahead. The model is picked from what the agent
// offers, asked in the workspace on screen; without one, only its default can be picked.
function Summaries({ workspaceId }: { workspaceId?: number }) {
  const settings = useQuery(core("getSummarySettings")).data;
  const picks = useQuery({
    ...core("listAgentPicks", workspaceId ?? 0, settings?.agent ?? "claude"),
    enabled: !!settings && workspaceId !== undefined,
  });
  const [error, setError] = useState<string | null>(null);
  if (!settings) return <Card className={muted}>Loading…</Card>;
  const save = async (s: Partial<SummarySettings>) => {
    setError(null);
    try {
      await window.coxswain.setSummarySettings(s);
    } catch (e) {
      setError((e as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: core("getSummarySettings").queryKey });
  };
  const choices = [
    { value: "", name: "The agent's default" },
    ...(picks.data?.model?.choices.filter((c) => c.value !== "default") ?? []),
  ];
  const model = choices.find((c) => c.value === settings.model)?.name ?? settings.model;
  return (
    <Card className="flex flex-col gap-3">
      <p className={muted}>
        A small model sums up each changed file in a sentence or two, so the agent can plan a view
        without reading every diff first. Activity, at the top right, shows it working.
      </p>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0">Agent</span>
        <SegmentedControl
          value={settings.agent}
          // Each agent keeps its own model; the core reads it back.
          onChange={(agent) => save({ agent })}
          options={[
            { value: "claude", label: "Claude Code" },
            { value: "codex", label: "Codex" },
          ]}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0">Model</span>
        <Button
          className="flex items-center gap-1"
          disabled={workspaceId === undefined || picks.isFetching}
          title={
            workspaceId === undefined ? "Open a workspace to see the agent's models" : undefined
          }
          onClick={async () => {
            const i = await window.coxswain.showPickMenu(
              choices.map((c) => c.name),
              choices.findIndex((c) => c.value === settings.model),
            );
            await save({ model: choices[i].value });
          }}
        >
          {model || "The agent's default"} <ChevronDownIcon />
        </Button>
        {picks.isFetching && <span className={muted}>Asking the agent…</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0">Work</span>
        <SegmentedControl
          value={settings.ahead}
          onChange={(ahead) => save({ ahead })}
          options={[
            {
              value: true,
              label: "Ahead",
              title: "When a workspace opens, its commits move on or a thread changes",
            },
            {
              value: false,
              label: "Only when needed",
              title: "When the agent starts a view, or Submit Review opens",
            },
          ]}
        />
      </div>
      <p className={cn("text-xs", muted)}>
        Ahead summarises a workspace's commits as soon as it opens, so views of big changes start
        faster, and writes a thread's conclusion as it changes, so Submit Review opens at once;
        uncommitted changes wait for a view. It spends model calls on work that may never be used.
      </p>
      {picks.isError && <ErrorText>Couldn't ask the agent for its models.</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

// The user's own prompts for New View, listed in its menu after the built-in ones. Delete and add again to change one.
// ponytail: no editing in place; add it if deleting and re-adding gets old.
function Prompts({ newPrompt }: { newPrompt?: boolean }) {
  const saved = (useQuery(core("listPrompts")).data ?? []).filter((p) => p.id !== null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: core("listPrompts").queryKey });
  const add = async () => {
    setError(null);
    try {
      await window.coxswain.savePrompt(title, body);
      setTitle("");
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    }
    await refresh();
  };
  const remove = async (id: number, name: string) => {
    const ok = await window.coxswain.confirm({
      message: `Delete the prompt “${name}”?`,
      detail: "Views made with it stay.",
      action: "Delete",
    });
    if (!ok) return;
    await window.coxswain.deletePrompt(id);
    await refresh();
  };
  return (
    <Card className="flex flex-col gap-3">
      <p className={muted}>
        New View's menu lists these after the built-in ones. The agent gets the prompt, with what
        you type along with it, and makes a view with coxswain's tools.
      </p>
      {saved.map((p) => (
        <div key={p.id} className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{p.title}</div>
            <div className={cn("line-clamp-3 text-xs whitespace-pre-wrap", muted)}>{p.body}</div>
          </div>
          <Button className="shrink-0" onClick={() => remove(p.id!, p.title)}>
            Delete
          </Button>
        </div>
      ))}
      <Input
        autoFocus={newPrompt}
        placeholder="Title, e.g. Security"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <TextArea
        rows={4}
        placeholder="Make a guide to this workspace's changes with coxswain's tools that focuses on…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={add}
      />
      <Button className="self-end" disabled={!title.trim() || !body.trim()} onClick={add}>
        Add Prompt
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
