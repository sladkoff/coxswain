import { useEffect, useState } from 'react'
import type { ActionItem, ReviewEntry, ReviewRound } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { button, countItems, itemsTitle, muted, primaryButton } from './ui'

const pane = 'border-neutral-200 dark:border-neutral-800'

// The review round's bar at the bottom of the Viewer: how many notes and questions it has, and Wrap up (ADR 0012),
// which drafts its action items and ends it. The draft opens above the bar, to edit.
// entries: the latest round's, reloaded by the parent; the round itself is reread when they change.
export function Round({ workspace, entries }: { workspace: Workspace; entries: ReviewEntry[] }) {
  const [round, setRound] = useState<ReviewRound | null>(null)
  const [open, setOpen] = useState(false)
  const [wrapping, setWrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = () => window.coxswain.getRound(workspace.id).then(setRound)
  useEffect(() => void load(), [workspace.id, entries])

  if (!round || !entries.length) return null
  const total = [...countItems(entries).values()].reduce(
    (sum, c) => ({ notes: sum.notes + c.notes, questions: sum.questions + c.questions }),
    { notes: 0, questions: 0 },
  )
  const items = round.actionItems
  const wrapUp = async () => {
    setWrapping(true)
    setError(null)
    const result = await window.coxswain.wrapUp(workspace.id)
    setWrapping(false)
    if (result.status === 'error') setError(result.message)
    else setOpen(true)
    load()
  }

  return (
    <div className={`flex max-h-[50%] shrink-0 flex-col border-t text-xs ${pane}`}>
      {open && round.endedAt && (
        <div className={`flex min-h-0 flex-col gap-1.5 overflow-y-auto border-b p-2 ${pane}`}>
          {items.length === 0 && <div className={muted}>Nothing to change came out of this round.</div>}
          {items.map((item, i) => (
            <Item key={item.id} item={item} n={i + 1} onChanged={load} />
          ))}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <span className="font-medium">Round {round.number}</span>
        <span className={muted}>
          {itemsTitle(total) || 'no notes or questions'}
          {round.endedAt && ` · wrapped up, ${items.length} action item${items.length === 1 ? '' : 's'}`}
        </span>
        {error && <span className="min-w-0 truncate text-red-600 select-text dark:text-red-400">{error}</span>}
        <div className="flex-1" />
        {round.endedAt && (
          <button className={`${button} text-xs`} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide action items' : 'Show action items'}
          </button>
        )}
        <button className={`${round.endedAt ? button : primaryButton} text-xs`} disabled={wrapping} onClick={wrapUp}>
          {wrapping ? 'Wrapping up…' : round.endedAt ? 'Wrap up again' : 'Wrap up'}
        </button>
      </div>
    </div>
  )
}

// An action item of the draft: where it points, its text (click to edit) and Delete.
function Item({ item, n, onChanged }: { item: ActionItem; n: number; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const save = async () => {
    if (editing !== null && editing.trim() && editing.trim() !== item.body) await window.coxswain.updateActionItem(item.id, editing)
    setEditing(null)
    onChanged()
  }
  const where =
    item.path && `${item.path}:${item.startLine === item.endLine ? item.startLine : `${item.startLine}–${item.endLine}`}`
  return (
    <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-1.5 dark:border-neutral-800">
      <span className={`tabular-nums ${muted}`}>{n}.</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {where && <span className={`truncate font-mono ${muted}`}>{where}</span>}
        {editing === null ? (
          <div className="cursor-text whitespace-pre-wrap select-text [overflow-wrap:anywhere]" onClick={() => setEditing(item.body)}>
            {item.body}
          </div>
        ) : (
          <textarea
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(null)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            }}
            rows={3}
            className="resize-none rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
        )}
      </div>
      <button
        className={`${muted} hover:text-neutral-900 dark:hover:text-neutral-100`}
        title="Delete the action item"
        onClick={async () => {
          await window.coxswain.deleteActionItem(item.id)
          onChanged()
        }}
      >
        ✕
      </button>
    </div>
  )
}
