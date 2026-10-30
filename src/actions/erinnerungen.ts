'use server'

// Erinnerungen der Admin-Startseite dauerhaft ausblenden («Nie mehr
// anzeigen») und wieder einschalten. Gilt für alle Admins; gespeichert als
// eine reservierte Zeile (siehe src/lib/erinnerungen.ts).

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ERINNERUNG_AUS_KEY, ERINNERUNG_ANCHOR, type ErinnerungAus } from '@/lib/erinnerungen'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (p?.role !== 'admin') throw new Error('Keine Berechtigung')
  return { admin: await createAdminClient(), name: p.full_name }
}

type Gespeichert = Record<string, Omit<ErinnerungAus, 'key'>>

async function lade(admin: Awaited<ReturnType<typeof createAdminClient>>): Promise<Gespeichert> {
  const { data } = await admin.from('zeiterfassung_comments')
    .select('comment').eq('user_full_name', ERINNERUNG_AUS_KEY).eq('schedule_date', ERINNERUNG_ANCHOR).maybeSingle()
  try {
    const j = JSON.parse((data as { comment: string } | null)?.comment ?? '{}') as Gespeichert
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}

async function speichere(admin: Awaited<ReturnType<typeof createAdminClient>>, g: Gespeichert): Promise<string | null> {
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: ERINNERUNG_AUS_KEY, schedule_date: ERINNERUNG_ANCHOR, comment: JSON.stringify(g), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  return error?.message ?? null
}

const KEY_RE = /^[a-z0-9:_-]{1,120}$/i

export async function erinnerungAusblenden(key: string, label: string) {
  const { admin, name } = await requireAdmin()
  if (!KEY_RE.test(key)) return { error: 'Ungültige Erinnerung.' }
  const g = await lade(admin)
  g[key] = { label: label.trim().slice(0, 160) || key, am: new Date().toISOString(), von: name }
  const err = await speichere(admin, g)
  if (err) return { error: err }
  revalidatePath('/admin')
  return { success: true }
}

export async function erinnerungWiederAnzeigen(key: string) {
  const { admin } = await requireAdmin()
  if (!KEY_RE.test(key)) return { error: 'Ungültige Erinnerung.' }
  const g = await lade(admin)
  if (!(key in g)) return { success: true }
  delete g[key]
  const err = await speichere(admin, g)
  if (err) return { error: err }
  revalidatePath('/admin')
  return { success: true }
}
