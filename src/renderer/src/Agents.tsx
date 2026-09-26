import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { AgentSession, ChatEntry, Permission, SentComment } from '../../core/agents'
import type { Workspace } from '../../core/workspaces'
import { core } from './queries'
import { button, muted, primaryButton, Prose } from './ui'

const pane = 'border-neutral-200 dark:border-neutral-800'

// L4: a chat with one of the workspace's agent sessions, the latest unless another is picked in the header. A new
// session starts with its first message.
// ponytail: comments still go to the latest session, not the one shown; pass the shown one to ask and sendReview if that
// confuses.
type Props = {
  workspace: Workspace
  onViewThread: (threadId: number) => void
  // Replaces the composer's draft when it changes (the Guide menu's prompts), for the user to edit and send.
  composerText?: { text: string }
}

export function Agents({ workspace, onViewThread, composerText }: Props) {
  const sessions = useQuery(core('listAgentSessions', workspace.id)).data ?? []
  // The agent session picked in the header; null is the latest, 'new' one not started yet.
  const [picked, setPicked] = useState<string | null>(null)
  const last = picked ? sessions.find((s) => s.agentSessionId === picked) : sessions.at(-1)
  const transcript = useQuery({ ...core('readTranscript', last?.agentSessionId ?? ''), enabled: !!last }).data
  const [session, setSession] = useState<AgentSession | null>(last ?? null)
  const [entries, setEntries] = useState<ChatEntry[]>(transcript ?? [])
  const [running, setRunning] = useState(false)
  const [permission, setPermission] = useState<Permission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const sessionRef = useRef(session)
  sessionRef.current = session
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!composerText) return
    setDraft(composerText.text)
    composer.current?.focus()
  }, [composerText])

  // The shown agent session's transcript, once loaded or picked and again when a turn ends (the core says it changed), in
  // place of the entries streamed during the turn. Not while the turn runs: nothing refetches it then.
  useEffect(() => {
    if (!last || !transcript) return
    setSession(last)
    setEntries(transcript)
  }, [transcript, picked])

  useEffect(() => {
    const offEntry = window.coxswain.onChatEntry((id, entry) => {
      if (id === sessionRef.current?.agentSessionId) setEntries((e) => [...e, entry])
    })
    const offPermission = window.coxswain.onPermission((id, p) => {
      if (id === sessionRef.current?.agentSessionId) setPermission(p)
    })
    return () => {
      offEntry()
      offPermission()
    }
  }, [])

  const bottom = useRef<HTMLDivElement>(null)
  // Braces matter: Chromium's scrollIntoView returns a promise, which React would take for a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [entries, running, permission])

  const send = async () => {
    const message = draft.trim()
    if (!message || running) return
    const current = session ?? (await window.coxswain.startAgentSession(workspace.id))
    sessionRef.current = current
    setPicked(current.agentSessionId)
    setSession(current)
    setDraft('')
    setError(null)
    setRunning(true)
    const result = await window.coxswain.runTurn(current.agentSessionId, message)
    setRunning(false)
    setPermission(null)
    if (result.status === 'error') setError(result.message)
  }

  const newSession = () => {
    setPicked('new')
    setSession(null)
    setEntries([])
    setError(null)
  }

  return (
    <>
      <div className={`flex h-10 shrink-0 items-center justify-end border-b pr-2 pl-8 [-webkit-app-region:drag] ${pane}`}>
        <div className="flex items-center gap-1">
          {sessions.length > 0 && (
            <select
              className="text-xs [-webkit-app-region:no-drag]"
              disabled={running}
              value={session?.agentSessionId ?? ''}
              onChange={(e) => setPicked(e.target.value)}
            >
              {!sessions.some((s) => s.agentSessionId === session?.agentSessionId) && (
                <option value={session?.agentSessionId ?? ''}>New session</option>
              )}
              {sessions.map((s, i) => (
                <option key={s.agentSessionId} value={s.agentSessionId}>
                  Session {i + 1} · {new Date(s.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </option>
              ))}
            </select>
          )}
          <button className={`${button} text-xs [-webkit-app-region:no-drag]`} disabled={running} onClick={newSession}>
            New session
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {entries.length === 0 && !running && (
          <div className={`m-auto text-xs ${muted}`}>Ask Claude Code something to start an agent session</div>
        )}
        {entries.map((e, i) => (
          <Entry key={i} entry={e} onViewThread={onViewThread} />
        ))}
        {permission ? (
          <PermissionPrompt
            permission={permission}
            onAnswer={(optionId) => {
              window.coxswain.answerPermission(permission.id, optionId)
              setPermission(null)
            }}
          />
        ) : (
          running && <div className={`text-xs ${muted}`}>Working…</div>
        )}
        {error && <div className="text-xs text-red-600 select-text dark:text-red-400">{error}</div>}
        <div ref={bottom} />
      </div>
      <div className={`flex flex-col gap-1 border-t p-2 ${pane}`}>
        <textarea
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
          placeholder="Message Claude Code (Enter to send, Shift+Enter for a new line)"
          className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        {running && session && (
          <button className={`${button} self-end text-xs`} onClick={() => window.coxswain.stopTurn(session.agentSessionId)}>
            Stop
          </button>
        )}
      </div>
    </>
  )
}

// A tool use the agent asks to make, which auto mode (or a question's default mode) wouldn't allow by itself, with the
// agent's options (ADR 0018, 8). The turn waits until one is picked, or it's stopped.
export function PermissionPrompt({ permission, onAnswer }: { permission: Permission; onAnswer: (optionId: string) => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-neutral-300 p-1.5 text-xs dark:border-neutral-700">
      <span>Claude Code wants to:</span>
      <div className="max-h-24 overflow-y-auto font-mono whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{permission.title}</div>
      <div className="flex flex-wrap justify-end gap-1">
        {permission.options.map((o) => (
          <button key={o.id} className={`${o.kind === 'allow_once' ? primaryButton : button} text-xs`} onClick={() => onAnswer(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// Agent replies are Markdown.
// ponytail: code blocks aren't highlighted; use @pierre/diffs' Shiki if they need it.
// onViewThread: shows a comment's thread on the canvas.
export function Entry({ entry, onViewThread }: { entry: ChatEntry; onViewThread?: (threadId: number) => void }) {
  if (entry.comment) return <CommentCard comment={entry.comment} onViewThread={onViewThread} />
  if (entry.review)
    return (
      <div className={`my-3 max-w-[85%] shrink-0 self-end rounded-lg border px-2.5 py-2 text-xs ${muted} ${pane}`}>
        Review sent to Claude · {entry.review.threads} thread{entry.review.threads === 1 ? '' : 's'}
      </div>
    )
  if (entry.kind === 'tool')
    // shrink-0: truncate's overflow lets a flex item shrink to nothing once the chat overflows, leaving only the gaps.
    return <div className={`shrink-0 truncate font-mono text-xs ${muted}`}>⏺ {entry.text}</div>
  // my-3: room above and below the user's messages, between the agent's turns.
  if (entry.kind === 'user')
    return (
      <div className="my-3 self-end rounded-md bg-neutral-100 px-2 py-1 whitespace-pre-wrap select-text [overflow-wrap:anywhere] dark:bg-neutral-800">
        {entry.text}
      </div>
    )
  return (
    <div className="markdown select-text [overflow-wrap:anywhere]">
      <Prose>{entry.text}</Prose>
    </div>
  )
}

// A comment sent from a thread: where it's from, the comment, and a way back to its thread.
function CommentCard({ comment: c, onViewThread }: { comment: SentComment; onViewThread?: (threadId: number) => void }) {
  const view = () => onViewThread?.(c.threadId)
  return (
    <div className="my-3 flex max-w-[85%] shrink-0 flex-col self-end rounded-lg border border-neutral-300 dark:border-neutral-700">
      <button onClick={view} className={`flex items-start gap-2 px-2.5 pt-2 text-left text-xs ${muted}`}>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Comment on <span className="font-mono">{c.where}</span> sent to Claude
        </span>
        <span>›</span>
      </button>
      <div className="line-clamp-6 px-2.5 py-1.5 whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{c.body}</div>
      <button
        onClick={view}
        className={`border-t px-2.5 py-1.5 text-right text-xs ${muted} hover:text-neutral-900 dark:hover:text-neutral-100 ${pane}`}
      >
        View thread ›
      </button>
    </div>
  )
}
