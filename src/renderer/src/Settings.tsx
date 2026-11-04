import { useCodeThemeType } from "./components/useCodeThemeType";
import { AgentSelect } from "./components/AgentSelect";
import { PreviewSelect } from "./components/PreviewSelect";
import { codeThemeOptions } from "../../shared/code-themes";
import type { DefaultPromptName } from "../../core/prompt-settings";
import { TextArea } from "./components/field";
import { File } from "@pierre/diffs/react";
import { codeThemes } from "./components/code-theme";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CodeTheme, Appearance as AppearanceMode } from "../../core/appearance";
import type { CurrentUser } from "../../core/github";
import type { GuideSettings } from "../../core/guides";
import { Button, SegmentedControl } from "./components/button";
import { Card, Screen, ListRow } from "./components/layout";
import { cn, muted } from "./components/styles";
import { ErrorText, ProblemMessage } from "./components/text";
import { core } from "./queries";
import { GuideRunOptions } from "./components/GuideRunOptions";

const settingsSections = ["Appearance", "Accounts", "Guides", "About"] as const;
type SettingsSection = (typeof settingsSections)[number];

const sectionHeading = "mb-3 text-sm font-semibold leading-5";
const helpText = cn("max-w-[80ch] text-xs leading-5", muted);

// Ask the installed agent for models using the open workspace.
export function Settings({
  onClose,
  workspaceId,
  embedded = false,
}: {
  onClose: () => void;
  workspaceId?: number;
  embedded?: boolean;
}) {
  const [section, setSection] = useState<SettingsSection>("Appearance");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const check = () => {
    setUser(null);
    window.coxswain.currentUser().then(setUser);
  };
  useEffect(check, []);

  const panels: Record<SettingsSection, ReactNode> = {
    Appearance: (
      <>
        <h3 className={sectionHeading}>Colour Mode</h3>
        <Appearance />
        <h3 className={cn(sectionHeading, "mt-6")}>Code Theme</h3>
        <CodeThemes />
      </>
    ),
    Accounts: (
      <>
        <h3 className={sectionHeading}>GitHub</h3>
        <ReviewWorkspaces />
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
      </>
    ),
    Guides: (
      <>
        <h3 className={sectionHeading}>Generation</h3>
        <GuideModels workspaceId={workspaceId} />
        <h3 className={cn(sectionHeading, "mt-6")}>Default Prompts</h3>
        <DefaultPromptSettings />
      </>
    ),
    About: (
      <Card className="select-text">
        coxswain {__VERSION__} <span className={muted}>· {__COMMIT__}</span>
      </Card>
    ),
  };
  const content = (
    <div className="settings-shell flex min-h-0 flex-1 text-[13px] leading-5">
      <nav
        aria-label="Settings sections"
        className={cn(
          "settings-navigation flex w-48 shrink-0 flex-col gap-1 overflow-y-auto p-3 text-[13px]",
        )}
      >
        {settingsSections.map((name) => (
          <ListRow
            key={name}
            data-sidebar-row="true"
            data-sidebar-current={section === name}
            aria-current={section === name ? "page" : undefined}
            aria-controls={`settings-${name.replaceAll(" ", "-")}`}
            onClick={() => setSection(name)}
            className={cn(section !== name && muted)}
          >
            {name}
          </ListRow>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {settingsSections.map((name) => (
          <section
            key={name}
            id={`settings-${name.replaceAll(" ", "-")}`}
            aria-label={name}
            className="w-full max-w-[80ch]"
            hidden={section !== name}
          >
            <h2 className="mb-6 text-lg leading-6 font-semibold">{name}</h2>
            {panels[name]}
          </section>
        ))}
      </div>
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Screen title="Settings" onClose={onClose} edgeToEdge>
      {content}
    </Screen>
  );
}

function Appearance() {
  const query = useQuery(core("getAppearance"));
  const softDark = useQuery(core("getSoftDark"));
  const [error, setError] = useState<string | null>(null);
  const save = async (value: AppearanceMode) => {
    setError(null);
    try {
      await window.coxswain.setAppearance(value);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="flex flex-col items-start gap-3">
      {query.data ? (
        <SegmentedControl<AppearanceMode>
          value={query.data}
          onChange={save}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      ) : (
        <span className={muted}>Loading…</span>
      )}
      <p className={helpText}>System follows your operating system’s appearance.</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={softDark.data ?? false}
          disabled={!softDark.isSuccess}
          onChange={async (event) => {
            setError(null);
            try {
              await window.coxswain.setSoftDark(event.target.checked);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        />
        Soft Dark
      </label>
      <p className={helpText}>
        Use a softer palette whenever dark mode is active, including System mode.
      </p>
      {softDark.isError && <ErrorText>Couldn’t load Soft Dark preference.</ErrorText>}
      {query.isError && <ErrorText>Couldn't load appearance.</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

// The installed agent supplies available models for the workspace.
function GuideModels({ workspaceId }: { workspaceId?: number }) {
  const settings = useQuery(core("getGuideSettings")).data;
  const [error, setError] = useState<string | null>(null);
  if (!settings) return <Card className={muted}>Loading…</Card>;
  const save = async (s: Partial<GuideSettings>) => {
    setError(null);
    try {
      await window.coxswain.setGuideSettings(s);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="flex flex-col gap-3">
      <p className={helpText}>
        The agent creates each workspace’s Guide chat session. Updates continue in that session;
        model and effort defaults apply to its future turns.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 shrink-0 font-medium">Agent</span>
        <AgentSelect
          value={settings.agent}
          // Each agent keeps its own model; the core reads it back.
          onChange={(agent) => save({ agent })}
        />
      </div>
      <GuideRunOptions
        workspaceId={workspaceId}
        settings={settings}
        value={settings}
        onChange={save}
      />
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

const themeSample = {
  name: "review.py",
  contents: `from dataclasses import dataclass
from enum import StrEnum

class ReviewStatus(StrEnum):
    READY = "ready"
    REVIEWED = "reviewed"

@dataclass(frozen=True)
class Change:
    path: str
    additions: int = 42

# Keep the review focused on what changed.
def summarize(change: Change) -> str:
    return f"{change.path}: +{change.additions} lines"
`,
};

function CodeThemes() {
  const themeType = useCodeThemeType();
  const theme = useQuery(core("getCodeTheme"));
  const [preview, setPreview] = useState<CodeTheme | null>(null);
  const previewTheme = preview ?? theme.data ?? "default";
  const previewOptions = useMemo(
    () => ({
      theme: codeThemes(previewTheme),
      themeType,
      disableFileHeader: true,
      overflow: "wrap" as const,
      unsafeCSS:
        ":host { --diffs-bg: var(--review-file-bg); --diffs-font-size: 12px; --diffs-line-height: 20px; }",
    }),
    [previewTheme, themeType],
  );
  const [error, setError] = useState<string | null>(null);
  const save = async (value: CodeTheme) => {
    setError(null);
    try {
      await window.coxswain.setCodeTheme(value);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <Card className="code-theme-card flex flex-wrap items-start gap-3">
      {theme.data && (
        <div className="code-theme-picker w-44 shrink-0">
          <PreviewSelect
            label="Code theme"
            value={theme.data}
            options={codeThemeOptions}
            onChange={save}
            onPreview={setPreview}
          />
        </div>
      )}
      <div
        className="code-theme-preview min-w-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
        aria-label="Code theme preview"
      >
        {/* A tiny sample uses its own highlighter, separate from workspace workers. */}
        <File file={themeSample} options={previewOptions} disableWorkerPool />
      </div>
      <p className={cn(helpText, "w-full")}>
        Each theme includes light and dark variants that follow the app’s appearance automatically.
        Hover to preview; select to save.
      </p>
      {(error || theme.isError) && <ErrorText>{error ?? "Couldn't load code theme."}</ErrorText>}
    </Card>
  );
}

function DefaultPromptSettings() {
  const query = useQuery(core("getDefaultPrompts"));
  if (query.isError) return <ErrorText>Couldn’t load default prompts.</ErrorText>;
  if (!query.data) return <Card className={muted}>Loading…</Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className={helpText}>
        Apply to future updates across all workspaces. Workspace Guide instructions take precedence.
      </p>
      {(["guide", "review"] as const).map((name) => (
        <DefaultPromptEditor
          key={`${name}:${query.data[name].value}`}
          name={name}
          value={query.data[name].value}
          defaultValue={query.data[name].defaultValue}
        />
      ))}
    </div>
  );
}

function DefaultPromptEditor({
  name,
  value,
  defaultValue,
}: {
  name: DefaultPromptName;
  value: string;
  defaultValue: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const title = name === "guide" ? "Guide" : "Review Comment";
  const save = async (next: string | null) => {
    if (saving || (next !== null && !next.trim())) return;
    setSaving(true);
    setError(undefined);
    try {
      await window.coxswain.setDefaultPrompt(name, next);
      setDraft(next ?? defaultValue);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="flex flex-col gap-3">
      <label htmlFor={`default-prompt-${name}`} className="text-[13px] leading-5 font-medium">
        {title}
      </label>
      <p className={helpText}>
        {name === "guide"
          ? "Writing instructions for generated Guides."
          : "Used when turning an agent discussion into a draft PR comment."}
      </p>
      <TextArea
        className="text-[13px] leading-5"
        id={`default-prompt-${name}`}
        aria-label={`${title} default prompt`}
        long
        rows={8}
        value={draft}
        disabled={saving}
        onSubmit={() => void save(draft)}
        onChange={(e) => setDraft(e.target.value)}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex justify-between gap-3">
        <Button
          disabled={saving || (value === defaultValue && draft === defaultValue)}
          onClick={() => void save(null)}
        >
          Restore Default
        </Button>
        <Button
          variant="primary"
          disabled={saving || !draft.trim() || draft.trim() === value}
          onClick={() => void save(draft)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

function ReviewWorkspaces() {
  const query = useQuery(core("getAutoReviewWorkspaces"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Card className="mb-3 flex flex-col gap-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={query.data ?? false}
          disabled={!query.isSuccess || saving}
          onChange={async (event) => {
            setSaving(true);
            setError(null);
            try {
              await window.coxswain.setAutoReviewWorkspaces(event.target.checked);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        />
        Auto-create Workspaces for Review Requests
      </label>
      <p className={helpText}>
        Check added GitHub projects every minute for review requests made directly to your account.
        Team requests are excluded. Existing workspaces remain when disabled.
      </p>
      {query.isError && <ErrorText>Couldn’t load review request preference.</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
