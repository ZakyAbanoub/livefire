import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { toId } from '@/lib/params'
import { MembersPanel } from './members-panel'
import { NewNoteForm } from './new-note-form'

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser()
  const orgId = toId((await params).orgId)
  if (!orgId) notFound()

  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    include: { org: true },
  })
  if (!membership) notFound()

  const notes = await prisma.note.findMany({
    where: { orgId },
    select: { id: true, title: true, author: { select: { email: true } } },
    orderBy: { id: 'asc' },
  })

  return (
    <>
      <AppHeader />
      <h1>{membership.org.name}</h1>
      <p className="meta">You are {membership.role === 'owner' ? 'an owner' : 'a member'} of this organization.</p>
      <h2>Notes</h2>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <Link href={`/notes/${note.id}`}>{note.title}</Link> <span className="meta">by {note.author.email}</span>
          </li>
        ))}
      </ul>
      <h2>New note</h2>
      <NewNoteForm orgId={orgId} />
      <h2>Members</h2>
      <MembersPanel orgId={orgId} />
    </>
  )
}
