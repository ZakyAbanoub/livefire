import Link from 'next/link'
import { requireUser } from '@/lib/auth'

export async function AppHeader() {
  const user = await requireUser()
  return (
    <header>
      <Link href="/orgs">Notes</Link>
      <form action="/api/auth/logout" method="post">
        <span className="meta">{user.email}</span> <button type="submit">Sign out</button>
      </form>
    </header>
  )
}
