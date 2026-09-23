import type { DiffLineAnnotation, LineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { File, MultiFileDiff } from '@pierre/diffs/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { Comment } from '../../core/comments'
import type { ChangedFile, FileText } from '../../core/git'
import type { Workspace } from '../../core/workspaces'
import { button, muted, primaryButton, ProblemMessage } from './ui'

// What the Viewer shows: the file diff of a changed file, or a whole file as it is in the worktree.
export type Opened = { kind: 'diff'; file: ChangedFile } | { kind: 'file'; path: string }

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
}

const baseOptions = { preferredHighlighter: 'shiki-js', overflow: 'scroll', stickyHeader: true } as const

// L3: shows the diff or file opened from the Navigator.
// The old side is the merge base (git show), the new side the worktree now.
// The + in the gutter (click, or drag for a range) starts a local comment on those lines.
export function Viewer({ workspace, mergeBase, opened, version, comments, onCommentsChanged, attachedIds, onAttach }: Props) {
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

  useEffect(() => {
    setSides(null)
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

  if (!sides) return <Centered>Loading…</Centered>
  const { old: o, new: n } = sides
  if (o.status !== 'ok' || n.status !== 'ok')
    return (
      <Centered>
        <ProblemMessage problem={o.status !== 'ok' ? o : (n as Exclude<FileText, { status: 'ok' }>)} />
      </Centered>
    )
  if (o.binary || n.binary) return <Centered>Binary file, not shown</Centered>

  // A whole file only shows the worktree, so only comments on the new side belong in it.
  const notes: { side: 'old' | 'new'; line: number; note: Note }[] = [
    ...comments
      .filter((c) => c.path === path && (opened.kind === 'diff' || c.side === 'new'))
      .map((c) => ({ side: c.side, line: c.endLine, note: { comment: c } })),
    ...(draft ? [{ side: draft.side, line: Math.max(draft.startLine, draft.endLine), note: { draft } }] : []),
  ]

  const save = async (d: Draft, body: string) => {
    const [start, end] = [d.startLine, d.endLine].sort((a, b) => a - b)
    const text = (d.side === 'old' ? o.text : n.text) ?? ''
    const code = text.split('\n').slice(start - 1, end).join('\n')
    await window.coxswain.addComment({ workspaceId: workspace.id, path, side: d.side, startLine: start, endLine: end, code, body })
    closeDraft()
    onCommentsChanged()
  }
  const remove = async (c: Comment) => {
    await window.coxswain.deleteComment(c.id)
    onCommentsChanged()
  }
  const render = ({ draft, comment }: Note) =>
    draft ? (
      <DraftBox draft={draft} onSave={save} onCancel={closeDraft} />
    ) : comment ? (
      <CommentBox
        comment={comment}
        attached={attachedIds.includes(comment.id)}
        onAttach={() => onAttach(comment)}
        onRemove={() => remove(comment)}
      />
    ) : null

  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      {opened.kind === 'file' ? (
        <File<Note>
          file={{ name: path, contents: n.text ?? '' }}
          options={options}
          selectedLines={selection}
          lineAnnotations={notes.map((a): LineAnnotation<Note> => ({ lineNumber: a.line, metadata: a.note }))}
          renderAnnotation={(a) => render(a.metadata)}
        />
      ) : (
        <MultiFileDiff<Note>
          oldFile={{ name: opened.file.previousPath ?? path, contents: o.text ?? '' }}
          newFile={{ name: path, contents: n.text ?? '' }}
          options={options}
          selectedLines={selection}
          lineAnnotations={notes.map(
            (a): DiffLineAnnotation<Note> => ({
              side: a.side === 'old' ? 'deletions' : 'additions',
              lineNumber: a.line,
              metadata: a.note,
            }),
          )}
          renderAnnotation={(a) => render(a.metadata)}
        />
      )}
    </div>
  )
}

const lines = (start: number, end: number) => (start === end ? `Line ${start}` : `Lines ${start}–${end}`)
const box = 'm-2 flex flex-col gap-1.5 rounded-md border border-neutral-300 bg-white p-2 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900'

function DraftBox({ draft, onSave, onCancel }: { draft: Draft; onSave: (d: Draft, body: string) => void; onCancel: () => void }) {
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
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) onSave(draft, body)
        }}
        rows={3}
        placeholder="Comment for the agent (⌘Enter to save)"
        className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
      />
      <div className="flex justify-end gap-1.5">
        <button className={`${button} text-xs`} onClick={onCancel}>
          Cancel
        </button>
        <button className={`${primaryButton} text-xs`} disabled={!body.trim()} onClick={() => onSave(draft, body)}>
          Comment
        </button>
      </div>
    </div>
  )
}

type CommentBoxProps = { comment: Comment; attached: boolean; onAttach: () => void; onRemove: () => void }

function CommentBox({ comment: c, attached, onAttach, onRemove }: CommentBoxProps) {
  return (
    <div className={box}>
      <div className={`flex items-center gap-2 text-xs ${muted}`}>
        <span>{lines(c.startLine, c.endLine)}</span>
        {c.sentAt && <span className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">Sent to agent</span>}
      </div>
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</div>
      <div className="flex justify-end gap-1.5">
        <button className={`${button} text-xs`} onClick={onRemove}>
          Delete
        </button>
        <button className={`${button} text-xs`} disabled={attached} onClick={onAttach}>
          {attached ? 'In the message' : 'Send to agent'}
        </button>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={`flex flex-1 items-center justify-center text-xs ${muted}`}>{children}</div>
}
