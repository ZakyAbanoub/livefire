import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { toId } from '@/lib/params'

export async function POST(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const orgId = toId((await params).orgId)
  if (!orgId) return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 })

  const { count } = await prisma.note.deleteMany({ where: { orgId } })
  return NextResponse.json({ orgId, deleted: count })
}
