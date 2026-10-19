const express = require('express')

const authRoutes = require('./routes/auth')
const meRoutes = require('./routes/me')
const orgRoutes = require('./routes/orgs')
const userRoutes = require('./routes/users')
const noteRoutes = require('./routes/notes')
const adminRoutes = require('./routes/admin')

const app = express()

app.disable('x-powered-by')
app.use(express.json())

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.use('/auth', authRoutes)
app.use('/me', meRoutes)
app.use('/orgs', orgRoutes)
app.use('/users', userRoutes)
app.use('/admin', adminRoutes)
app.use(noteRoutes)

app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }
  if (err.name === 'PrismaClientValidationError') {
    return res.status(400).json({ error: 'Invalid request body' })
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

module.exports = app
