import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  const status: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL:     url  ? `SET (${url.slice(0, 30)}...)` : 'MISSING',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon ? `SET (${anon.slice(0, 20)}...)` : 'MISSING',
    SUPABASE_SERVICE_ROLE_KEY:    svc  ? `SET (${svc.slice(0, 20)}...)` : 'MISSING',
    NEXT_PUBLIC_APP_URL:          appUrl ?? 'MISSING',
  }

  // Test anon client connection
  let anonTest = 'untested'
  try {
    const client = createServerClient(url!, anon!, {
      cookies: { getAll: () => [], setAll: () => {} },
    })
    const { error } = await client.from('profiles').select('id').limit(1)
    anonTest = error ? `ERROR: ${error.message}` : 'OK (reached DB)'
  } catch (e) {
    anonTest = `THREW: ${String(e)}`
  }

  // Test service role client connection
  let svcTest = 'untested'
  try {
    const client = createServerClient(url!, svc!, {
      cookies: { getAll: () => [], setAll: () => {} },
    })
    const { data, error } = await client.from('profiles').select('id, role').limit(5)
    svcTest = error ? `ERROR: ${error.message}` : `OK — found ${data?.length ?? 0} profiles`
  } catch (e) {
    svcTest = `THREW: ${String(e)}`
  }

  return NextResponse.json({ env: status, anonTest, svcTest })
}
