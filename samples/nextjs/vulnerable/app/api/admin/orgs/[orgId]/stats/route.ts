import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getMembership } from '@/lib/orgs'
import { toId } from '@/lib/params'

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const orgId = toId((await params).orgId)
  if (!orgId) return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 })

  const membership = await getMembership(user.id, orgId)
  if (!membership) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  if (membership.role !== 'owner') return NextResponse.json({ error: 'Requires the owner role' }, { status: 403 })

  const [members, notes] = await Promise.all([
    prisma.membership.count({ where: { orgId } }),
    prisma.note.count({ where: { orgId } }),
  ])
  return NextResponse.json({ orgId, members, notes })
}
