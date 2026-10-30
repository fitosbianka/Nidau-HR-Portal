import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request)
  } catch (err) {
    // If middleware crashes (e.g. bad env vars), let the request through.
    // Pages do their own auth checks and will redirect to /login if needed.
    console.error('[middleware] fatal error:', err)
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    // Exclude static files, images, and public API endpoints (e.g. TimeMoto webhook)
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/timemoto/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|txt|ico)$).*)',
  ],
}
