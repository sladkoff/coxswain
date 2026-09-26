import { useEffect, useState } from 'react'
import type { CurrentUser } from '../../core/github'
import { button, ProblemMessage, muted, ScreenHeader } from './ui'

export function Settings({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const check = () => {
    setUser(null)
    window.coxswain.currentUser().then(setUser)
  }
  useEffect(check, [])

  return (
    <div className="flex h-full flex-col select-none text-sm">
      <ScreenHeader title="Settings" onClose={onClose} />

      <div className="mx-auto w-full max-w-xl overflow-auto p-6">
        <h2 className="mb-3 font-medium">GitHub account</h2>
        <div className="flex min-h-16 items-center gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          {!user ? (
            <span className={muted}>Checking…</span>
          ) : user.status === 'signed-in' ? (
            <>
              <img src={user.avatarUrl} alt="" className="size-10 rounded-full" />
              <div>
                <div className="font-medium">{user.name ?? user.login}</div>
                <div className={muted}>@{user.login} · signed in through the GitHub CLI</div>
              </div>
            </>
          ) : (
            <>
              <ProblemMessage problem={user} />
              <button className={`${button} ml-auto shrink-0`} onClick={check}>
                Check again
              </button>
            </>
          )}
        </div>

        <SummarySection />
      </div>
    </div>
  )
}

const field =
  'rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none select-text focus:border-neutral-500 dark:border-neutral-700'

// The model change summaries are made on (ADR 0020). Saved when the field loses focus.
function SummarySection() {
  const [model, setModel] = useState<string | null>(null)
  useEffect(() => void window.coxswain.getSummaryModel().then(setModel), [])
  if (model === null) return null
  return (
    <>
      <h2 className="mt-6 mb-3 font-medium">Change summaries</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <label className="flex flex-col gap-1">
          Model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => window.coxswain.setSummaryModel(model)}
            placeholder="Claude Code's default"
            className={field}
          />
          <span className={`text-xs ${muted}`}>Summarises each new version of the PR. A fast one, e.g. haiku.</span>
        </label>
      </div>
    </>
  )
}
