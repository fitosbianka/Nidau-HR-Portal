'use server'

// Ferienanteil pro Wochentag einer Person speichern oder auf den Standard
// zurücksetzen (nur Admins). Ablage: __ferien_anteil__<profileId> @ 2000-01-01.

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ANTEIL_ANCHOR, anteilKey, normalisierePerioden } from '@/lib/ferien-anteil'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PFADE = [
  '/admin/zeiterfassung/konto', '/admin/zeiterfassung/berichte', '/admin/zeiterfassung/ferien/planung', '/admin/mitarbeiter',
  '/employee/ferien', '/employee/zeiterfassung', '/employee/team/ferien', '/employee/team/zeiterfassung',
]

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht authentifiziert')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Keine Berechtigung')
  return await createAdminClient()
}

function aktualisieren(employeeId: string) {
  revalidatePath(`/admin/employees/${employeeId}`)
  for (const p of PFADE) revalidatePath(p)
}

/** Perioden speichern; leere Liste heisst bewusst «keine Regel» (auch
 *  wenn für den Namen ein Standard hinterlegt ist). */
export async function ferienAnteilSpeichern(employeeId: string, perioden: unknown) {
  if (!UUID_RE.test(employeeId)) return { error: 'Ungültige Angaben.' }
  const n = normalisierePerioden(perioden)
  if ('error' in n) return { error: n.error }
  const admin = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments').upsert(
    { user_full_name: anteilKey(employeeId), schedule_date: ANTEIL_ANCHOR, comment: JSON.stringify({ perioden: n.perioden }), updated_at: new Date().toISOString() },
    { onConflict: 'user_full_name,schedule_date' },
  )
  if (error) return { error: error.message }
  aktualisieren(employeeId)
  return { success: true as const }
}

/** Gespeicherte Regel löschen: es gilt wieder der Standard nach Namen, sonst keine Regel. */
export async function ferienAnteilZuruecksetzen(employeeId: string) {
  if (!UUID_RE.test(employeeId)) return { error: 'Ungültige Angaben.' }
  const admin = await requireAdmin()
  const { error } = await admin.from('zeiterfassung_comments').delete().eq('user_full_name', anteilKey(employeeId)).eq('schedule_date', ANTEIL_ANCHOR)
  if (error) return { error: error.message }
  aktualisieren(employeeId)
  return { success: true as const }
}
