// Serverseitige Helfer für die Ferienvertretung (siehe ferien-vertretung.ts).
// Nur aus Server Actions mit dem Admin-Client aufrufen.

import type { SupabaseClient } from '@supabase/supabase-js'
import { VERTRETUNG_PREFIX } from '@/lib/ferien-vertretung'

const key = (employeeId: string) => `${VERTRETUNG_PREFIX}${employeeId}`

/** Vertretungs-Zeilen einer Person im Zeitraum löschen. */
export async function loescheVertretung(admin: SupabaseClient, employeeId: string, from: string, to: string): Promise<string | null> {
  const { error } = await admin.from('zeiterfassung_comments').delete()
    .eq('user_full_name', key(employeeId))
    .gte('schedule_date', from)
    .lte('schedule_date', to)
  return error?.message ?? null
}

/** Vertretung für die genannten Tage setzen (leerer Name = nichts schreiben).
 *  `tage` (optional): nur diese Tage innerhalb von `days` — z. B. wenn die
 *  Vertretung nicht an allen Abwesenheitstagen kommt. Überschneidet sich
 *  `tage` nicht mit `days` (etwa nach dem Verschieben einer Periode), gelten
 *  alle Tage, damit die Vertretung nicht stillschweigend verloren geht. */
export async function schreibeVertretung(admin: SupabaseClient, employeeId: string, days: string[], name: string | null | undefined, tage?: string[] | null): Promise<string | null> {
  const n = (name ?? '').trim()
  if (!n || days.length === 0) return null
  let ziel = days
  if (tage && tage.length > 0) {
    const set = new Set(tage)
    const gewaehlt = days.filter(d => set.has(d))
    if (gewaehlt.length > 0) ziel = gewaehlt
  }
  const now = new Date().toISOString()
  const rows = ziel.map(d => ({
    user_full_name: key(employeeId), schedule_date: d, comment: JSON.stringify({ name: n }), updated_at: now,
  }))
  const { error } = await admin.from('zeiterfassung_comments').upsert(rows, { onConflict: 'user_full_name,schedule_date' })
  return error?.message ?? null
}
