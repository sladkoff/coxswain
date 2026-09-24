import type { DiffLineAnnotation, LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { File, MultiFileDiff } from '@pierre/diffs/react'
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntry } from '../../core/agents'
import type { Comment } from '../../core/comments'
import type { ChangedFile, FileText } from '../../core/git'
import type { Workspace } from '../../core/workspaces'
import { Entry } from './Agents'
import { button, muted, primaryButton, ProblemMessage } from './ui'

// What the Viewer shows: the file diff of a changed file, or a whole file as it is in the worktree.
export type Opened = { kind: 'diff'; file: ChangedFile } | { kind: 'file'; path: string }
// A turn of an agent session in a comment's thread.
export type Turn = { running: boolean; error: string | null }
type RunTurn = (agentSessionId: string, message: string, commentIds: number[]) => void

type Draft = { side: 'old' | 'new'; startLine: number; endLine: number }
// What an inline box between the lines shows: a saved comment, or the form for a new one.
// One object type, not a union: the library's annotation types distribute over unions.
type Note = { comment?: Comment; draft?: Draft }

// version: bump to reread, e.g. after an agent turn changed the worktree.
type Props = {
  workspace: Workspace
  mergeBase: string
  opened: Opened
  version: number
  comments: Comment[]
  onCommentsChanged: () => void
  attachedIds: number[]
  onAttach: (comment: Comment) => void
  viewed: string[]
  onViewedChange: (path: string, viewed: boolean) => void
  turns: Record<string, Turn>
  onRunTurn: RunTurn
  // One of several file diffs one after another: the parent scrolls, not the Viewer.
  stacked?: boolean
}

const baseOptions = { preferredHighlighter: 'shiki-js', overflow: 'scroll', stickyHeader: true } as const

// L3: shows the diff or file opened from the Navigator.
// The old side is the merge base (git show), the new side the worktree now.
// The + in the gutter (click, or drag for a range) starts a local comment on those lines.
// Memoised, and so are the files and annotations it hands the library: @pierre/diffs re-diffs on a new file
// object and redraws on every render, so the Diff tab's many Viewers must only render when their props change.
export const Viewer = memo(function Viewer(props: Props) {
  const { workspace, mergeBase, opened, version, comments, onCommentsChanged, attachedIds, onAttach } = props
  const [sides, setSides] = useState<{ old: FileText; new: FileText } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // The highlighted lines. Controlled, so they can be cleared when a draft is cancelled or saved: left to
  // itself the library keeps the old selection and extends it on the next drag.
  const [selection, setSelection] = useState<SelectedLineRange | null>(null)
  const closeDraft = () => {
    setDraft(null)
    setSelection(null)
  }
  const path = opened.kind === 'diff' ? opened.file.path : opened.path

  // Only a different file clears the Viewer; rereading after an agent turn keeps it in place until the new text is in.
  useEffect(() => setSides(null), [opened, mergeBase])
  useEffect(() => {
    let stale = false
    const oldSide: Promise<FileText> =
      opened.kind === 'file'
        ? Promise.resolve({ status: 'ok', text: null, binary: false })
        : opened.file.status === 'added'
          ? Promise.resolve({ status: 'ok', text: '', binary: false })
          : window.coxswain.readFileAt(workspace.id, mergeBase, opened.file.previousPath ?? opened.file.path)
    const newSide: Promise<FileText> =
      opened.kind === 'diff' && opened.file.status === 'deleted'
        ? Promise.resolve({ status: 'ok', text: '', binary: false })
        : window.coxswain.readWorktreeFile(workspace.id, path)
    Promise.all([oldSide, newSide]).then(([o, n]) => !stale && setSides({ old: o, new: n }))
    return () => void (stale = true)
  }, [opened, mergeBase, version])
  useEffect(closeDraft, [opened])

  const options = useMemo(
    () => ({
      ...baseOptions,
      enableGutterUtility: true,
      // In a diff the range has a side; a whole file is always the worktree. ponytail: a range spanning
      // both sides of a diff is taken as the side it ends on.
      onGutterUtilityClick: (r: SelectedLineRange) =>
        setDraft({ side: (r.endSide ?? r.side) === 'deletions' ? 'old' : 'new', startLine: r.start, endLine: r.end }),
      onLineSelectionChange: setSelection,
    }),
    [],
  )

  const files = useMemo(() => {
    const text = (f: FileText) => (f.status === 'ok' ? (f.text ?? '') : '')
    const oldName = opened.kind === 'diff' ? (opened.file.previousPath ?? path) : path
    return sides && { old: { name: oldName, contents: text(sides.old) }, new: { name: path, contents: text(sides.new) } }
  }, [sides])
  const annotations = useMemo(() => {
    // A whole file only shows the worktree, so only comments on the new side belong in it.
    const notes: { side: 'old' | 'new'; line: number; note: Note }[] = [
      ...comments
        .filter((c) => c.path === path && (opened.kind === 'diff' || c.side === 'new'))
        .map((c) => ({ side: c.side, line: c.endLine, note: { comment: c } })),
      ...(draft ? [{ side: draft.side, line: Math.max(draft.startLine, draft.endLine), note: { draft } }] : []),
    ]
    return {
      file: notes.map((a): LineAnnotation<Note> => ({ lineNumber: a.line, metadata: a.note })),
      diff: notes.map(
        (a): DiffLineAnnotation<Note> => ({ side: a.side === 'old' ? 'deletions' : 'additions', lineNumber: a.line, metadata: a.note }),
      ),
    }
  }, [comments, draft, opened])

  if (!sides || !files) return <Centered>Loading…</Centered>
  const { old: o, new: n } = sides
  if (o.status !== 'ok' || n.status !== 'ok')
    return (
      <Centered>
        <ProblemMessage problem={o.status !== 'ok' ? o : (n as Exclude<FileText, { status: 'ok' }>)} />
      </Centered>
    )
  if (o.binary || n.binary) return <Centered>Binary file, not shown</Centered>

  const save = async (d: Draft, body: string) => {
    const [start, end] = [d.startLine, d.endLine].sort((a, b) => a - b)
    const text = (d.side === 'old' ? o.text : n.text) ?? ''
    const code = text.split('\n').slice(start - 1, end).join('\n')
    const comment = await window.coxswain.addComment({ workspaceId: workspace.id, path, side: d.side, startLine: start, endLine: end, code, body })
    closeDraft()
    onCommentsChanged()
    return comment
  }
  // Saves the comment and asks the agent about it in a new agent session, whose replies go in the comment's thread.
  const ask = async (d: Draft, body: string) => {
    const comment = await save(d, body)
    const session = await window.coxswain.startCommentSession(comment.id)
    props.onRunTurn(session.agentSessionId, '', [comment.id])
  }
  const remove = async (c: Comment) => {
    await window.coxswain.deleteComment(c.id)
    onCommentsChanged()
  }
  const render = ({ draft, comment }: Note) =>
    draft ? (
      <DraftBox draft={draft} onSave={save} onAsk={ask} onCancel={closeDraft} />
    ) : comment ? (
      <CommentBox
        comment={comment}
        attached={attachedIds.includes(comment.id)}
        onAttach={() => onAttach(comment)}
        onRemove={() => remove(comment)}
        turn={comment.agentSessionId ? props.turns[comment.agentSessionId] : undefined}
        onRunTurn={props.onRunTurn}
      />
    ) : null

  return (
    <div className={props.stacked ? 'select-text' : 'min-h-0 flex-1 overflow-auto select-text'}>
      {opened.kind === 'file' ? (
        <File<Note>
          file={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.file}
          renderAnnotation={(a) => render(a.metadata)}
        />
      ) : (
        <MultiFileDiff<Note>
          oldFile={files.old}
          newFile={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.diff}
          renderAnnotation={(a) => render(a.metadata)}
          renderHeaderMetadata={() => (
            <label className="flex items-center gap-1 font-sans text-xs select-none">
              <input
                type="checkbox"
                checked={props.viewed.includes(path)}
                onChange={(e) => props.onViewedChange(path, e.target.checked)}
              />
              Viewed
            </label>
          )}
        />
      )}
    </div>
  )
})

const lines = (start: number, end: number) => (start === end ? `Line ${start}` : `Lines ${start}–${end}`)
const box = 'm-2 flex flex-col gap-1.5 rounded-md border border-neutral-300 bg-white p-2 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900'

type DraftBoxProps = {
  draft: Draft
  onSave: (d: Draft, body: string) => void
  onAsk: (d: Draft, body: string) => void
  onCancel: () => void
}

function DraftBox({ draft, onSave, onAsk, onCancel }: DraftBoxProps) {
  const [body, setBody] = useState('')
  // autoFocus loses to the gutter button, which takes focus when the drag that opened this box ends.
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus())
    return () => clearTimeout(t)
  }, [])
  const [start, end] = [draft.startLine, draft.endLine].sort((a, b) => a - b)
  return (
    <div className={box}>
      <span className={`text-xs ${muted}`}>{lines(start, end)}</span>
      <textarea
        ref={input}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) (e.shiftKey ? onAsk : onSave)(draft, body)
        }}
        rows={3}
        placeholder="Comment for the agent (⌘Enter to save, ⇧⌘Enter to ask the agent now)"
        className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <div className="flex justify-end gap-1.5">
        <button className={`${button} text-xs`} onClick={onCancel}>
          Cancel
        </button>
        <button className={`${button} text-xs`} disabled={!body.trim()} onClick={() => onAsk(draft, body)}>
          Ask agent
        </button>
        <button className={`${primaryButton} text-xs`} disabled={!body.trim()} onClick={() => onSave(draft, body)}>
          Comment
        </button>
      </div>
    </div>
  )
}

type CommentBoxProps = {
  comment: Comment
  attached: boolean
  onAttach: () => void
  onRemove: () => void
  turn: Turn | undefined
  onRunTurn: RunTurn
}

function CommentBox({ comment: c, attached, onAttach, onRemove, turn, onRunTurn }: CommentBoxProps) {
  return (
    <div className={box}>
      <div className={`flex items-center gap-2 text-xs ${muted}`}>
        <span>{lines(c.startLine, c.endLine)}</span>
        {c.sentAt && <span className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">Sent to agent</span>}
      </div>
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</div>
      {c.agentSessionId && <Thread agentSessionId={c.agentSessionId} turn={turn} onRunTurn={onRunTurn} />}
      <div className="flex justify-end gap-1.5">
        <button className={`${button} text-xs`} disabled={turn?.running} onClick={onRemove}>
          Delete
        </button>
        {!c.agentSessionId && (
          <button className={`${button} text-xs`} disabled={attached} onClick={onAttach}>
            {attached ? 'In the message' : 'Send to agent'}
          </button>
        )}
      </div>
    </div>
  )
}

// The agent session asked from a comment: its replies, streamed while a turn runs, and a box to reply.
function Thread({ agentSessionId: id, turn, onRunTurn }: { agentSessionId: string; turn: Turn | undefined; onRunTurn: RunTurn }) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [reply, setReply] = useState('')
  useEffect(() => {
    let stale = false
    // ponytail: a turn that's running when this mounts may show an entry twice, once from the transcript and once
    // streamed. Fine while threads are short; dedupe by message ID if it shows.
    window.coxswain.readTranscript(id).then((e) => !stale && setEntries(e))
    const off = window.coxswain.onChatEntry((sid, e) => sid === id && setEntries((x) => [...x, e]))
    return () => {
      stale = true
      off()
    }
  }, [id])
  const running = turn?.running ?? false
  // The first message is the comment itself, already shown above.
  const shown = entries.filter((e, i) => !(i === 0 && e.kind === 'user'))
  const send = () => {
    if (!reply.trim() || running) return
    onRunTurn(id, reply.trim(), [])
    setReply('')
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-1.5 dark:border-neutral-800">
      <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
        {shown.map((e, i) => (
          <Entry key={i} entry={e} />
        ))}
        {running && <div className={`text-xs ${muted}`}>Working…</div>}
        {turn?.error && <div className="text-xs text-red-600 select-text dark:text-red-400">{turn.error}</div>}
      </div>
      {running ? (
        <button className={`${button} self-end text-xs`} onClick={() => window.coxswain.stopTurn(id)}>
          Stop
        </button>
      ) : (
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          placeholder="Reply to the agent (Enter to send)"
          className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
      )}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={`flex flex-1 items-center justify-center text-xs ${muted}`}>{children}</div>
}
