import { useEffect, useState } from 'react'
import type { CurrentUser } from '../../core/github'
import { button, GitHubProblemMessage, muted, ScreenHeader } from './ui'

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

      <div className="mx-auto w-full max-w-xl p-6">
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
              <GitHubProblemMessage problem={user} />
              <button className={`${button} ml-auto shrink-0`} onClick={check}>
                Check again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
