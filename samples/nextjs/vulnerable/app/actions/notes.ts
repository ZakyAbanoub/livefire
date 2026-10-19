'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getMembership } from '@/lib/orgs'

export type NoteInput = { title: string; body: string }

export async function createNote(orgId: number, input: NoteInput) {
  const user = await requireUser()
  const membership = await getMembership(user.id, orgId)
  if (!membership) return { error: 'Organization not found' }

  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  if (!title) return { error: 'Title is required' }

  const note = await prisma.note.create({
    data: { orgId, authorId: user.id, title, body: typeof input.body === 'string' ? input.body : '' },
  })
  return { id: note.id }
}

export async function updateNote(id: number, input: NoteInput) {
  const user = await requireUser()
  const note = await prisma.note.findUnique({ where: { id } })
  const membership = note && (await getMembership(user.id, note.orgId))
  if (!note || !membership) return { error: 'Note not found' }

  if (typeof input?.title !== 'string' || !input.title.trim()) return { error: 'Title is required' }

  await prisma.note.update({ where: { id }, data: input })
  return { ok: true }
}

export async function deleteNote(id: number) {
  const user = await requireUser()
  const note = await prisma.note.findUnique({ where: { id } })
  const membership = note && (await getMembership(user.id, note.orgId))
  if (!note || !membership) return { error: 'Note not found' }
  if (note.authorId !== user.id && membership.role !== 'owner') {
    return { error: 'Only the author or an owner can delete this note' }
  }

  await prisma.note.delete({ where: { id } })
  redirect(`/orgs/${note.orgId}`)
}
