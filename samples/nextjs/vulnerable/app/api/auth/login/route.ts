import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { createSession, sessionCookie } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown }
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  const ok = user && (await bcrypt.compare(password, user.passwordHash))
  if (!user || !ok) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const { token, expiresAt } = await createSession(user.id)
  const response = NextResponse.json({ user: { id: user.id, email: user.email } })
  response.cookies.set(sessionCookie(token, expiresAt))
  return response
}
