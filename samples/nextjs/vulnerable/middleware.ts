import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'session'

// Signed-out visitors are sent to the login page.
export function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
}
