const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const config = require('../config')
const { prisma } = require('../db')

const router = express.Router()

async function login(req, res) {
  const { email, password } = req.body || {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  const ok = user && (await bcrypt.compare(password, user.passwordHash))
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const token = jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn })
  res.json({ token, user: { id: user.id, email: user.email } })
}

router.post('/login', login)

module.exports = router
