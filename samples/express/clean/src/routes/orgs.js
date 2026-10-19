const express = require('express')
const { prisma } = require('../db')
const { toId } = require('../lib/params')
const { requireAuth, requireMembership } = require('../middleware/auth')

const router = express.Router()

async function listMyOrgs(req, res) {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id },
    select: { role: true, org: { select: { id: true, name: true } } },
    orderBy: { orgId: 'asc' },
  })
  res.json(memberships.map((m) => ({ ...m.org, role: m.role })))
}

async function listMembers(req, res) {
  const orgId = toId(req.params.orgId)
  if (!orgId) return res.status(400).json({ error: 'Invalid organization id' })

  const memberships = await prisma.membership.findMany({
    where: { orgId },
    select: { role: true, user: { select: { id: true, email: true } } },
    orderBy: { userId: 'asc' },
  })
  res.json(memberships.map((m) => ({ ...m.user, role: m.role })))
}

router.get('/', requireAuth, listMyOrgs)
router.get('/:orgId/members', requireAuth, requireMembership, listMembers)

module.exports = router
