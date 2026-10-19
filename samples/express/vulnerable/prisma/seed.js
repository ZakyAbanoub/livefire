const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const newApiToken = () => 'nt_' + crypto.randomBytes(24).toString('hex')

async function main() {
  await prisma.$executeRaw`TRUNCATE notes, memberships, users, orgs RESTART IDENTITY CASCADE`

  const passwordHash = await bcrypt.hash('password1', 10)

  const acme = await prisma.org.create({ data: { name: 'Acme' } })
  const globex = await prisma.org.create({ data: { name: 'Globex' } })

  const alice = await prisma.user.create({ data: { email: 'alice@acme.test', passwordHash, apiToken: newApiToken() } })
  const bob = await prisma.user.create({ data: { email: 'bob@acme.test', passwordHash, apiToken: newApiToken() } })
  const carol = await prisma.user.create({ data: { email: 'carol@globex.test', passwordHash, apiToken: newApiToken() } })

  await prisma.membership.createMany({
    data: [
      { userId: alice.id, orgId: acme.id, role: 'owner' },
      { userId: bob.id, orgId: acme.id, role: 'member' },
      { userId: carol.id, orgId: globex.id, role: 'owner' },
    ],
  })

  await prisma.note.create({ data: { orgId: acme.id, authorId: alice.id, title: 'Q3 roadmap', body: 'Acme roadmap: ship the billing revamp before October.' } })
  await prisma.note.create({ data: { orgId: acme.id, authorId: alice.id, title: 'Vendor contacts', body: 'Acme vendor list: Initech (hardware), Hooli (cloud).' } })
  await prisma.note.create({ data: { orgId: globex.id, authorId: carol.id, title: 'Globex kickoff', body: 'Globex kickoff agenda: hiring plan and budget.' } })

  console.log('seeded: orgs=2 users=3 memberships=3 notes=3')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
