import { prisma } from './db'

export function getMembership(userId: number, orgId: number) {
  return prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } })
}
