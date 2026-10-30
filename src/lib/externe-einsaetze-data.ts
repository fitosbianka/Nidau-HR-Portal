// Einsätze einer externen Person laden (nur mit Admin Rechten): gespeicherte
// Einsätze und Ferienvertretungen aus der Ferienplanung sowie der Status
// pro Einsatz. Namen der vertretenen Personen kommen aus den Profilen.

import type { SupabaseClient } from '@supabase/supabase-js'
import { EINSATZ_KEY, parseEinsatzRows } from './ferien-regeln'
import { VERTRETUNG_PREFIX, parseVertretungRows } from './ferien-vertretung'
import { erledigtKey, externeEinsaetze, parseStatusRows, type ExternEinsatz } from './externe-einsaetze'

type Row = { user_full_name: string; schedule_date: string; comment: string }
const escLike = (s: string) => s.replace(/_/g, '\\_')

export async function ladeExterneEinsaetze(admin: SupabaseClient, profil: { id: string; full_name: string | null }): Promise<ExternEinsatz[]> {
  const name = (profil.full_name ?? '').trim()
  if (!name) return []
  const [{ data: einsatzRows }, { data: vtRows }, { data: erledigtRows }] = await Promise.all([
    admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').eq('user_full_name', EINSATZ_KEY)
      .gte('schedule_date', '2026-01-01').lte('schedule_date', '2027-12-31'),
    admin.from('zeiterfassung_comments').select('user_full_name, schedule_date, comment').like('user_full_name', `${escLike(VERTRETUNG_PREFIX)}%`)
      .gte('schedule_date', '2026-01-01').lte('schedule_date', '2027-12-31'),
    admin.from('zeiterfassung_comments').select('schedule_date, comment').eq('user_full_name', erledigtKey(profil.id)),
  ])
  const vertretungen = parseVertretungRows((vtRows ?? []) as Row[]).filter(v => v.name === name)
  const ids = Array.from(new Set(vertretungen.map(v => v.employeeId)))
  const namen: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: profile } = await admin.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (profile ?? []) as Array<{ id: string; full_name: string | null }>) namen[p.id] = p.full_name ?? ''
  }
  return externeEinsaetze({
    name,
    gespeichert: parseEinsatzRows((einsatzRows ?? []) as Row[]),
    vertretungen,
    namen,
    status: parseStatusRows((erledigtRows ?? []) as Array<{ schedule_date: string; comment: string }>),
  })
}
