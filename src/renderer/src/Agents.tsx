import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { AgentSession, ChatEntry, Permission } from '../../core/agents'
import type { ReviewEntry, ReviewRound } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { core } from './queries'
import { button, muted, primaryButton, Prose } from './ui'

const pane = 'border-neutral-200 dark:border-neutral-800'

// L4: a chat with the workspace's current agent session. The session starts with its first message.
// ponytail: shows only the latest agent session; the others stay in the database until L4 gets tabs (UX open question 4).
// attached: notes sent here from the Viewer; they go in front of the next message, making it an ask.
// handedOff: a wrapped-up round sent here from its bar; its action items and stream go in front of the message too.
type Props = {
  workspace: Workspace
  attached: ReviewEntry[]
  handedOff: ReviewRound | null
  onDetach: (id: number) => void
  onDetachRound: () => void
  onSent: () => void
}

// Done action items stay out of a hand-off (ADR 0019).
const open = (r: ReviewRound) => r.actionItems.filter((i) => !i.doneAt).length

export function Agents({ workspace, attached, handedOff, onDetach, onDetachRound, onSent }: Props) {
  const last = useQuery(core('listAgentSessions', workspace.id)).data?.at(-1)
  const transcript = useQuery({ ...core('readTranscript', last?.agentSessionId ?? ''), enabled: !!last }).data
  const [session, setSession] = useState<AgentSession | null>(last ?? null)
  const [entries, setEntries] = useState<ChatEntry[]>(transcript ?? [])
  const [running, setRunning] = useState(false)
  const [permission, setPermission] = useState<Permission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const sessionRef = useRef(session)
  sessionRef.current = session

  // The latest agent session's transcript, once loaded and again when a turn ends (the core says it changed), in
  // place of the entries streamed during the turn. Not while the turn runs: nothing refetches it then.
  useEffect(() => {
    if (!last || !transcript) return
    setSession(last)
    setEntries(transcript)
  }, [transcript])

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
    if ((!message && !attached.length && !handedOff) || running) return
    const current = session ?? (await window.coxswain.startAgentSession(workspace.id))
    sessionRef.current = current
    setSession(current)
    setDraft('')
    setError(null)
    setRunning(true)
    // The core marks the notes sent as the turn starts, and says so.
    const turn = window.coxswain.runTurn(current.agentSessionId, message, attached.map((c) => c.id), handedOff?.id)
    onSent()
    const result = await turn
    setRunning(false)
    setPermission(null)
    if (result.status === 'error') setError(result.message)
  }

  const newSession = () => {
    setSession(null)
    setEntries([])
    setError(null)
  }

  return (
    <>
      <div className={`flex h-10 shrink-0 items-center justify-between border-b px-2 [-webkit-app-region:drag] ${pane}`}>
        <span className="text-xs font-medium">Claude Code</span>
        <div className="flex items-center gap-1">
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
          <Entry key={i} entry={e} />
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
        {handedOff && (
          <div className="flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
            <span className="min-w-0 flex-1 truncate">
              Round {handedOff.number} · {open(handedOff)} action item{open(handedOff) === 1 ? '' : 's'}
            </span>
            <button title="Remove from the message" className={muted} onClick={onDetachRound}>
              ✕
            </button>
          </div>
        )}
        {attached.map((c) => (
          <div key={c.id} className="flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
            <span className="min-w-0 flex-1 truncate" title={c.body}>
              {c.path && `${c.path.split('/').at(-1)}:${c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`} `}
              {c.body}
            </span>
            <button title="Remove from the message" className={muted} onClick={() => onDetach(c.id)}>
              ✕
            </button>
          </div>
        ))}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
          placeholder={
            handedOff
              ? 'Anything to add? (Enter to send)'
              : attached.length
              ? 'What should the agent do with these notes? (Enter to send)'
              : 'Message Claude Code (Enter to send, Shift+Enter for a new line)'
          }
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
export function Entry({ entry }: { entry: ChatEntry }) {
  if (entry.kind === 'tool')
    // shrink-0: truncate's overflow lets a flex item shrink to nothing once the chat overflows, leaving only the gaps.
    return <div className={`shrink-0 truncate font-mono text-xs ${muted}`}>⏺ {entry.text}</div>
  if (entry.kind === 'user')
    return (
      <div className="self-end rounded-md bg-neutral-100 px-2 py-1 whitespace-pre-wrap select-text [overflow-wrap:anywhere] dark:bg-neutral-800">
        {entry.text}
      </div>
    )
  return (
    <div className="markdown select-text [overflow-wrap:anywhere]">
      <Prose>{entry.text}</Prose>
    </div>
  )
}
