import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, deleteSession } from '@/lib/auth'

export async function POST(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) await deleteSession(token)

  const response = NextResponse.redirect(new URL('/login', request.url), 303)
  response.cookies.delete(SESSION_COOKIE)
  return response
}
