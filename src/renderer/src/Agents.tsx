import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentSession, ChatEntry } from '../../core/agents'
import type { Comment } from '../../core/comments'
import type { Workspace } from '../../core/workspaces'
import { button, muted } from './ui'

const pane = 'border-neutral-200 dark:border-neutral-800'

// L4: a chat with the workspace's current agent session. The session starts with its first message.
// ponytail: shows only the latest agent session; the others stay in the database until L4 gets tabs (UX open question 4).
// attached: comments sent here from the Viewer; they go in front of the next message, making it an ask.
type Props = {
  workspace: Workspace
  attached: Comment[]
  onDetach: (id: number) => void
  onSent: () => void
  onTurnEnd: () => void
}

export function Agents({ workspace, attached, onDetach, onSent, onTurnEnd }: Props) {
  const [session, setSession] = useState<AgentSession | null>(null)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    window.coxswain.listAgentSessions(workspace.id).then(async (sessions) => {
      const last = sessions.at(-1) ?? null
      setSession(last)
      if (last) setEntries(await window.coxswain.readTranscript(last.agentSessionId))
    })
  }, [workspace.id])

  useEffect(
    () =>
      window.coxswain.onChatEntry((id, entry) => {
        if (id === sessionRef.current?.agentSessionId) setEntries((e) => [...e, entry])
      }),
    [],
  )

  const bottom = useRef<HTMLDivElement>(null)
  // Braces matter: Chromium's scrollIntoView returns a promise, which React would take for a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [entries, running])

  const send = async () => {
    const message = draft.trim()
    if ((!message && !attached.length) || running) return
    const current = session ?? (await window.coxswain.startAgentSession(workspace.id))
    sessionRef.current = current
    setSession(current)
    setDraft('')
    setError(null)
    setRunning(true)
    // The core marks the comments sent as soon as the turn starts, so onSent can reload them right away.
    const turn = window.coxswain.runTurn(current.agentSessionId, message, attached.map((c) => c.id))
    onSent()
    const result = await turn
    setRunning(false)
    onTurnEnd()
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
        {running && <div className={`text-xs ${muted}`}>Working…</div>}
        {error && <div className="text-xs text-red-600 select-text dark:text-red-400">{error}</div>}
        <div ref={bottom} />
      </div>
      <div className={`flex flex-col gap-1 border-t p-2 ${pane}`}>
        {attached.map((c) => (
          <div key={c.id} className="flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
            <span className="min-w-0 flex-1 truncate" title={c.body}>
              {c.path.split('/').at(-1)}:{c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`} {c.body}
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
            attached.length
              ? 'What should the agent do with these comments? (Enter to send)'
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

// Agent replies are Markdown; links get target=_blank so the main process opens them in the browser.
// ponytail: code blocks aren't highlighted; use @pierre/diffs' Shiki if they need it.
export function Entry({ entry }: { entry: ChatEntry }) {
  if (entry.kind === 'tool')
    return <div className={`truncate font-mono text-xs ${muted}`}>⏺ {entry.text}</div>
  if (entry.kind === 'user')
    return (
      <div className="self-end rounded-md bg-neutral-100 px-2 py-1 whitespace-pre-wrap select-text [overflow-wrap:anywhere] dark:bg-neutral-800">
        {entry.text}
      </div>
    )
  return (
    <div className="markdown select-text [overflow-wrap:anywhere]">
      <Markdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" /> }}>
        {entry.text}
      </Markdown>
    </div>
  )
}
