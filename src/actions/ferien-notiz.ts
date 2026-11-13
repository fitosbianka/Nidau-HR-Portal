'use server'

// Notizen auf der Ferienplanung speichern — nur Admins (siehe darfFerienNotiz).

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { FERIEN_NOTIZ_KEY, FERIEN_NOTIZ_ANCHOR, FERIEN_NOTIZ_MAX, darfFerienNotiz } from '@/lib/ferien-notiz'

export async function ferienNotizSpeichern(text: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  const p = profile as { role: string; full_name: string } | null
  if (!darfFerienNotiz(p?.role, p?.full_name)) return { error: 'Keine Berechtigung.' }
  const sauber = (typeof text === 'string' ? text : '').replace(/\r\n/g, '\n').slice(0, FERIEN_NOTIZ_MAX)
  const am = new Date().toISOString()
  const admin = await createAdminClient()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: FERIEN_NOTIZ_KEY, schedule_date: FERIEN_NOTIZ_ANCHOR, comment: JSON.stringify({ text: sauber, am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  return { success: true as const, am }
}
