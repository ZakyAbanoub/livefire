const express = require('express')
const crypto = require('node:crypto')
const { prisma } = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

async function getProfile(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      apiToken: true,
      memberships: { select: { role: true, org: { select: { id: true, name: true } } } },
    },
  })
  res.json(user)
}

async function rotateApiToken(req, res) {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { apiToken: 'nt_' + crypto.randomBytes(24).toString('hex') },
    select: { id: true, apiToken: true },
  })
  res.json(user)
}

router.get('/', requireAuth, getProfile)
router.post('/api-token', requireAuth, rotateApiToken)

module.exports = router
