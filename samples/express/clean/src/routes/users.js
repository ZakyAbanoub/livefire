const express = require('express')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Everyone who shares at least one organization with the caller.
async function listTeammates(req, res) {
  const users = await prisma.user.findMany({
    where: {
      memberships: { some: { org: { memberships: { some: { userId: req.user.id } } } } },
    },
    select: { id: true, email: true, memberships: { select: { orgId: true, role: true } } },
    orderBy: { id: 'asc' },
  })
  res.json(users)
}

router.get('/', requireAuth, listTeammates)

module.exports = router
