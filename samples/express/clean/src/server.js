const app = require('./app')
const config = require('./config')
const { prisma } = require('./db')

const server = app.listen(config.port, () => {
  console.log(`notes-api listening on :${config.port}`)
})

const shutdown = () => {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
