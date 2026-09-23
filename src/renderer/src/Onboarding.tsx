import type { ReactNode } from 'react'
import { button, muted, primaryButton } from './ui'

// Shown full window while there is no project yet.
export function Onboarding({ onSettings, onChooseProject }: { onSettings: () => void; onChooseProject: () => void }) {
  return (
    <div className="flex h-full flex-col select-none text-sm">
      <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-10">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Welcome to coxswain</h1>
          <p className={`mt-2 ${muted}`}>Review pull requests and hand the comments to your local coding agents.</p>
        </div>

        <ol className="w-full max-w-md space-y-3">
          <Step n={1} title="Sign in to GitHub" detail="coxswain uses the GitHub CLI. Check your account in Settings.">
            <button className={button} onClick={onSettings}>
              Open Settings
            </button>
          </Step>
          <Step n={2} title="Choose your first project" detail="Pick one of your GitHub repositories.">
            <button className={primaryButton} onClick={onChooseProject}>
              Choose project
            </button>
          </Step>
        </ol>
      </div>
    </div>
  )
}

function Step({ n, title, detail, children }: { n: number; title: string; detail: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-xs dark:border-neutral-700 ${muted}`}>
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className={muted}>{detail}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  )
}
