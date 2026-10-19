import Link from 'next/link'
import { AppHeader } from '@/components/app-header'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export default async function OrgsPage() {
  const user = await requireUser()
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { role: true, org: { select: { id: true, name: true } } },
    orderBy: { orgId: 'asc' },
  })

  return (
    <>
      <AppHeader />
      <h1>Your organizations</h1>
      <ul>
        {memberships.map((m) => (
          <li key={m.org.id}>
            <Link href={`/orgs/${m.org.id}`}>{m.org.name}</Link> <span className="meta">({m.role})</span>
          </li>
        ))}
      </ul>
    </>
  )
}
