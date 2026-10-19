import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

// Everyone who shares at least one organization with the caller.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const users = await prisma.user.findMany({
    where: {
      memberships: { some: { org: { memberships: { some: { userId: user.id } } } } },
    },
    include: { memberships: { select: { orgId: true, role: true } } },
    orderBy: { id: 'asc' },
  })
  return NextResponse.json(users)
}
