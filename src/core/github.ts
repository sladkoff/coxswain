import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Octokit } from '@octokit/core'

export type CurrentUser =
  | { status: 'signed-in'; login: string; name: string | null; avatarUrl: string }
  | { status: 'signed-out' }
  | { status: 'gh-missing' }
  | { status: 'error'; message: string }

// ADR 0006: the token comes from `gh` each time and is never stored.
// ponytail: relies on PATH, a Finder-launched packaged app won't see Homebrew's gh; fix when we package.
async function ghToken(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token', '--hostname', 'github.com'])
    return stdout.trim() || null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e
    return null // gh exits non-zero when not signed in
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  let token: string | null
  try {
    token = await ghToken()
  } catch {
    return { status: 'gh-missing' }
  }
  if (!token) return { status: 'signed-out' }

  try {
    const { data } = await new Octokit({ auth: token }).request('GET /user')
    return { status: 'signed-in', login: data.login, name: data.name, avatarUrl: data.avatar_url }
  } catch (e) {
    if ((e as { status?: number }).status === 401) return { status: 'signed-out' }
    return { status: 'error', message: (e as Error).message }
  }
}
