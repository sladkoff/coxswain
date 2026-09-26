import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GitProblem } from '../../../core/git'
import type { GitHubProblem } from '../../../core/github'
import { cn } from './styles'

const code = 'rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800'

// Markdown from GitHub or an agent, selectable. Links get target=_blank so the main process opens them in the browser.
// inline: no paragraphs and no wrapper, for a title.
export function Prose({ children, inline, className }: { children: string; inline?: boolean; className?: string }) {
  const md = (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{ a: (p) => <a {...p} target="_blank" />, ...(inline && { p: (p) => <>{p.children}</> }) }}
    >
      {children}
    </Markdown>
  )
  return inline ? md : <div className={cn('markdown select-text [overflow-wrap:anywhere]', className)}>{md}</div>
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-xs text-red-600 select-text dark:text-red-400', className)}>{children}</div>
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
