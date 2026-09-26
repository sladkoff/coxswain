import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GitProblem } from '../../core/git'
import type { GitHubProblem } from '../../core/github'
import type { ReviewEntry } from '../../core/review'

export const muted = 'text-neutral-500'

// The workspace's notes and questions on each file, as the Navigator shows them.
// Replies, follow-ups and answers are part of their thread, so they don't count.
export type ItemCount = { notes: number; questions: number }
export function countItems(entries: ReviewEntry[]): Map<string, ItemCount> {
  const counts = new Map<string, ItemCount>()
  for (const e of entries) {
    // Only what's about the code on screen (ADR 0015): not outdated entries.
    if (!e.path || e.parentId || e.state !== 'current' || (e.kind !== 'note' && e.kind !== 'question')) continue
    const c = counts.get(e.path) ?? { notes: 0, questions: 0 }
    if (e.kind === 'note') c.notes++
    if (e.kind === 'question') c.questions++
    counts.set(e.path, c)
  }
  return counts
}
const plural = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '')
export const itemsTitle = (c: ItemCount) => [plural(c.notes, 'note'), plural(c.questions, 'question')].filter(Boolean).join(', ')
export const button =
  'rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
export const primaryButton =
  'rounded-md bg-neutral-900 px-2.5 py-1 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300'
const code = 'rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800'

// Title bar of a full-window screen; Esc or Done closes it.
export function ScreenHeader({ title, onClose }: { title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 pr-3 pl-20 [-webkit-app-region:drag] dark:border-neutral-800">
      <span className="font-medium">{title}</span>
      <button className={`${button} [-webkit-app-region:no-drag]`} onClick={onClose}>
        Done
      </button>
    </div>
  )
}

export function ProblemMessage({ problem }: { problem: GitHubProblem | GitProblem }) {
  switch (problem.status) {
    case 'git-error':
      return <span className="select-text">Git: {problem.message}</span>
    case 'signed-out':
      return (
        <span>
          Not signed in. Run <code className={code}>gh auth login</code> in a terminal.
        </span>
      )
    case 'gh-missing':
      return (
        <span>
          The GitHub CLI isn't installed. Run <code className={code}>brew install gh</code>, then{' '}
          <code className={code}>gh auth login</code>.
        </span>
      )
    case 'error':
      return <span>Couldn't reach GitHub: {problem.message}</span>
  }
}

// Drag handle on the border between a side pane and the Viewer; resizes the side pane, which is on its left (or
// right, with `fromRight`). The Viewer never gets narrower than `viewerMin`.
export const viewerMin = 320
export function Splitter(props: { min: number; max: number; fromRight?: boolean; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; width: number; max: number } | null>(null)
  return (
    <div
      className="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize [-webkit-app-region:no-drag]"
      onPointerDown={(e) => {
        const el = e.currentTarget
        const [pane, viewer] = props.fromRight
          ? [el.nextElementSibling, el.previousElementSibling]
          : [el.previousElementSibling, el.nextElementSibling]
        if (!pane || !viewer) return
        // Measured, not taken from state: the pane may have shrunk with the window.
        const width = pane.clientWidth
        el.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width, max: Math.min(props.max, width + viewer.clientWidth - viewerMin) }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const dx = (e.clientX - s.x) * (props.fromRight ? -1 : 1)
        props.onResize(Math.max(props.min, Math.min(s.max, s.width + dx)))
      }}
      onLostPointerCapture={() => (start.current = null)}
    />
  )
}

// Cog, from Lucide (ISC licence).
export function Cog() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// Send, from Lucide (ISC licence).
export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  )
}

// Markdown from GitHub or an agent. Links get target=_blank so the main process opens them in the browser.
// inline: no paragraphs, for a title.
export function Prose({ children, inline }: { children: string; inline?: boolean }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{ a: (p) => <a {...p} target="_blank" />, ...(inline && { p: (p) => <>{p.children}</> }) }}
    >
      {children}
    </Markdown>
  )
}
