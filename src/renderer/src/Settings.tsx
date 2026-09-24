import { useEffect, useState } from 'react'
import type { CurrentUser } from '../../core/github'
import type { GuideSettings } from '../../core/guides'
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

        <GuideSection />
      </div>
    </div>
  )
}

const field =
  'rounded-md border border-neutral-300 bg-transparent p-1.5 outline-none select-text focus:border-neutral-500 dark:border-neutral-700'

// The prompt and model the Guide tab asks Claude Code with. Saved when a field loses focus.
function GuideSection() {
  const [s, setS] = useState<GuideSettings | null>(null)
  useEffect(() => void window.coxswain.getGuideSettings().then(setS), [])
  if (!s) return null
  const save = (next: GuideSettings) => {
    setS(next)
    window.coxswain.setGuideSettings(next)
  }
  return (
    <>
      <h2 className="mt-6 mb-3 font-medium">Guide</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between">
            Prompt
            <button
              className={`${button} text-xs`}
              disabled={s.prompt === s.defaultPrompt}
              onClick={() => save({ ...s, prompt: s.defaultPrompt })}
            >
              Reset
            </button>
          </span>
          <textarea
            rows={7}
            value={s.prompt}
            onChange={(e) => setS({ ...s, prompt: e.target.value })}
            onBlur={() => save(s)}
            className={`${field} resize-y text-xs`}
          />
          <span className={`text-xs ${muted}`}>The changed files, how to read their diffs and the answer's format are added after it.</span>
        </label>
        <label className="flex flex-col gap-1">
          Model
          <input
            value={s.model}
            onChange={(e) => setS({ ...s, model: e.target.value })}
            onBlur={() => save(s)}
            placeholder="Claude Code's default"
            className={field}
          />
          <span className={`text-xs ${muted}`}>Groups the files, then describes each group. A Claude Code model name or alias, e.g. sonnet or opus.</span>
        </label>
        <label className="flex flex-col gap-1">
          Summary model
          <input
            value={s.summaryModel}
            onChange={(e) => setS({ ...s, summaryModel: e.target.value })}
            onBlur={() => save(s)}
            placeholder="Claude Code's default"
            className={field}
          />
          <span className={`text-xs ${muted}`}>Summarises every file diff before grouping, a batch at a time, many at once. A fast one, e.g. haiku.</span>
        </label>
      </div>
    </>
  )
}
