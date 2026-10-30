// Mitarbeiter-Anekdoten für das Teamevent (befristete Aufgabe bis 16.10.2026).
// Die drei Leitenden erfassen Anekdoten über Mitarbeiterinnen; pro Eintrag
// wählbar, ob ihn alle Leitenden sehen dürfen oder nur der Admin.
// Gespeichert als reservierte zeiterfassung_comments-Zeilen (kein DDL):
//   user_full_name = __anekdote__<id>, schedule_date = Erfassungstag,
//   comment = JSON { von, vonId, ueber, text, sicht, am }.
// Alle bestehenden Loader überspringen __-präfixierte Zeilen.

import type { SupabaseClient } from '@supabase/supabase-js'

export const ANEKDOTE_PREFIX = '__anekdote__'

/** Letzter Tag, an dem die Box angezeigt wird (Teamevent-Deadline). */
export const ANEKDOTEN_DEADLINE = '2026-10-16'

export type AnekdoteSicht = 'leitende' | 'admin'

export type Anekdote = {
  key: string            // reservierter user_full_name
  von: string            // Name der erfassenden Leitenden
  vonId: string          // Profil-ID der erfassenden Person
  ueber: string          // über wen die Anekdote ist
  text: string
  sicht: AnekdoteSicht   // 'leitende' = alle Leitenden, 'admin' = nur Bianka
  am: string             // Erfassungsdatum YYYY-MM-DD
}

export function anekdotenAktiv(todayISO: string): boolean {
  return todayISO <= ANEKDOTEN_DEADLINE
}

export async function getAnekdoten(client: SupabaseClient): Promise<Anekdote[]> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${ANEKDOTE_PREFIX.replace(/_/g, '\\_')}%`)
  const list: Anekdote[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as Partial<Anekdote>
      list.push({
        key:   r.user_full_name,
        von:   p.von ?? '?',
        vonId: p.vonId ?? '',
        ueber: p.ueber ?? '?',
        text:  p.text ?? '',
        sicht: p.sicht === 'admin' ? 'admin' : 'leitende',
        am:    p.am ?? r.schedule_date,
      })
    } catch { /* ignore bad rows */ }
  }
  // Neuste zuerst
  list.sort((a, b) => b.am.localeCompare(a.am) || a.ueber.localeCompare(b.ueber))
  return list
}
