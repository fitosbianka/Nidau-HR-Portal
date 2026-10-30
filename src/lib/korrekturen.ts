// Zeiterfassung correction requests from employees.
// Stored as reserved zeiterfassung_comments rows (no DDL possible):
// user_full_name = __korrektur__<id> (unique per request),
// schedule_date  = the day that needs correcting,
// comment        = JSON { name, zeit, text, am, done? }.
// "Erledigt" keeps the row and stamps `done` (date), so the history per
// employee stays available. Berichte/Konto loaders ignore __-prefixed rows,
// so these never show up in the reports themselves.

import type { SupabaseClient } from '@supabase/supabase-js'

export const KORREKTUR_PREFIX = '__korrektur__'

export type ZeitKorrektur = {
  key: string           // reserved user_full_name (unique per request)
  name: string          // employee full name
  datum: string         // day to correct (YYYY-MM-DD)
  zeit: string          // corrected time, free text
  text: string          // remark
  am: string            // submission date (YYYY-MM-DD)
  done: string | null   // resolved date (YYYY-MM-DD), null while open
}

export async function getZeitKorrekturen(client: SupabaseClient): Promise<ZeitKorrektur[]> {
  const { data } = await client
    .from('zeiterfassung_comments')
    .select('user_full_name, schedule_date, comment')
    .like('user_full_name', `${KORREKTUR_PREFIX.replace(/_/g, '\\_')}%`)
  const list: ZeitKorrektur[] = []
  for (const r of (data ?? []) as Array<{ user_full_name: string; schedule_date: string; comment: string }>) {
    try {
      const p = JSON.parse(r.comment) as { name?: string; zeit?: string; text?: string; am?: string; done?: string }
      list.push({
        key:   r.user_full_name,
        datum: r.schedule_date,
        name:  p.name ?? '?',
        zeit:  p.zeit ?? '',
        text:  p.text ?? '',
        am:    p.am ?? '',
        done:  p.done ?? null,
      })
    } catch { /* ignore bad rows */ }
  }
  // Newest submissions first
  list.sort((a, b) => (a.am === b.am ? (a.datum < b.datum ? 1 : -1) : a.am < b.am ? 1 : -1))
  return list
}
