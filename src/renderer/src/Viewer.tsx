import type { DiffLineAnnotation, LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { File, MultiFileDiff } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntry, Permission } from '../../core/agents'
import type { ChangedFile, FileText } from '../../core/git'
import type { NewEntry, ReviewEntry } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { Entry, PermissionPrompt } from './Agents'
import { changed, core, queryClient } from './queries'
import { button, muted, primaryButton, ProblemMessage, Prose, SendIcon } from './ui'

// What the Viewer shows: the file diff of a changed file, or a whole file as it is in the worktree.
export type Opened = { kind: 'diff'; file: ChangedFile } | { kind: 'file'; path: string }
// A question's turn in a thread: the reply streamed so far (live) until it's saved as an answer entry, and a tool use
// waiting for the user's approval.
export type Turn = { running: boolean; error: string | null; live: ChatEntry[]; permission: Permission | null }
type Ask = (question: NewEntry | { workspaceId: number; threadId: number }) => void

type Draft = { side: 'old' | 'new'; startLine: number; endLine: number }
// What an inline box between the lines shows: an entry with its thread, or the form for a new one.
// One object type, not a union: the library's annotation types distribute over unions.
type Box = { entry?: ReviewEntry; draft?: Draft }

type Props = {
  workspace: Workspace
  mergeBase: string
  // A commit diff (picked under Commits): the new side is this commit, and mergeBase its parent.
  // ponytail: notes on it keep the commit's line numbers and say "as in the worktree", and Reviewed marks the file
  // reviewed for all changes; anchor entries and reviewed state to the commit if that misleads.
  head?: string
  opened: Opened
  entries: ReviewEntry[] // the workspace's
  reviewed: string[]
  onReviewedChange: (path: string, reviewed: boolean) => void
  turns: Record<number, Turn> // by thread
  onAsk: Ask
  onAnswerPermission: (threadId: number, id: string, optionId: string) => void
  diffStyle: 'unified' | 'split'
  // One of several file diffs one after another: the parent scrolls, not the Viewer.
  stacked?: boolean
}

// The side of a file diff that isn't read: an added file's old side, a deleted one's new side, a whole file's old side.
// Module-level, so the memoised files below keep their identity.
const emptyText: FileText = { status: 'ok', text: '', binary: false }
const noText: FileText = { status: 'ok', text: null, binary: false }

const baseOptions = { preferredHighlighter: 'shiki-js', overflow: 'wrap', stickyHeader: true } as const

// L3: shows the diff or file opened from the Navigator.
// The old side is the merge base (git show), the new side the worktree now.
// The + in the gutter (click, or drag for a range) starts a note or question on those lines.
// Memoised, and so are the files and annotations it hands the library: @pierre/diffs re-diffs on a new file
// object and redraws on every render, so the canvas's many Viewers must only render when their props change.
export const Viewer = memo(function Viewer(props: Props) {
  const { workspace, mergeBase, head, opened, entries } = props
  const [draft, setDraft] = useState<Draft | null>(null)
  const [showOutdated, setShowOutdated] = useState(false)
  // The highlighted lines. Controlled, so they can be cleared when a draft is cancelled or saved: left to
  // itself the library keeps the old selection and extends it on the next drag.
  const [selection, setSelection] = useState<SelectedLineRange | null>(null)
  const closeDraft = () => {
    setDraft(null)
    setSelection(null)
  }
  const path = opened.kind === 'diff' ? opened.file.path : opened.path
  // A stacked file diff reads its file only once it scrolls near the screen: a big PR has thousands, and reading
  // them all at once queues every other call behind thousands of git processes.
  const [near, setNear] = useState(!props.stacked)
  const placeholder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = placeholder.current
    if (near || !el) return
    const o = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), {
      root: el.closest('.overflow-auto'),
      rootMargin: '1500px 0px',
    })
    o.observe(el)
    return () => o.disconnect()
  }, [near])

  // Rereading after an agent turn keeps the old text in place until the new text is in.
  const readOld = opened.kind === 'diff' && opened.file.status !== 'added'
  const readNew = !(opened.kind === 'diff' && opened.file.status === 'deleted')
  const oldPath = opened.kind === 'diff' ? (opened.file.previousPath ?? path) : path
  const oldSide = useQuery({ ...core('readFileAt', workspace.id, mergeBase, oldPath), enabled: near && readOld }).data
  const newSide = useQuery({
    ...(head ? core('readFileAt', workspace.id, head, path) : core('readWorktreeFile', workspace.id, path)),
    enabled: near && readNew,
  }).data
  const o = readOld ? oldSide : opened.kind === 'file' ? noText : emptyText
  const n = readNew ? newSide : emptyText
  useEffect(closeDraft, [opened])

  const options = useMemo(
    () => ({
      ...baseOptions,
      diffStyle: props.diffStyle,
      enableGutterUtility: true,
      // In a diff the range has a side; a whole file is always the worktree. ponytail: a range spanning
      // both sides of a diff is taken as the side it ends on.
      onGutterUtilityClick: (r: SelectedLineRange) =>
        setDraft({ side: (r.endSide ?? r.side) === 'deletions' ? 'old' : 'new', startLine: r.start, endLine: r.end }),
      onLineSelectionChange: setSelection,
    }),
    [props.diffStyle],
  )

  const files = useMemo(() => {
    const text = (f: FileText) => (f.status === 'ok' ? (f.text ?? '') : '')
    return o && n && { old: { name: oldPath, contents: text(o) }, new: { name: path, contents: text(n) } }
  }, [o, n])
  const annotations = useMemo(() => {
    // Threads show under their first question, so only anchored entries without a parent get a box.
    // A whole file only shows the worktree, so only entries on the new side belong in it.
    // Only current entries go between the lines (ADR 0015); outdated ones open from the header.
    const boxes: { side: 'old' | 'new'; line: number; box: Box }[] = [
      ...entries
        .filter((e) => e.path === path && !e.parentId && e.state === 'current' && (opened.kind === 'diff' || e.side === 'new'))
        .map((e) => ({ side: e.side!, line: e.endLine!, box: { entry: e } })),
      ...(draft ? [{ side: draft.side, line: Math.max(draft.startLine, draft.endLine), box: { draft } }] : []),
    ]
    return {
      file: boxes.map((a): LineAnnotation<Box> => ({ lineNumber: a.line, metadata: a.box })),
      diff: boxes.map(
        (a): DiffLineAnnotation<Box> => ({ side: a.side === 'old' ? 'deletions' : 'additions', lineNumber: a.line, metadata: a.box }),
      ),
    }
  }, [entries, draft, opened])

  if (!near && opened.kind === 'diff') {
    // Roughly the file diff's height, so scrolling to a file further down lands near it.
    const height = 44 + 20 * Math.min(opened.file.additions + opened.file.deletions + 6, 200)
    return (
      <div ref={placeholder} style={{ height }} className={`border-b border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800 ${muted}`}>
        {path}
      </div>
    )
  }
  if (!o || !n || !files) return <Centered>Loading…</Centered>
  if (o.status !== 'ok' || n.status !== 'ok')
    return (
      <Centered>
        <ProblemMessage problem={o.status !== 'ok' ? o : (n as Exclude<FileText, { status: 'ok' }>)} />
      </Centered>
    )
  if (o.binary || n.binary) return <Centered>Binary file, not shown</Centered>

  const anchored = (d: Draft, body: string): NewEntry => {
    const [start, end] = [d.startLine, d.endLine].sort((a, b) => a - b)
    const text = (d.side === 'old' ? o.text : n.text) ?? ''
    const code = text.split('\n').slice(start - 1, end).join('\n')
    const anchor = { path, side: d.side, startLine: start, endLine: end, code, base: mergeBase, head: head ?? null }
    return { workspaceId: workspace.id, body, anchor }
  }
  // A note, or with toAgent a question for the agent pane's session; its answer goes in the thread.
  const post = async (e: NewEntry, toAgent: boolean) => {
    if (toAgent) return props.onAsk(e)
    await window.coxswain.addNote(e)
    changed({ workspaceId: workspace.id, what: 'entries' })
  }
  const edit = async (e: ReviewEntry, body: string) => {
    await window.coxswain.editEntry(e.id, body)
    changed({ workspaceId: workspace.id, what: 'entries' })
  }
  const resolve = async (e: ReviewEntry, resolved: boolean) => {
    await window.coxswain.resolveThread(e.id, resolved)
    changed({ workspaceId: workspace.id, what: 'entries' })
  }
  const remove = async (e: ReviewEntry) => {
    await window.coxswain.deleteEntry(e.id)
    changed({ workspaceId: workspace.id, what: 'entries' })
  }
  const render = ({ draft, entry }: Box) =>
    draft ? (
      <DraftBox
        draft={draft}
        onSend={(body, toAgent) => {
          post(anchored(draft, body), toAgent)
          closeDraft()
        }}
        onCancel={closeDraft}
      />
    ) : entry ? (
      <ThreadBox
        root={entry}
        replies={entries.filter((e) => e.parentId === entry.id)}
        turn={props.turns[entry.id]}
        onReply={(body, toAgent) => post({ workspaceId: workspace.id, body, parentId: entry.id }, toAgent)}
        onStop={() => window.coxswain.stopQuestion(workspace.id)}
        onAnswerPermission={(id, optionId) => props.onAnswerPermission(entry.id, id, optionId)}
        onEdit={(body) => edit(entry, body)}
        onResolve={(resolved) => resolve(entry, resolved)}
        onRemove={() => remove(entry)}
        onSend={() => props.onAsk({ workspaceId: workspace.id, threadId: entry.id })}
      />
    ) : null

  const outdated = entries.filter((e) => e.path === path && !e.parentId && e.state === 'outdated')

  return (
    <div className={props.stacked ? 'select-text' : 'min-h-0 flex-1 overflow-auto select-text'}>
      {showOutdated && opened.kind === 'diff' && (
        <div className="border-b border-neutral-200 bg-neutral-50 py-1 dark:border-neutral-800 dark:bg-neutral-950">
          {outdated.map((e) => (
            <div key={e.id} className="mx-2 mt-1">
              <div className={`px-2 text-xs ${muted}`}>
                Outdated · {lines(e.startLine!, e.endLine!)}
                {e.side === 'old' && ', removed'}: the code it was about has changed.
              </div>
              <pre className="mx-2 mt-1 overflow-x-auto rounded bg-neutral-100 p-1.5 font-mono text-xs dark:bg-neutral-800">{e.code}</pre>
              {render({ entry: e })}
            </div>
          ))}
        </div>
      )}
      {opened.kind === 'file' ? (
        <File<Box>
          file={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.file}
          renderAnnotation={(a) => render(a.metadata)}
        />
      ) : (
        <MultiFileDiff<Box>
          oldFile={files.old}
          newFile={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.diff}
          renderAnnotation={(a) => render(a.metadata)}
          renderHeaderMetadata={() => (
            <div className="flex items-center gap-2">
              {outdated.length > 0 && (
                <button
                  title="Notes and questions about code that has changed since"
                  className={`font-sans text-xs ${muted} hover:text-neutral-900 dark:hover:text-neutral-100`}
                  onClick={() => setShowOutdated((s) => !s)}
                >
                  {outdated.length} outdated
                </button>
              )}
              <label className="flex items-center gap-1 font-sans text-xs select-none">
                <input
                  type="checkbox"
                  checked={props.reviewed.includes(path)}
                  onChange={(e) => props.onReviewedChange(path, e.target.checked)}
                />
                Reviewed
              </label>
            </div>
          )}
        />
      )}
    </div>
  )
})

const lines = (start: number, end: number) => (start === end ? `Line ${start}` : `Lines ${start}–${end}`)
const box = 'm-2 flex flex-col gap-1.5 rounded-md border border-neutral-300 bg-white p-2 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900'

type DraftBoxProps = { draft: Draft; onSend: (body: string, toAgent: boolean) => void; onCancel: () => void }

// A new thread on the lines picked.
function DraftBox({ draft, onSend, onCancel }: DraftBoxProps) {
  const [start, end] = [draft.startLine, draft.endLine].sort((a, b) => a - b)
  return (
    <div className={box}>
      <div className={`flex items-center justify-between text-xs ${muted}`}>
        <span>{lines(start, end)}</span>
        <button title="Cancel (Esc)" className="hover:text-neutral-900 dark:hover:text-neutral-100" onClick={onCancel}>
          ✕
        </button>
      </div>
      <Composer autoFocus rows={3} placeholder="Comment" onSend={onSend} onCancel={onCancel} />
    </div>
  )
}

type ComposerProps = {
  autoFocus?: boolean
  rows: number
  placeholder: string
  reply?: boolean // a reply is always a note: no Comment/Agent toggle
  onSend: (body: string, toAgent: boolean) => void
  onCancel?: () => void
}

// A comment's text, then the Comment/Agent toggle and the send button on the right. Enter sends, Shift+Enter adds a line.
function Composer(props: ComposerProps) {
  const [body, setBody] = useState('')
  // A global preference (every composer shares it), so the query is updated at once, then stored.
  const saved = useQuery(core('getCommentToAgent')).data ?? false
  const toAgent = !props.reply && saved
  const setToAgent = (on: boolean) => {
    queryClient.setQueryData(core('getCommentToAgent').queryKey, on)
    void window.coxswain.setCommentToAgent(on)
  }
  // autoFocus loses to the gutter button, which takes focus when the drag that opened the box ends.
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!props.autoFocus) return
    const t = setTimeout(() => input.current?.focus())
    return () => clearTimeout(t)
  }, [])
  const send = () => {
    if (!body.trim()) return
    props.onSend(body.trim(), toAgent)
    setBody('')
  }
  return (
    <>
      <textarea
        ref={input}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel?.()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
        rows={props.rows}
        placeholder={`${props.placeholder} (Enter to send)`}
        className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <div className="flex items-center justify-end gap-2">
        {!props.reply && (
          <div className="flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
            {([false, true] as const).map((on) => (
              <button
                key={String(on)}
                title={on ? 'Send to the agent, who answers in the thread' : 'Leave a comment for yourself'}
                className={`rounded px-2 py-0.5 ${toAgent === on ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={() => setToAgent(on)}
              >
                {on ? 'Agent' : 'Comment'}
              </button>
            ))}
          </div>
        )}
        <button title="Send (Enter)" className={`${primaryButton} disabled:opacity-50`} disabled={!body.trim()} onClick={send}>
          <SendIcon />
        </button>
      </div>
    </>
  )
}

type ThreadBoxProps = {
  root: ReviewEntry // the thread's first note or question
  replies: ReviewEntry[] // notes, follow-up questions and answers, in order
  turn: Turn | undefined
  onReply: (body: string, toAgent: boolean) => void
  onStop: () => void
  onAnswerPermission: (id: string, optionId: string) => void
  onEdit: (body: string) => void // the first comment's text
  onResolve: (resolved: boolean) => void // false: reopen
  onRemove: () => void
  onSend: () => void // the latest note, to the agent
}

// A thread: its first entry, the replies and answers, the reply streaming in while a turn runs, and a box to reply.
// Its ⋯ menu edits the first comment (the user's own only), deletes the thread, or sends its latest note to the agent.
// Resolved, it folds to its header and first comment until reopened.
function ThreadBox({ root, replies, turn, onReply, onStop, onAnswerPermission, onEdit, onResolve, onRemove, onSend }: ThreadBoxProps) {
  const running = turn?.running ?? false
  const [editing, setEditing] = useState(false)
  const lastOwn = [root, ...replies].findLast((e) => e.kind === 'note' || e.kind === 'question')
  const menu = async () => {
    const picked = await window.coxswain.showThreadMenu({
      edit: root.kind === 'note' || root.kind === 'question',
      send: !running && lastOwn?.kind === 'note',
    })
    if (picked === 'edit') setEditing(true)
    if (picked === 'delete') onRemove()
    if (picked === 'send') onSend()
  }
  return (
    <div id={`thread:${root.id}`} className={box}>
      <div className={`flex items-center gap-2 text-xs ${muted}`}>
        <span className="shrink-0">{lines(root.startLine!, root.endLine!)}</span>
        {root.resolvedAt ? (
          <span className="min-w-0 flex-1 truncate">Resolved · {root.body}</span>
        ) : (
          <div className="flex-1" />
        )}
        <button
          title={root.resolvedAt ? 'Resolved: click to reopen' : 'Resolve: mark the thread done; it folds to one line'}
          disabled={running}
          className={`rounded px-1 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800 ${root.resolvedAt ? 'text-green-600' : 'hover:text-neutral-900 dark:hover:text-neutral-100'}`}
          onClick={() => onResolve(!root.resolvedAt)}
        >
          ✓
        </button>
        <button title="Edit, delete or send to the agent" className="rounded px-1 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" onClick={menu}>
          ⋯
        </button>
      </div>
      {(!root.resolvedAt || editing) && (
        <>
          <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
            {editing ? (
              <EditBox
                body={root.body}
                onSave={(body) => {
                  onEdit(body)
                  setEditing(false)
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <Comment entry={root} />
            )}
            {replies.map((e) => <Comment key={e.id} entry={e} />)}
            {turn?.live.filter((c) => c.kind !== 'user').map((c, i) => <Entry key={`live${i}`} entry={c} />)}
            {turn?.permission ? (
              <PermissionPrompt permission={turn.permission} onAnswer={(optionId) => onAnswerPermission(turn.permission!.id, optionId)} />
            ) : (
              running && <div className={`text-xs ${muted}`}>Working…</div>
            )}
            {turn?.error && <div className="text-xs text-red-600 select-text dark:text-red-400">{turn.error}</div>}
          </div>
          {running ? (
            <button className={`${button} self-end text-xs`} onClick={onStop}>
              Stop
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-1.5 dark:border-neutral-800">
              <Composer rows={1} placeholder="Reply" reply onSend={onReply} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// A comment's text being edited in place: Enter saves, Esc cancels, Shift+Enter adds a line.
function EditBox(props: { body: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState(props.body)
  const save = () => (body.trim() ? props.onSave(body) : props.onCancel())
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
        rows={3}
        className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <div className="flex justify-end gap-1.5 text-xs">
        <button className={button} onClick={props.onCancel}>
          Cancel
        </button>
        <button className={primaryButton} onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

// Who wrote an entry the agent wrote, and why (glossary).
const agentLabels: Partial<Record<ReviewEntry['kind'], string>> = { answer: 'Agent', explanation: 'Guide', finding: 'Finding' }

// One entry of a thread: the user's (a question marked as sent to the agent), or the agent's: an answer, an
// explanation or a finding.
function Comment({ entry: e }: { entry: ReviewEntry }) {
  const label = agentLabels[e.kind]
  if (label)
    return (
      <div className="markdown select-text [overflow-wrap:anywhere]">
        <span className={`text-xs ${e.kind === 'finding' ? 'text-amber-600 dark:text-amber-400' : muted}`}>{label}</span>
        <Prose>{e.body}</Prose>
      </div>
    )
  return (
    <div className="whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
      <span className={`block text-xs ${muted}`}>{e.kind === 'question' ? 'You → agent' : 'You'}</span>
      {e.body}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={`flex flex-1 items-center justify-center text-xs ${muted}`}>{children}</div>
}
