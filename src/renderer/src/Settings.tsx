import { useEffect, useState } from 'react'
import type { CurrentUser } from '../../core/github'
import { Button } from './components/button'
import { Card, Screen } from './components/layout'
import { muted } from './components/styles'
import { ProblemMessage } from './components/text'

export function Settings({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const check = () => {
    setUser(null)
    window.coxswain.currentUser().then(setUser)
  }
  useEffect(check, [])

  return (
    <Screen title="Settings" onClose={onClose} className="max-w-xl overflow-auto">
      <h2 className="mb-3 font-medium">GitHub account</h2>
      <Card className="flex min-h-16 items-center gap-3">
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
            <Button className="ml-auto shrink-0" onClick={check}>
              Check again
            </Button>
          </>
        )}
      </Card>
    </Screen>
  )
}
