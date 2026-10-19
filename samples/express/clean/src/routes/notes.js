const express = require('express')
const { prisma } = require('../db')
const { toId } = require('../lib/params')
const { requireAuth, requireMembership } = require('../middleware/auth')

const router = express.Router()

async function listNotes(req, res) {
  const notes = await prisma.note.findMany({
    where: { orgId: req.membership.orgId },
    orderBy: { id: 'asc' },
  })
  res.json(notes)
}

async function createNote(req, res) {
  const { title, body } = req.body || {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }

  const note = await prisma.note.create({
    data: {
      orgId: req.membership.orgId,
      authorId: req.user.id,
      title: title.trim(),
      body: typeof body === 'string' ? body : '',
    },
  })
  res.status(201).json(note)
}

async function getNote(req, res) {
  const id = toId(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid note id' })

  const note = await prisma.note.findFirst({
    where: { id, org: { memberships: { some: { userId: req.user.id } } } },
  })
  if (!note) return res.status(404).json({ error: 'Note not found' })

  res.json(note)
}

async function updateNote(req, res) {
  const id = toId(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid note id' })

  const note = await prisma.note.findUnique({ where: { id } })
  const membership =
    note &&
    (await prisma.membership.findUnique({
      where: { userId_orgId: { userId: req.user.id, orgId: note.orgId } },
    }))
  if (!membership) return res.status(404).json({ error: 'Note not found' })

  const { title, body } = req.body || {}
  const updated = await prisma.note.update({ where: { id }, data: { title, body } })
  res.json(updated)
}

async function deleteNote(req, res) {
  const id = toId(req.params.id)
  if (!id) return res.status(400).json({ error: 'Invalid note id' })

  const note = await prisma.note.findUnique({ where: { id } })
  const membership =
    note &&
    (await prisma.membership.findUnique({
      where: { userId_orgId: { userId: req.user.id, orgId: note.orgId } },
    }))
  if (!membership) return res.status(404).json({ error: 'Note not found' })
  if (note.authorId !== req.user.id && membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only the author or an owner can delete this note' })
  }

  await prisma.note.delete({ where: { id } })
  res.status(204).end()
}

router.get('/orgs/:orgId/notes', requireAuth, requireMembership, listNotes)
router.post('/orgs/:orgId/notes', requireAuth, requireMembership, createNote)
router.get('/notes/:id', requireAuth, getNote)
router.patch('/notes/:id', requireAuth, updateNote)
router.delete('/notes/:id', requireAuth, deleteNote)

module.exports = router
