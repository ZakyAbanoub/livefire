import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { toId } from '@/lib/params'
import { EditNoteForm } from './edit-note-form'

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser()
  const id = toId((await params).id)
  if (!id) notFound()

  const note = await prisma.note.findUnique({
    where: { id },
    include: { org: { select: { id: true, name: true } }, author: { select: { email: true } } },
  })
  if (!note) notFound()

  return (
    <>
      <AppHeader />
      <p>
        <Link href={`/orgs/${note.org.id}`}>← {note.org.name}</Link>
      </p>
      <h1>{note.title}</h1>
      <p className="meta">by {note.author.email}</p>
      <article>{note.body}</article>
      <h2>Edit</h2>
      <EditNoteForm note={{ id: note.id, title: note.title, body: note.body }} />
    </>
  )
}
