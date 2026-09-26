import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ActionItem, ReviewRound } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { changed, core } from './queries'
import { button, itemsTitle, muted, primaryButton, Prose } from './ui'

const pane = 'border-neutral-200 dark:border-neutral-800'

// The review round's bar at the bottom of the Viewer (ADR 0012, 0019): ‹ Round N › steps through every round, the
// latest shown first. Wrap up drafts the round's action items and ends it; Show round opens the round above the bar:
// its action items, to tick done or edit, then its stream. A round is resolved once all its items are done.
// handedOffId: the round in L4's message box; onHandOff puts one there (hand off, glossary).
type Props = { workspace: Workspace; handedOffId: number | undefined; onHandOff: (round: ReviewRound) => void }

export function Round({ workspace, handedOffId, onHandOff }: Props) {
  const rounds = useQuery(core('listRounds', workspace.id)).data ?? []
  const [picked, setPicked] = useState<number | null>(null) // an index into rounds; null: the latest
  const [open, setOpen] = useState(false)
  const [wrapping, setWrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // A new round shows itself.
  useEffect(() => setPicked(null), [rounds.length])
  const load = () => changed({ workspaceId: workspace.id, what: 'entries' })

  const i = picked ?? rounds.length - 1
  const round = rounds[i]
  useEffect(() => setCopied(false), [round?.id])
  if (!round) return null
  const count = (kind: 'note' | 'question') => round.entries.filter((e) => e.kind === kind && !e.parentId).length
  const total = { notes: count('note'), questions: count('question') }
  const items = round.actionItems
  const openItems = items.filter((a) => !a.doneAt).length
  const wrapUp = async () => {
    setWrapping(true)
    setError(null)
    const result = await window.coxswain.wrapUp(round.id)
    setWrapping(false)
    if (result.status === 'error') setError(result.message)
    else setOpen(true)
    load()
  }
  const status = !round.endedAt
    ? ''
    : round.resolved
      ? ' · resolved'
      : ` · wrapped up, ${items.length - openItems} of ${items.length} done`
  const step = (by: number) => setPicked(Math.min(rounds.length - 1, Math.max(0, i + by)))

  return (
    <div className={`flex max-h-[50%] shrink-0 flex-col border-t text-xs ${pane}`}>
      {open && (
        <div className={`flex min-h-0 flex-col gap-1.5 overflow-y-auto border-b p-2 ${pane}`}>
          {round.endedAt && items.length === 0 && <div className={muted}>Nothing to change came out of this round.</div>}
          {items.map((item, n) => (
            <Item key={item.id} item={item} n={n + 1} onChanged={load} />
          ))}
          <Stream round={round} />
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <div className="flex items-center">
          <button className={`${muted} px-1 disabled:opacity-30`} title="Earlier round" disabled={i === 0} onClick={() => step(-1)}>
            ‹
          </button>
          <span className="font-medium tabular-nums">Round {round.number}</span>
          <button className={`${muted} px-1 disabled:opacity-30`} title="Later round" disabled={i === rounds.length - 1} onClick={() => step(1)}>
            ›
          </button>
        </div>
        <span className={`truncate ${muted}`}>
          {itemsTitle(total) || 'no notes or questions'}
          {status}
        </span>
        {error && <span className="min-w-0 truncate text-red-600 select-text dark:text-red-400">{error}</span>}
        <div className="flex-1" />
        <button className={`${button} text-xs`} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide round' : 'Show round'}
        </button>
        <button className={`${round.endedAt ? button : primaryButton} text-xs`} disabled={wrapping || !round.entries.length} onClick={wrapUp}>
          {wrapping ? 'Wrapping up…' : round.endedAt ? 'Wrap up again' : 'Wrap up'}
        </button>
        {round.endedAt && openItems > 0 && (
          <>
            <button
              className={`${button} text-xs`}
              title="Put the open action items and the round on the clipboard, for an agent outside coxswain"
              onClick={async () => {
                await window.coxswain.copyHandOffPrompt(round.id)
                setCopied(true)
              }}
            >
              {copied ? 'Copied' : 'Copy as prompt'}
            </button>
            {/* ponytail: posting isn't built yet (ADR 0019); the button marks where it goes. */}
            <button className={`${button} text-xs`} disabled title="Not built yet">
              Post to PR
            </button>
            <button className={`${primaryButton} text-xs`} disabled={wrapping || handedOffId === round.id} onClick={() => onHandOff(round)}>
              {handedOffId === round.id ? 'In the message' : 'Send to agent'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const where = (a: { path: string | null; startLine: number | null; endLine: number | null }) =>
  a.path && `${a.path}:${a.startLine === a.endLine ? a.startLine : `${a.startLine}–${a.endLine}`}`

// A round's stream in order: each note or question, with a question's follow-ups and answers under it.
function Stream({ round }: { round: ReviewRound }) {
  const top = round.entries.filter((e) => !e.parentId)
  if (!top.length) return null
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className={`font-medium ${muted}`}>Stream</div>
      {top.map((e) => (
        <div key={e.id} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-1.5 dark:border-neutral-800">
          <div className={`flex gap-2 ${muted}`}>
            <span className="capitalize">{e.kind}</span>
            {e.path && <span className="truncate font-mono">{where(e)}</span>}
          </div>
          <div className="whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{e.body}</div>
          {round.entries
            .filter((r) => r.parentId === e.id)
            .map((r) => (
              <div key={r.id} className="ml-3 border-l border-neutral-200 pl-2 dark:border-neutral-800">
                <div className={muted}>{r.kind === 'answer' ? 'Answer' : 'Follow-up'}</div>
                <div className="markdown select-text [overflow-wrap:anywhere]">
                  {r.kind === 'answer' ? <Prose>{r.body}</Prose> : r.body}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

// An action item: done, where it points, its text (click to edit) and Delete.
function Item({ item, n, onChanged }: { item: ActionItem; n: number; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const save = async () => {
    if (editing !== null && editing.trim() && editing.trim() !== item.body) await window.coxswain.updateActionItem(item.id, editing)
    setEditing(null)
    onChanged()
  }
  const at = where(item)
  return (
    <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-1.5 dark:border-neutral-800">
      <input
        type="checkbox"
        title="Done"
        className="mt-0.5"
        checked={!!item.doneAt}
        onChange={async (e) => {
          await window.coxswain.setActionItemDone(item.id, e.target.checked)
          onChanged()
        }}
      />
      <span className={`tabular-nums ${muted}`}>{n}.</span>
      <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${item.doneAt ? 'opacity-50' : ''}`}>
        {at && <span className={`truncate font-mono ${muted}`}>{at}</span>}
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
