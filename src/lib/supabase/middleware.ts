import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieItem = { name: string; value: string; options?: Record<string, unknown> }
type Profile = { role: string; is_active: boolean; job_title: string | null }

/** Nutzer ID aus dem Zugriffstoken im Cookie, nur als Vorab Hinweis für die
 *  parallele Profilabfrage; massgebend bleibt die Prüfung durch getUser(). */
function subAusToken(token: string | undefined): string | null {
  try {
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch { return null }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieItem[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Record<string, unknown>)
          )
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname
  const isPublicRoute =
    pathname === '/login' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth')

  // Server-action POSTs re-validate permissions inside the action itself
  // (requireAdmin / requireEditor), so the profile round-trip below would
  // only add latency to every saved click — just refresh the session.
  const istAction = request.method === 'POST' && request.headers.has('next-action')

  // Profil mit dem Service Key lesen (umgeht RLS). Ohne Key kein Profil,
  // die Seiten prüfen die Rolle dann selbst.
  const profilLaden = async (id: string): Promise<Profile | null> => {
    try {
      const profileClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { cookies: { getAll: () => [], setAll: () => {} } }
      )
      const { data } = await profileClient.from('profiles').select('role, is_active, job_title').eq('id', id).single()
      return (data as Profile | null) ?? null
    } catch {
      return null
    }
  }

  // Schnell: die Nutzer ID steht im Sitzungs Cookie (kein Netzwerk). So
  // laufen die Token Prüfung beim Auth Server und die Profilabfrage
  // gleichzeitig statt nacheinander, jede Seite reagiert spürbar schneller.
  const { data: { session } } = await supabase.auth.getSession()
  const sub = subAusToken(session?.access_token)
  const brauchtProfil = !!sub && !istAction
  const [{ data: { user } }, profilVorab] = await Promise.all([
    supabase.auth.getUser(),
    brauchtProfil ? profilLaden(sub) : Promise.resolve(null),
  ])

  if (user && istAction) return supabaseResponse

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user) {
    const p: Profile | null = user.id === sub ? profilVorab : await profilLaden(user.id)

    if (p && !p.is_active && !isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('error', 'account_disabled')
      return NextResponse.redirect(url)
    }

    if (pathname === '/login' && p) {
      const url = request.nextUrl.clone()
      url.pathname = p.role === 'admin' ? '/admin' : '/employee'
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/admin') && p?.role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/employee'
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/employee') && p?.role === 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
