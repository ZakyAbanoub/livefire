'use client'

import { useEffect, useState } from 'react'

type Member = { id: number; email: string; role: 'owner' | 'member' }

export function MembersPanel({ orgId }: { orgId: number }) {
  const [members, setMembers] = useState<Member[] | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${orgId}/members`)
      .then((response) => (response.ok ? response.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [orgId])

  if (!members) return <p className="meta">Loading…</p>
  return (
    <ul>
      {members.map((m) => (
        <li key={m.id}>
          {m.email} <span className="meta">({m.role})</span>
        </li>
      ))}
    </ul>
  )
}
