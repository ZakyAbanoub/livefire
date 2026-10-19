import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { toId } from '@/lib/params'

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const orgId = toId((await params).orgId)
  if (!orgId) return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 })

  const memberships = await prisma.membership.findMany({
    where: { orgId },
    select: { role: true, user: { select: { id: true, email: true } } },
    orderBy: { userId: 'asc' },
  })
  return NextResponse.json(memberships.map((m) => ({ ...m.user, role: m.role })))
}
