import { useEffect, useState } from 'react'
import type { CurrentUser } from '../../core/github'

const muted = 'text-neutral-500'
const button =
  'rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
const code = 'rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800'

export function Settings({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const check = () => {
    setUser(null)
    window.coxswain.currentUser().then(setUser)
  }
  useEffect(check, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex h-full flex-col select-none text-sm">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 pr-3 pl-20 [-webkit-app-region:drag] dark:border-neutral-800">
        <span className="font-medium">Settings</span>
        <button className={`${button} [-webkit-app-region:no-drag]`} onClick={onClose}>
          Done
        </button>
      </div>

      <div className="mx-auto w-full max-w-xl p-6">
        <h2 className="mb-3 font-medium">GitHub account</h2>
        <div className="flex min-h-16 items-center gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <Account user={user} />
          {user?.status !== 'signed-in' && (
            <button className={`${button} ml-auto shrink-0`} onClick={check} disabled={!user}>
              Check again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Account({ user }: { user: CurrentUser | null }) {
  if (!user) return <span className={muted}>Checking…</span>
  switch (user.status) {
    case 'signed-in':
      return (
        <>
          <img src={user.avatarUrl} alt="" className="size-10 rounded-full" />
          <div>
            <div className="font-medium">{user.name ?? user.login}</div>
            <div className={muted}>@{user.login} · signed in through the GitHub CLI</div>
          </div>
        </>
      )
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
      return <span>Couldn't reach GitHub: {user.message}</span>
  }
}
