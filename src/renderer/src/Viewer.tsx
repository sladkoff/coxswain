import { File, MultiFileDiff } from '@pierre/diffs/react'
import { type ReactNode, useEffect, useState } from 'react'
import type { ChangedFile, FileText } from '../../core/github'
import type { Project } from '../../core/projects'
import { GitHubProblemMessage, muted } from './ui'

// What the Viewer shows: the file diff of a changed file, or a whole file at the PR's head.
export type Opened = { kind: 'diff'; file: ChangedFile } | { kind: 'file'; path: string }

type Props = { project: Project; commits: { head: string; mergeBase: string }; opened: Opened }

const options = { preferredHighlighter: 'shiki-js', overflow: 'scroll', stickyHeader: true } as const

// L3: shows the diff or file opened from the Navigator.
export function Viewer({ project, commits, opened }: Props) {
  const [sides, setSides] = useState<{ old: FileText; new: FileText } | null>(null)

  useEffect(() => {
    setSides(null)
    let stale = false
    const read = (commit: string, path: string) => window.coxswain.readFileAt(project.owner, project.name, commit, path)
    const newPath = opened.kind === 'diff' ? opened.file.path : opened.path
    const oldSide: Promise<FileText> =
      opened.kind === 'file'
        ? Promise.resolve({ status: 'ok', text: null, binary: false })
        : opened.file.status === 'added'
          ? Promise.resolve({ status: 'ok', text: '', binary: false })
          : read(commits.mergeBase, opened.file.previousPath ?? opened.file.path)
    const newSide: Promise<FileText> =
      opened.kind === 'diff' && opened.file.status === 'deleted'
        ? Promise.resolve({ status: 'ok', text: '', binary: false })
        : read(commits.head, newPath)
    Promise.all([oldSide, newSide]).then(([o, n]) => !stale && setSides({ old: o, new: n }))
    return () => void (stale = true)
  }, [opened, commits.head])

  if (!sides) return <Centered>Loading…</Centered>
  const { old: o, new: n } = sides
  if (o.status !== 'ok' || n.status !== 'ok')
    return (
      <Centered>
        <GitHubProblemMessage problem={o.status !== 'ok' ? o : (n as Exclude<FileText, { status: 'ok' }>)} />
      </Centered>
    )
  if (o.binary || n.binary) return <Centered>Binary file, not shown</Centered>

  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      {opened.kind === 'file' ? (
        <File file={{ name: opened.path, contents: n.text ?? '' }} options={options} />
      ) : (
        <MultiFileDiff
          oldFile={{ name: opened.file.previousPath ?? opened.file.path, contents: o.text ?? '' }}
          newFile={{ name: opened.file.path, contents: n.text ?? '' }}
          options={options}
        />
      )}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={`flex flex-1 items-center justify-center text-xs ${muted}`}>{children}</div>
}
