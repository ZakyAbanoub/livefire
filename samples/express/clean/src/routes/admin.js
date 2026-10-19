const express = require('express')
const { prisma } = require('../db')
const { toId } = require('../lib/params')
const { requireAuth, requireOrgRole } = require('../middleware/auth')

const router = express.Router()

async function orgStats(req, res) {
  const orgId = req.membership.orgId
  const [members, notes] = await Promise.all([
    prisma.membership.count({ where: { orgId } }),
    prisma.note.count({ where: { orgId } }),
  ])
  res.json({ orgId, members, notes })
}

async function purgeOrgNotes(req, res) {
  const orgId = toId(req.params.orgId)
  if (!orgId) return res.status(400).json({ error: 'Invalid organization id' })

  const { count } = await prisma.note.deleteMany({ where: { orgId } })
  res.json({ orgId, deleted: count })
}

router.use(requireAuth)
router.get('/orgs/:orgId/stats', requireOrgRole('owner'), orgStats)
router.post('/orgs/:orgId/purge', requireOrgRole('owner'), purgeOrgNotes)

module.exports = router
