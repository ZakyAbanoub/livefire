const jwt = require('jsonwebtoken')
const config = require('../config')
const { prisma } = require('../db')
const { toId } = require('../lib/params')

async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: { id: true, email: true },
  })
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  req.user = user
  next()
}

async function requireMembership(req, res, next) {
  const orgId = toId(req.params.orgId)
  if (!orgId) return res.status(400).json({ error: 'Invalid organization id' })

  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: req.user.id, orgId } },
  })
  if (!membership) {
    return res.status(404).json({ error: 'Organization not found' })
  }

  req.membership = membership
  next()
}

function requireOrgRole(role) {
  return [
    requireMembership,
    (req, res, next) => {
      if (req.membership.role !== role) {
        return res.status(403).json({ error: `Requires the ${role} role` })
      }
      next()
    },
  ]
}

module.exports = { requireAuth, requireMembership, requireOrgRole }
