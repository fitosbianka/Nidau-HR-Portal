'use server'

// «Nicht mehr anzeigen»: die angemeldete Person stellt einen Hinweis der
// Ferienplanung für sich dauerhaft ab (Erklärfenster auf der Seite oder
// Anmelde Fenster). Nur für das eigene Konto.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ferienHinweisKey, FERIEN_HINWEIS_ANKER, FERIEN_HINWEIS_ARTEN, type FerienHinweisArt } from '@/lib/ferien-hinweis'

export async function ferienHinweisAusblenden(art: FerienHinweisArt) {
  if (!FERIEN_HINWEIS_ARTEN.includes(art)) return { error: 'Ungültiger Hinweis.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.' }
  const admin = await createAdminClient()
  const key = ferienHinweisKey(user.id)
  const { data } = await admin.from('zeiterfassung_comments').select('comment')
    .eq('user_full_name', key).eq('schedule_date', FERIEN_HINWEIS_ANKER).maybeSingle()
  let bisher: Record<string, unknown> = {}
  try { const j = JSON.parse((data as { comment: string } | null)?.comment ?? '{}'); if (j && typeof j === 'object' && !Array.isArray(j)) bisher = j } catch { bisher = {} }
  const am = new Date().toISOString()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: key, schedule_date: FERIEN_HINWEIS_ANKER, comment: JSON.stringify({ ...bisher, [art]: am }), updated_at: am },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  revalidatePath('/employee', 'layout')
  revalidatePath('/employee/ferien')
  return { success: true as const }
}
